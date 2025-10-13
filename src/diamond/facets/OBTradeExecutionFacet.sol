// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../interfaces/ICoreVault.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IOBLiquidationFacet.sol";

contract OBTradeExecutionFacet {
    using Math for uint256;
    using OrderBookStorage for OrderBookStorage.State;

    event TradeExecutionStarted(address indexed buyer, address indexed seller, uint256 price, uint256 amount, bool buyerMargin, bool sellerMargin);
    event TradeExecutionCompleted(address indexed buyer, address indexed seller, uint256 price, uint256 amount);
    event FeesDeducted(address indexed buyer, uint256 buyerFee, address indexed seller, uint256 sellerFee);
    event PriceUpdated(uint256 lastTradePrice, uint256 currentMarkPrice);
    // Legacy liquidation & margin events for parity
    event LiquidationTradeDetected(bool isLiquidationTrade, address liquidationTarget, bool liquidationClosesShort);
    event MarginUpdatesStarted(bool isLiquidationTrade);
    event MarginUpdatesCompleted();

    function obExecuteTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin
    ) external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(!s.nonReentrantLock, "reentrancy");
        s.nonReentrantLock = true;
        emit TradeExecutionStarted(buyer, seller, price, amount, buyerMargin, sellerMargin);

        require(buyer != address(0) && seller != address(0), "OB: zero party");
        require(buyerMargin == sellerMargin, "OrderBook: cannot mix margin and spot trades");

        // Update positions: handle liquidation trades specially
        if (buyerMargin) {
            bool isLiquidationTrade = s.liquidationMode || buyer == address(this) || seller == address(this);
            emit LiquidationTradeDetected(isLiquidationTrade, s.liquidationTarget, s.liquidationClosesShort);
            if (isLiquidationTrade) {
                address realUser = s.liquidationTarget;
                if (realUser != address(0)) {
                    // Mark under liquidation (best-effort)
                    try s.vault.setUnderLiquidation(realUser, s.marketId, true) { } catch { }
                    // Determine delta for real user based on close direction
                    int256 delta = s.liquidationClosesShort ? int256(amount) : -int256(amount);
                    try s.vault.updatePositionWithLiquidation(realUser, s.marketId, delta, price, address(this)) { } catch { }
                }
                // Counterparty receives units via normal margin path
                emit MarginUpdatesStarted(true);
                if (buyer == address(this) && seller != address(0) && seller != address(this)) {
                    (int256 sellerOld, uint256 sellerEntry, ) = _getSummary(s, seller);
                    int256 sellerDelta = -int256(amount);
                    int256 sellerNewNet = sellerOld + sellerDelta;
                    uint256 sellerBasis = _basisPriceForMargin(sellerOld, sellerDelta, sellerEntry, price);
                    uint256 mrSellerTotal = _calculateTotalRequiredMargin(s, sellerNewNet, sellerBasis);
                    try s.vault.updatePositionWithMargin(seller, s.marketId, sellerDelta, price, mrSellerTotal) { } catch { }
                } else if (seller == address(this) && buyer != address(0) && buyer != address(this)) {
                    (int256 buyerOld, uint256 buyerEntry, ) = _getSummary(s, buyer);
                    int256 buyerDelta = int256(amount);
                    int256 buyerNewNet = buyerOld + buyerDelta;
                    uint256 buyerBasis = _basisPriceForMargin(buyerOld, buyerDelta, buyerEntry, price);
                    uint256 mrBuyerTotal = _calculateTotalRequiredMargin(s, buyerNewNet, buyerBasis);
                    try s.vault.updatePositionWithMargin(buyer, s.marketId, buyerDelta, price, mrBuyerTotal) { } catch { }
                }
                emit MarginUpdatesCompleted();
            } else {
                // Normal margin trade: new-net basis logic on both sides
                (int256 buyerOld, uint256 buyerEntry, uint256 buyerLocked) = _getSummary(s, buyer);
                (int256 sellerOld, uint256 sellerEntry, uint256 sellerLocked) = _getSummary(s, seller);
                int256 buyerDelta = int256(amount);       // buyer adds long
                int256 sellerDelta = -int256(amount);     // seller adds short
                // Pre-trade solvency guards for closing legs
                _assertPreTradeSolvency(s, buyer, buyerOld, buyerEntry, buyerLocked, buyerDelta, price);
                _assertPreTradeSolvency(s, seller, sellerOld, sellerEntry, sellerLocked, sellerDelta, price);
                emit MarginUpdatesStarted(false);
                if (buyer != address(this)) {
                    int256 buyerNewNet = buyerOld + buyerDelta;
                    uint256 buyerBasis = _basisPriceForMargin(buyerOld, buyerDelta, buyerEntry, price);
                    uint256 mrBuyerTotal = _calculateTotalRequiredMargin(s, buyerNewNet, buyerBasis);
                    try s.vault.updatePositionWithMargin(buyer, s.marketId, buyerDelta, price, mrBuyerTotal) { } catch { }
                }
                if (seller != address(this)) {
                    int256 sellerNewNet = sellerOld + sellerDelta;
                    uint256 sellerBasis = _basisPriceForMargin(sellerOld, sellerDelta, sellerEntry, price);
                    uint256 mrSellerTotal = _calculateTotalRequiredMargin(s, sellerNewNet, sellerBasis);
                    try s.vault.updatePositionWithMargin(seller, s.marketId, sellerDelta, price, mrSellerTotal) { } catch { }
                }
                emit MarginUpdatesCompleted();
            }
        } else {
            // Spot is unsupported in this futures market, retain safety
            revert("OrderBook: spot trading disabled for futures markets - use margin orders");
        }

        // Fees
        uint256 buyerFee = 0;
        uint256 sellerFee = 0;
        if (s.tradingFee > 0) {
            uint256 notional6 = Math.mulDiv(amount, price, 1e18);
            buyerFee = Math.mulDiv(notional6, s.tradingFee, 10000);
            sellerFee = Math.mulDiv(notional6, s.tradingFee, 10000);
            if (buyer != address(this)) { try s.vault.deductFees(buyer, buyerFee, s.feeRecipient) { } catch { } }
            if (seller != address(this)) { try s.vault.deductFees(seller, sellerFee, s.feeRecipient) { } catch { } }
            emit FeesDeducted(buyer, buyerFee, seller, sellerFee);
        }

        // Record trade
        uint256 tradeId = s.nextTradeId == 0 ? 1 : s.nextTradeId;
        s.trades[tradeId] = OrderBookStorage.Trade({
            tradeId: tradeId,
            buyer: buyer,
            seller: seller,
            price: price,
            amount: amount,
            timestamp: block.timestamp,
            buyOrderId: 0,
            sellOrderId: 0,
            buyerIsMargin: true,
            sellerIsMargin: true,
            tradeValue: Math.mulDiv(amount, price, 1e18),
            buyerFee: buyerFee,
            sellerFee: sellerFee
        });
        s.userTradeIds[buyer].push(tradeId);
        s.userTradeIds[seller].push(tradeId);
        s.totalTradeCount += 1;
        s.nextTradeId = tradeId + 1;

        // Price + mark
        s.lastTradePrice = price;
        uint256 currentMark = _calculateMarkPriceFromFacet();
        s.lastMarkPrice = currentMark;
        try s.vault.updateMarkPrice(s.marketId, currentMark) { } catch { }
        emit PriceUpdated(s.lastTradePrice, currentMark);

        // Optional immediate liquidation scan on trade
        if (s.liquidationScanOnTrade && !s.liquidationInProgress) {
            // Use interface instead of low-level call
            try IOBLiquidationFacet(address(this)).pokeLiquidations() { } catch { }
        }

        // Track known users for liquidation scanning
        if (buyer != address(0) && buyer != address(this) && !s.isKnownUser[buyer]) { s.isKnownUser[buyer] = true; s.allKnownUsers.push(buyer); }
        if (seller != address(0) && seller != address(this) && !s.isKnownUser[seller]) { s.isKnownUser[seller] = true; s.allKnownUsers.push(seller); }

        emit TradeExecutionCompleted(buyer, seller, price, amount);
        s.nonReentrantLock = false;
    }

    function _calculateExecutionMargin(OrderBookStorage.State storage s, int256 amount, uint256 executionPrice) private view returns (uint256) {
        if (amount == 0) return 0;
        uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
        uint256 notional = Math.mulDiv(absAmount, executionPrice, 1e18);
        uint256 marginBps = amount >= 0 ? s.marginRequirementBps : 15000;
        return Math.mulDiv(notional, marginBps, 10000);
    }

    // Legacy-compatible total margin on new net position
    function _calculateRequiredMarginAdditive(
        OrderBookStorage.State storage s,
        int256 currentNet,
        uint256 entryPrice,
        uint256 /*marginLocked*/,
        int256 delta,
        uint256 executionPrice
    ) private view returns (uint256) {
        int256 newNet = currentNet + delta;
        if (newNet == 0) return 0;
        uint256 basis = _basisPriceForMargin(currentNet, delta, entryPrice, executionPrice);
        return _calculateTotalRequiredMargin(s, newNet, basis);
    }

    function _calculateTotalRequiredMargin(OrderBookStorage.State storage s, int256 newNet, uint256 basisPrice) private view returns (uint256) {
        if (newNet == 0) return 0;
        uint256 absAmount = uint256(newNet >= 0 ? newNet : -newNet);
        uint256 notional = Math.mulDiv(absAmount, basisPrice, 1e18);
        uint256 marginBps = newNet >= 0 ? s.marginRequirementBps : 15000;
        return Math.mulDiv(notional, marginBps, 10000);
    }

    // Unit-based: margin = |Q|/1e18 * unitMarginLong/Short (6d), independent of price,
    // matching original OB unit-margins so per-unit stays constant across adds.
    function _calculateTotalRequiredMarginUnitBased(OrderBookStorage.State storage s, int256 newNet, uint256 /*basisPrice*/) private view returns (uint256) {
        if (newNet == 0) return 0;
        uint256 absUnits = uint256(newNet >= 0 ? newNet : -newNet) / 1e18;
        if (absUnits == 0) absUnits = 1; // minimum to avoid zeroing micro pos
        uint256 unit6 = newNet >= 0 ? (s.unitMarginLong6 == 0 ? 1_000_000 : s.unitMarginLong6) : (s.unitMarginShort6 == 0 ? 1_500_000 : s.unitMarginShort6);
        return absUnits * unit6;
    }

    function _basisPriceForMargin(int256 currentNet, int256 delta, uint256 entryPrice, uint256 executionPrice) private pure returns (uint256) {
        if (delta == 0 || currentNet == 0) return executionPrice;
        bool reduces = (currentNet > 0 && delta < 0) || (currentNet < 0 && delta > 0);
        bool flips = (currentNet > 0 && (currentNet + delta) < 0) || (currentNet < 0 && (currentNet + delta) > 0);
        if (reduces && !flips && entryPrice > 0) {
            return entryPrice; // use entry for reductions to avoid spikes
        }
        return executionPrice;
    }

    function _computeNewEntryPrice(int256 oldSize, uint256 oldEntry, int256 delta, uint256 execPrice) private pure returns (uint256) {
        int256 newSize = oldSize + delta;
        if (newSize == 0) return 0;
        bool sameDirection = (oldSize > 0 && delta > 0) || (oldSize < 0 && delta < 0);
        if (!sameDirection || oldSize == 0) {
            return execPrice;
        }
        uint256 oldAbs = uint256(oldSize >= 0 ? oldSize : -oldSize);
        uint256 deltaAbs = uint256(delta >= 0 ? delta : -delta);
        uint256 totalAbs = uint256(newSize >= 0 ? newSize : -newSize);
        uint256 totalNotional = oldAbs * oldEntry + deltaAbs * execPrice;
        return totalNotional / totalAbs;
    }

    function _getSummary(OrderBookStorage.State storage s, address user) private view returns (int256 size, uint256 entry, uint256 locked) {
        size = 0; entry = 0; locked = 0;
        if (user == address(0) || user == address(this)) return (0, 0, 0);
        try s.vault.getPositionSummary(user, s.marketId) returns (int256 sz, uint256 ep, uint256 ml) { return (sz, ep, ml); } catch { return (0, 0, 0); }
    }

    function _calculateMarkPriceFromFacet() private view returns (uint256) {
        // Delegate to pricing facet via staticcall to avoid duplication
        (bool ok, bytes memory data) = address(this).staticcall(abi.encodeWithSignature("calculateMarkPrice()"));
        if (ok && data.length >= 32) { return abi.decode(data, (uint256)); }
        return 1000000;
    }

    function _assertPreTradeSolvency(
        OrderBookStorage.State storage s,
        address user,
        int256 currentNet,
        uint256 entryPrice,
        uint256 /*marginLocked*/,
        int256 delta,
        uint256 executionPrice
    ) private view {
        if (user == address(0) || user == address(this)) return;
        if (delta == 0 || currentNet == 0) return;
        bool closes = (currentNet > 0 && delta < 0) || (currentNet < 0 && delta > 0);
        if (!closes) return;
        uint256 absDelta = uint256(delta > 0 ? delta : -delta);
        uint256 posAbs = uint256(currentNet > 0 ? currentNet : -currentNet);
        uint256 closeAbs = absDelta > posAbs ? posAbs : absDelta;
        if (closeAbs == 0) return;
        uint256 tradingLossClosed6 = 0;
        if (currentNet > 0) {
            if (executionPrice < entryPrice) {
                uint256 diff = entryPrice - executionPrice;
                tradingLossClosed6 = Math.mulDiv(closeAbs, diff, 1e18);
            }
        } else {
            if (executionPrice > entryPrice) {
                uint256 diff2 = executionPrice - entryPrice;
                tradingLossClosed6 = Math.mulDiv(closeAbs, diff2, 1e18);
            }
        }
        if (tradingLossClosed6 == 0) return;
        // Under additive model, the immediate headroom available to cover the closing loss
        // is the margin released by the portion being closed (valued at entry price).
        int256 closingSizeSigned = currentNet > 0 ? int256(closeAbs) : -int256(closeAbs);
        uint256 releasedMargin6 = _calculateExecutionMargin(s, closingSizeSigned, entryPrice);
        require(tradingLossClosed6 <= releasedMargin6, "OrderBook: closing loss exceeds position margin");
    }

    // Minimal trade views to support existing consumers
    function getTradeById(uint256 tradeId) external view returns (OrderBookStorage.Trade memory trade) {
        return OrderBookStorage.state().trades[tradeId];
    }
    function getUserTradeCount(address user) external view returns (uint256) {
        return OrderBookStorage.state().userTradeIds[user].length;
    }
    function getRecentTrades(uint256 count) external view returns (OrderBookStorage.Trade[] memory tradeData) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(count > 0 && count <= 100, "OrderBook: invalid count");
        if (s.totalTradeCount == 0) return new OrderBookStorage.Trade[](0);
        uint256 actual = s.totalTradeCount < count ? s.totalTradeCount : count;
        tradeData = new OrderBookStorage.Trade[](actual);
        for (uint256 i = 0; i < actual; i++) {
            uint256 id = s.totalTradeCount - i;
            tradeData[i] = s.trades[id];
        }
    }

    function getAllTrades(uint256 offset, uint256 limit) external view returns (OrderBookStorage.Trade[] memory tradeData, bool hasMore) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(limit > 0 && limit <= 100, "OrderBook: invalid limit");
        if (offset >= s.totalTradeCount) return (new OrderBookStorage.Trade[](0), false);
        uint256 remaining = s.totalTradeCount - offset;
        uint256 actualLimit = remaining < limit ? remaining : limit;
        tradeData = new OrderBookStorage.Trade[](actualLimit);
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = s.totalTradeCount - offset - i;
            tradeData[i] = s.trades[tradeId];
        }
        hasMore = offset + actualLimit < s.totalTradeCount;
    }

    function getUserTrades(address user, uint256 offset, uint256 limit) external view returns (OrderBookStorage.Trade[] memory tradeData, bool hasMore) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(limit > 0 && limit <= 100, "OrderBook: invalid limit");
        uint256[] storage ids = s.userTradeIds[user];
        if (offset >= ids.length) return (new OrderBookStorage.Trade[](0), false);
        uint256 remaining = ids.length - offset;
        uint256 actualLimit = remaining < limit ? remaining : limit;
        tradeData = new OrderBookStorage.Trade[](actualLimit);
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = ids[ids.length - 1 - offset - i];
            tradeData[i] = s.trades[tradeId];
        }
        hasMore = offset + actualLimit < ids.length;
    }

    function getTradesByTimeRange(uint256 startTime, uint256 endTime, uint256 offset, uint256 limit) external view returns (OrderBookStorage.Trade[] memory tradeData, bool hasMore) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(limit > 0 && limit <= 100, "OrderBook: invalid limit");
        require(startTime <= endTime, "OrderBook: invalid time range");
        OrderBookStorage.Trade[] memory temp = new OrderBookStorage.Trade[](limit);
        uint256 found = 0; uint256 skipped = 0;
        for (uint256 i = s.totalTradeCount; i >= 1 && found < limit; i--) {
            OrderBookStorage.Trade storage t = s.trades[i];
            if (t.timestamp >= startTime && t.timestamp <= endTime) {
                if (skipped >= offset) { temp[found] = t; found++; }
                else { skipped++; }
            }
            if (t.timestamp < startTime) { break; }
            if (i == 1) break;
        }
        tradeData = new OrderBookStorage.Trade[](found);
        for (uint256 k = 0; k < found; k++) { tradeData[k] = temp[k]; }
        hasMore = found == limit;
    }

    function getTradeStatistics() external view returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        totalTrades = s.totalTradeCount; totalVolume = 0; totalFees = 0;
        for (uint256 i = 1; i <= s.totalTradeCount; i++) { OrderBookStorage.Trade storage t = s.trades[i]; totalVolume += t.tradeValue; totalFees += t.buyerFee + t.sellerFee; }
    }
}


