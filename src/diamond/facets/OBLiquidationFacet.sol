// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../libraries/LibDiamond.sol";
import "../interfaces/ICoreVault.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract OBLiquidationFacet {
    using Math for uint256;
    using OrderBookStorage for OrderBookStorage.State;
    uint256 private constant MAX_LIQUIDATION_REWARD_RECIPIENTS = 64;

    event LiquidationCheckStarted(uint256 markPrice, uint256 tradersLength, uint256 startIndex, uint256 endIndex);
    event LiquidationRecursionGuardSet(bool inProgress);
    event LiquidationTraderBeingChecked(address indexed trader, uint256 index, uint256 totalTraders);
    event LiquidationLiquidatableCheck(address indexed trader, bool isLiquidatable, uint256 markPrice);
    event AutoLiquidationTriggered(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 markPrice);
    event LiquidationCompleted(address indexed trader, uint256 liquidationsTriggered, string method);
    event LiquidationIndexUpdated(uint256 oldIndex, uint256 newIndex, uint256 tradersLength);
    event LiquidationCheckFinished(uint256 tradersChecked, uint256 liquidationsTriggered, uint256 nextStartIndex);
    event LiquidationCheckTriggered(uint256 currentMark, uint256 lastMarkPrice);
    event LiquidationLiquidityCheck(bool isBuy, uint256 bestOppositePrice, bool hasLiquidity);
    event LiquidationPriceBounds(uint256 maxPrice, uint256 minPrice);
    event LiquidationResync(uint256 bestBidPrice, uint256 bestAskPrice);
    event LiquidationMarketOrderAttempt(address indexed trader, uint256 amount, bool isBuy, uint256 markPrice);
    event LiquidationMarketOrderResult(address indexed trader, bool success, string reason);
    event LiquidationPositionRetrieved(address indexed trader, int256 size, uint256 marginLocked, int256 unrealizedPnL);
    event LiquidationConfigUpdated(bool scanOnTrade, bool debug);
    event LiquidationSocializedLossAttempt(address indexed trader, bool isLong, string method);
    event LiquidationSocializedLossResult(address indexed trader, bool success, string method);
    event LiquidationMarginConfiscated(address indexed trader, uint256 marginAmount, uint256 penalty, address indexed liquidator);
    // Reward distribution + gap protection debug
    event DebugMakerContributionAdded(address indexed maker, uint256 notionalScaled, uint256 totalScaledAfter);
    event DebugRewardComputation(address indexed liquidatedUser, uint256 expectedPenalty, uint256 obBalance, uint256 rewardPool, uint256 makerCount, uint256 totalScaled);
    event DebugRewardDistributionStart(address indexed liquidatedUser, uint256 rewardAmount);
    event DebugMakerRewardPayOutcome(address indexed liquidatedUser, address indexed maker, uint256 amount, bool success, bytes errorData);
    event DebugRewardDistributionEnd(address indexed liquidatedUser);
    event LiquidationMarketGapDetected(address indexed trader, uint256 liquidationPrice, uint256 actualExecutionPrice, int256 positionSize, uint256 gapLoss);
    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    function setConfigLiquidationScanOnTrade(bool enable) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.liquidationScanOnTrade = enable;
        emit LiquidationConfigUpdated(s.liquidationScanOnTrade, s.liquidationDebug);
    }

    function setConfigLiquidationDebug(bool enable) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.liquidationDebug = enable;
        emit LiquidationConfigUpdated(s.liquidationScanOnTrade, s.liquidationDebug);
    }


    struct LiquidationExecutionResult {
        bool success;
        uint256 filledAmount;
        uint256 remainingAmount;
        uint256 averageExecutionPrice;
        uint256 worstExecutionPrice;
        uint256 totalExecutions;
    }

    function pokeLiquidations() external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (s.liquidationInProgress) { s.pendingLiquidationRescan = true; emit LiquidationRecursionGuardSet(true); return; }
        uint256 currentMark = _calculateMarkPrice();
        s.lastMarkPrice = currentMark;
        s.vault.updateMarkPrice(s.marketId, currentMark);
        emit LiquidationCheckTriggered(currentMark, s.lastMarkPrice);
        _checkPositionsForLiquidation(currentMark);
    }

    function _checkPositionsForLiquidation(uint256 markPrice) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        emit LiquidationCheckStarted(markPrice, 0, 0, 0);
        if (s.liquidationInProgress) { emit LiquidationRecursionGuardSet(true); return; }
        emit LiquidationRecursionGuardSet(false);

        address[] memory usersWithPositions;
        try s.vault.getUsersWithPositionsInMarket(s.marketId) returns (address[] memory users) { usersWithPositions = users; }
        catch { usersWithPositions = s.allKnownUsers; }
        uint256 tradersLength = usersWithPositions.length;
        if (tradersLength == 0) { emit LiquidationCheckFinished(0, 0, 0); return; }

        s.liquidationInProgress = true;
        uint256 startIndex = s.lastCheckedIndex;
        uint256 endIndex = Math.min(startIndex + 5, tradersLength);
        uint256 liquidationsTriggered = 0;
        uint256 tradersChecked = 0; uint256 lastIndexProcessed = startIndex;
        emit LiquidationCheckStarted(markPrice, tradersLength, startIndex, endIndex);

        for (uint256 i = startIndex; i < endIndex; i++) {
            lastIndexProcessed = i; tradersChecked++;
            if (i >= usersWithPositions.length) break;
            address trader = usersWithPositions[i];
            emit LiquidationTraderBeingChecked(trader, i, tradersLength);
            (bool didLiq, int256 posSize) = _checkAndLiquidateTrader(trader, markPrice);
            if (didLiq) { liquidationsTriggered++; emit AutoLiquidationTriggered(trader, s.marketId, posSize, markPrice); emit LiquidationCompleted(trader, liquidationsTriggered, "Market Order"); if (liquidationsTriggered >= 5) { break; } }
        }

        uint256 oldIndex = s.lastCheckedIndex;
        uint256 nextStartIndex = lastIndexProcessed + 1;
        s.lastCheckedIndex = nextStartIndex >= tradersLength ? 0 : nextStartIndex;
        s.lastLiquidationCheck = block.timestamp;
        emit LiquidationIndexUpdated(oldIndex, s.lastCheckedIndex, tradersLength);
        s.liquidationInProgress = false;

        if (s.pendingLiquidationRescan) { s.pendingLiquidationRescan = false; uint256 currentMark2 = _calculateMarkPrice(); s.vault.updateMarkPrice(s.marketId, currentMark2); emit LiquidationCheckTriggered(currentMark2, s.lastMarkPrice); _checkPositionsForLiquidation(currentMark2); s.lastMarkPrice = currentMark2; }
        emit LiquidationCheckFinished(tradersChecked, liquidationsTriggered, s.lastCheckedIndex);
    }

    function _checkAndLiquidateTrader(address trader, uint256 markPrice) internal returns (bool didLiquidate, int256 positionSize) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        bool isLiquidatable = false;
        try s.vault.isLiquidatable(trader, s.marketId, markPrice) returns (bool liquidatable) { isLiquidatable = liquidatable; emit LiquidationLiquidatableCheck(trader, isLiquidatable, markPrice); }
        catch { emit LiquidationLiquidatableCheck(trader, false, markPrice); return (false, 0); }
        if (!isLiquidatable) return (false, 0);

        try s.vault.getPositionSummary(trader, s.marketId) returns (int256 size, uint256 /*entryPrice*/, uint256 marginLocked) {
            if (size == 0) return (false, 0);
            positionSize = size;
            emit LiquidationPositionRetrieved(trader, size, marginLocked, 0);
            LiquidationExecutionResult memory res = _executeLiquidationMarketOrder(trader, size < 0, uint256(size < 0 ? -size : size), markPrice);
            if (res.filledAmount > 0) {
                // Process gap protection and maker rewards
                _processEnhancedLiquidationWithGapProtection(trader, size, markPrice, res);
                return (true, size);
            }
            return (false, 0);
        } catch { return (false, 0); }
    }

    function _executeLiquidationMarketOrder(address trader, bool isBuy, uint256 amount, uint256 markPrice) internal returns (LiquidationExecutionResult memory result) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        // Guards and slippage
        if (amount == 0 || markPrice == 0) { emit LiquidationMarketOrderResult(trader, false, "INVALID_INPUT"); return result; }
        if (isBuy && s.bestAsk == 0) { emit LiquidationLiquidityCheck(true, 0, false); emit LiquidationMarketOrderResult(trader, false, "NO_ASKS"); return result; }
        if (!isBuy && s.bestBid == 0) { emit LiquidationLiquidityCheck(false, 0, false); emit LiquidationMarketOrderResult(trader, false, "NO_BIDS"); return result; }
        uint256 liquidationSlippageBps = 1500; // 15%
        uint256 maxPrice = isBuy ? Math.mulDiv(markPrice, 10000 + liquidationSlippageBps, 10000) : 0;
        uint256 minPrice = isBuy ? 0 : Math.mulDiv(markPrice, 10000 - liquidationSlippageBps, 10000);
        emit LiquidationPriceBounds(maxPrice, minPrice);
        {
            uint256 bestOpp = isBuy ? s.bestAsk : s.bestBid;
            emit LiquidationLiquidityCheck(isBuy, bestOpp, bestOpp != 0);
        }

        // Initialize tracking
        s.liquidationExecutionTotalVolume = 0; s.liquidationExecutionTotalValue = 0; s.liquidationWorstPrice = 0; s.liquidationExecutionCount = 0;
        s.liquidationMode = true; s.liquidationTarget = trader; s.liquidationClosesShort = isBuy; s.liquidationTrackingActive = true;
        // Reset maker contribution arrays per liquidation
        delete s.liquidationMakers;
        delete s.liquidationMakerNotionalScaled;
        s.liquidationTotalNotionalScaled = 0;

        // Create synthetic order and cross book
        OrderBookStorage.Order memory liqOrder = OrderBookStorage.Order({
            orderId: 0, trader: address(this), price: isBuy ? maxPrice : minPrice, amount: amount, isBuy: isBuy, timestamp: block.timestamp, nextOrderId: 0, marginRequired: 0, isMarginOrder: true
        });
        uint256 remaining = amount;
        emit LiquidationMarketOrderAttempt(trader, amount, isBuy, markPrice);
        if (isBuy) { remaining = _matchBuyOrder(liqOrder, remaining, maxPrice); } else { remaining = _matchSellOrder(liqOrder, remaining, minPrice); }

        // If no fill within bounds but there is book liquidity, force cross
        if (remaining == amount) {
            if (isBuy && s.bestAsk != 0) {
                remaining = _matchBuyOrder(liqOrder, remaining, type(uint256).max);
            } else if (!isBuy && s.bestBid != 0) {
                remaining = _matchSellOrder(liqOrder, remaining, 0);
            }
        }

        s.liquidationMode = false; s.liquidationTarget = address(0); s.liquidationTrackingActive = false;
        result.remainingAmount = remaining; result.filledAmount = amount - remaining;
        if (s.liquidationExecutionTotalVolume > 0) {
            result.averageExecutionPrice = s.liquidationExecutionTotalValue / s.liquidationExecutionTotalVolume;
            result.worstExecutionPrice = s.liquidationWorstPrice; result.totalExecutions = s.liquidationExecutionCount;
            result.success = result.filledAmount >= (amount * 50) / 100;
        }
        emit LiquidationResync(s.bestBid, s.bestAsk);
        emit LiquidationMarketOrderResult(trader, result.success, result.success ? "EXECUTED" : "PARTIAL_OR_NONE");
        return result;
    }

    function _processEnhancedLiquidationWithGapProtection(
        address trader,
        int256 positionSize,
        uint256 liquidationTriggerPrice,
        LiquidationExecutionResult memory executionResult
    ) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 gapLoss = 0;
        if (executionResult.worstExecutionPrice != liquidationTriggerPrice) {
            if (positionSize > 0) {
                if (executionResult.worstExecutionPrice < liquidationTriggerPrice) {
                    uint256 priceGap = liquidationTriggerPrice - executionResult.worstExecutionPrice;
                    gapLoss = Math.mulDiv(uint256(positionSize >= 0 ? positionSize : -positionSize), priceGap, 1e18);
                }
            } else {
                if (executionResult.worstExecutionPrice > liquidationTriggerPrice) {
                    uint256 priceGap2 = executionResult.worstExecutionPrice - liquidationTriggerPrice;
                    gapLoss = Math.mulDiv(uint256(positionSize >= 0 ? positionSize : -positionSize), priceGap2, 1e18);
                }
            }
            if (gapLoss > 0) {
                emit LiquidationMarketGapDetected(trader, liquidationTriggerPrice, executionResult.worstExecutionPrice, positionSize, gapLoss);
            }
        }

        // Synchronize mark post execution
        uint256 syncedMark = _calculateMarkPrice();
        s.lastMarkPrice = syncedMark;
        s.vault.updateMarkPrice(s.marketId, syncedMark);

        // Compute reward pool from OB balance, capped by expected penalty
        uint256 absSizeExec = uint256(positionSize > 0 ? positionSize : -positionSize);
        uint256 notional6 = Math.mulDiv(absSizeExec, executionResult.averageExecutionPrice, 1e18);
        uint256 expectedPenalty = Math.mulDiv(notional6, 1000, 10000);
        uint256 obBalance = s.vault.getAvailableCollateral(address(this));
        uint256 rewardPool = expectedPenalty > 0 ? (expectedPenalty < obBalance ? expectedPenalty : obBalance) : obBalance;
        emit DebugRewardComputation(trader, expectedPenalty, obBalance, rewardPool, OrderBookStorage.state().liquidationMakers.length, OrderBookStorage.state().liquidationTotalNotionalScaled);
        _distributeLiquidationRewards(trader, rewardPool);
    }

    function _distributeLiquidationRewards(address liquidatedUser, uint256 rewardAmount) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (rewardAmount == 0) return; if (s.liquidationTotalNotionalScaled == 0) return; if (s.liquidationMakers.length == 0) return;
        emit DebugRewardDistributionStart(liquidatedUser, rewardAmount);
        uint256 remaining = rewardAmount;
        for (uint256 i = 0; i < s.liquidationMakers.length; i++) {
            address maker = s.liquidationMakers[i]; if (maker == address(0) || maker == address(this)) continue;
            uint256 share = Math.mulDiv(rewardAmount, s.liquidationMakerNotionalScaled[i], s.liquidationTotalNotionalScaled);
            if (share == 0) continue;
            (bool ok, bytes memory err) = _payMaker(liquidatedUser, maker, share);
            emit DebugMakerRewardPayOutcome(liquidatedUser, maker, share, ok, ok ? bytes("") : err);
            if (remaining >= share) remaining -= share; else remaining = 0;
        }
        if (remaining > 0) {
            address first = s.liquidationMakers[0]; if (first != address(this)) { (bool ok2, bytes memory err2) = _payMaker(liquidatedUser, first, remaining); emit DebugMakerRewardPayOutcome(liquidatedUser, first, remaining, ok2, ok2 ? bytes("") : err2); }
        }
        emit DebugRewardDistributionEnd(liquidatedUser);
    }

    function _payMaker(address liquidatedUser, address maker, uint256 amount) internal returns (bool ok, bytes memory err) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        try s.vault.payMakerLiquidationReward(liquidatedUser, s.marketId, maker, amount) { return (true, bytes("")); }
        catch (bytes memory e) { return (false, e); }
    }

    function _matchBuyOrder(OrderBookStorage.Order memory buyOrder, uint256 remainingAmount, uint256 maxPrice) internal returns (uint256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 currentPrice = s.bestAsk;
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice <= maxPrice) {
            OrderBookStorage.PriceLevel storage level = s.sellLevels[currentPrice];
            if (!level.exists) { currentPrice = _getNextSellPrice(currentPrice); continue; }
            uint256 currentOrderId = level.firstOrderId;
            while (remainingAmount > 0 && currentOrderId != 0) {
                OrderBookStorage.Order storage sellOrder = s.orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                uint256 matchAmount = remainingAmount < sellOrder.amount ? remainingAmount : sellOrder.amount;
                // Attribute to real trader and counterparty via execution facet
                _executeTradeForLiquidation(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                // Track maker contribution (resting sell order)
                _recordLiquidationMakerContribution(sellOrder.trader, currentPrice, matchAmount);
                // Track liquidation execution metrics
                unchecked {
                    OrderBookStorage.state().liquidationExecutionTotalVolume += matchAmount;
                    uint256 scaledAmount = matchAmount / 1e12;
                    OrderBookStorage.state().liquidationExecutionTotalValue += scaledAmount * currentPrice;
                    OrderBookStorage.state().liquidationExecutionCount += 1;
                    if (OrderBookStorage.state().liquidationWorstPrice == 0 || currentPrice > OrderBookStorage.state().liquidationWorstPrice) {
                        OrderBookStorage.state().liquidationWorstPrice = currentPrice;
                    }
                }
                unchecked { remainingAmount -= matchAmount; }
                if (sellOrder.amount > matchAmount) { sellOrder.amount -= matchAmount; } else { sellOrder.amount = 0; }
                if (level.totalAmount > matchAmount) { level.totalAmount -= matchAmount; } else { level.totalAmount = 0; }
                if (sellOrder.amount == 0) { _removeOrderFromLevel(currentOrderId, currentPrice, false); _removeOrderFromUserList(sellOrder.trader, currentOrderId); delete s.orders[currentOrderId]; }
                currentOrderId = nextSellOrderId;
            }
            if (!s.sellLevels[currentPrice].exists && currentPrice == s.bestAsk) { s.bestAsk = _getNextSellPrice(currentPrice); }
            currentPrice = _getNextSellPrice(currentPrice);
        }
        return remainingAmount;
    }

    function _matchSellOrder(OrderBookStorage.Order memory sellOrder, uint256 remainingAmount, uint256 minPrice) internal returns (uint256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 currentPrice = s.bestBid;
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice >= minPrice) {
            OrderBookStorage.PriceLevel storage level = s.buyLevels[currentPrice];
            if (!level.exists) { currentPrice = _getPrevBuyPrice(currentPrice); continue; }
            uint256 currentOrderId = level.firstOrderId;
            while (remainingAmount > 0 && currentOrderId != 0) {
                OrderBookStorage.Order storage buyOrder = s.orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                uint256 matchAmount = remainingAmount < buyOrder.amount ? remainingAmount : buyOrder.amount;
                _executeTradeForLiquidation(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                // Track maker contribution (resting buy order)
                _recordLiquidationMakerContribution(buyOrder.trader, currentPrice, matchAmount);
                unchecked {
                    OrderBookStorage.state().liquidationExecutionTotalVolume += matchAmount;
                    uint256 scaledAmount2 = matchAmount / 1e12;
                    OrderBookStorage.state().liquidationExecutionTotalValue += scaledAmount2 * currentPrice;
                    OrderBookStorage.state().liquidationExecutionCount += 1;
                    if (OrderBookStorage.state().liquidationWorstPrice == 0 || currentPrice < OrderBookStorage.state().liquidationWorstPrice) {
                        OrderBookStorage.state().liquidationWorstPrice = currentPrice;
                    }
                }
                unchecked { remainingAmount -= matchAmount; }
                if (buyOrder.amount > matchAmount) { buyOrder.amount -= matchAmount; } else { buyOrder.amount = 0; }
                if (level.totalAmount > matchAmount) { level.totalAmount -= matchAmount; } else { level.totalAmount = 0; }
                if (buyOrder.amount == 0) { _removeOrderFromLevel(currentOrderId, currentPrice, true); _removeOrderFromUserList(buyOrder.trader, currentOrderId); delete s.orders[currentOrderId]; }
                currentOrderId = nextBuyOrderId;
            }
            if (!s.buyLevels[currentPrice].exists && currentPrice == s.bestBid) { s.bestBid = _getPrevBuyPrice(currentPrice); }
            currentPrice = _getPrevBuyPrice(currentPrice);
        }
        return remainingAmount;
    }

    function _executeTradeForLiquidation(address buyer, address seller, uint256 price, uint256 amount, bool buyerMargin, bool sellerMargin) internal {
        // delegate to trade execution facet
        (bool ok, ) = address(this).call(abi.encodeWithSignature("obExecuteTrade(address,address,uint256,uint256,bool,bool)", buyer, seller, price, amount, buyerMargin, sellerMargin));
        ok; // ignore result
    }

    function _recordLiquidationMakerContribution(address maker, uint256 price, uint256 amount) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (!s.liquidationTrackingActive) return;
        if (maker == address(0) || maker == address(this)) return;
        uint256 scaledAmount = amount / 1e12; if (scaledAmount == 0) return;
        uint256 notionalScaled = scaledAmount * price;
        for (uint256 i = 0; i < s.liquidationMakers.length; i++) {
            if (s.liquidationMakers[i] == maker) {
                s.liquidationMakerNotionalScaled[i] += notionalScaled;
                s.liquidationTotalNotionalScaled += notionalScaled;
                emit DebugMakerContributionAdded(maker, notionalScaled, s.liquidationTotalNotionalScaled);
                return;
            }
        }
        if (s.liquidationMakers.length < MAX_LIQUIDATION_REWARD_RECIPIENTS) {
            s.liquidationMakers.push(maker);
            s.liquidationMakerNotionalScaled.push(notionalScaled);
            s.liquidationTotalNotionalScaled += notionalScaled;
            emit DebugMakerContributionAdded(maker, notionalScaled, s.liquidationTotalNotionalScaled);
        } else {
            s.liquidationTotalNotionalScaled += notionalScaled;
            emit DebugMakerContributionAdded(maker, notionalScaled, s.liquidationTotalNotionalScaled);
        }
    }

    function _removeOrderFromLevel(uint256 orderId, uint256 price, bool isBuy) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        OrderBookStorage.PriceLevel storage level = isBuy ? s.buyLevels[price] : s.sellLevels[price];
        OrderBookStorage.Order storage order = s.orders[orderId];
        if (level.totalAmount > order.amount) { level.totalAmount -= order.amount; } else { level.totalAmount = 0; }
        if (level.firstOrderId == orderId) { level.firstOrderId = order.nextOrderId; if (level.lastOrderId == orderId) { level.lastOrderId = 0; } }
        else {
            uint256 prevOrderId = level.firstOrderId;
            while (s.orders[prevOrderId].nextOrderId != orderId) { prevOrderId = s.orders[prevOrderId].nextOrderId; }
            s.orders[prevOrderId].nextOrderId = order.nextOrderId; if (level.lastOrderId == orderId) { level.lastOrderId = prevOrderId; }
        }
        if (level.totalAmount == 0) { level.exists = false; level.firstOrderId = 0; level.lastOrderId = 0; }
    }

    function _removeOrderFromUserList(address user, uint256 orderId) internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256[] storage userOrderList = s.userOrders[user];
        if (userOrderList.length == 0) return;
        for (uint256 i = 0; i < userOrderList.length; i++) { if (userOrderList[i] == orderId) { if (i < userOrderList.length - 1) { userOrderList[i] = userOrderList[userOrderList.length - 1]; } userOrderList.pop(); break; } }
    }

    function _calculateMarkPrice() internal view returns (uint256) {
        // Delegate to pricing facet via static call
        (bool ok, bytes memory data) = address(this).staticcall(abi.encodeWithSignature("calculateMarkPrice()"));
        if (ok && data.length >= 32) { return abi.decode(data, (uint256)); }
        return 1000000;
    }

    function _getNextSellPrice(uint256 currentPrice) internal view returns (uint256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 next = 0; for (uint256 i = 0; i < s.sellPrices.length; i++) { if (s.sellLevels[s.sellPrices[i]].exists && s.sellPrices[i] > currentPrice) { if (next == 0 || s.sellPrices[i] < next) next = s.sellPrices[i]; } }
        return next;
    }
    function _getPrevBuyPrice(uint256 currentPrice) internal view returns (uint256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 prev = 0; for (uint256 i = 0; i < s.buyPrices.length; i++) { if (s.buyLevels[s.buyPrices[i]].exists && s.buyPrices[i] < currentPrice && s.buyPrices[i] > prev) { prev = s.buyPrices[i]; } }
        return prev;
    }
}


