// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";
import "../interfaces/ICoreVault.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IOBTradeExecutionFacet.sol";
import "../interfaces/IOBLiquidationFacet.sol";

contract OBOrderPlacementFacet {
    using Math for uint256;
    using OrderBookStorage for OrderBookStorage.State;

    // Reuse key events for parity (subset needed by callers)
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy, bool isMarginOrder);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event OrderModified(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed trader, uint256 newPrice, uint256 newAmount);
    // Legacy Market Order events for tooling parity
    event MarketOrderAttempt(address indexed user, bool isBuy, uint256 amount, uint256 referencePrice, uint256 slippageBps);
    event MarketOrderLiquidityCheck(bool isBuy, uint256 bestOppositePrice, bool hasLiquidity);
    event MarketOrderPriceBounds(uint256 maxPrice, uint256 minPrice);
    event MarketOrderMarginEstimation(uint256 worstCasePrice, uint256 estimatedMargin, uint256 availableCollateral);
    event MarketOrderCreated(uint256 orderId, address indexed user, uint256 limitPrice, uint256 amount, bool isBuy);
    event MarketOrderCompleted(uint256 filledAmount, uint256 remainingAmount);
    // Legacy matching debug events for viewer parity
    event MatchingStarted(address indexed buyer, uint256 remainingAmount, uint256 maxPrice, uint256 startingPrice);
    event PriceLevelEntered(uint256 currentPrice, bool levelExists, uint256 totalAmountAtLevel);
    event OrderMatchAttempt(uint256 indexed orderId, address indexed seller, uint256 sellOrderAmount, uint256 matchAmount);
    event SlippageProtectionTriggered(uint256 currentPrice, uint256 maxPrice, uint256 remainingAmount);
    event MatchingCompleted(address indexed buyer, uint256 originalAmount, uint256 filledAmount, uint256 remainingAmount);

    modifier validOrder(uint256 price, uint256 amount) {
        require(price > 0, "Price must be greater than 0");
        require(amount > 0, "Amount must be greater than 0");
        _;
    }

    function placeLimitOrder(uint256 price, uint256 amount, bool isBuy)
        external
        validOrder(price, amount)
        returns (uint256 orderId)
    {
        return _placeLimitOrder(msg.sender, price, amount, isBuy, false, 0);
    }

    function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy)
        external
        validOrder(price, amount)
        returns (uint256 orderId)
    {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.leverageEnabled || s.marginRequirementBps == 10000, "OrderBook: margin orders require leverage to be enabled or 1:1 margin");
        uint256 adjustedAmount = amount;
        if (amount < 1e12) { adjustedAmount = 1e12; }
        uint256 marginRequired = _calculateMarginRequired(s, adjustedAmount, price, isBuy);
        return _placeLimitOrder(msg.sender, price, amount, isBuy, true, marginRequired);
    }
    function placeMarketOrder(uint256 amount, bool isBuy) external returns (uint256 filledAmount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(amount > 0, "Amount must be greater than 0");
        uint256 refPrice = isBuy ? s.bestAsk : s.bestBid;
        require(refPrice != 0, "OrderBook: no liquidity available");
        emit MarketOrderAttempt(msg.sender, isBuy, amount, refPrice, s.maxSlippageBps);
        emit MarketOrderLiquidityCheck(isBuy, refPrice, refPrice != 0);
        uint256 maxPrice = isBuy ? Math.mulDiv(refPrice, 10000 + s.maxSlippageBps, 10000) : type(uint256).max;
        uint256 minPrice = isBuy ? 0 : Math.mulDiv(refPrice, 10000 - s.maxSlippageBps, 10000);
        emit MarketOrderPriceBounds(maxPrice, minPrice);
        uint256 filled = _placeMarket(msg.sender, amount, isBuy, false, maxPrice, minPrice);
        return filled;
    }
    function placeMarginMarketOrder(uint256 amount, bool isBuy) external returns (uint256 filledAmount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.leverageEnabled || s.marginRequirementBps == 10000, "OrderBook: margin orders require leverage to be enabled or 1:1 margin");
        require(amount > 0, "Amount must be greater than 0");
        uint256 refPrice2 = isBuy ? s.bestAsk : s.bestBid;
        require(refPrice2 != 0, "OrderBook: no liquidity available");
        uint256 worstCase = isBuy ? Math.mulDiv(refPrice2, 10000 + s.maxSlippageBps, 10000) : refPrice2;
        uint256 estMargin = _calculateMarginRequired(s, amount, worstCase, isBuy);
        uint256 available = s.vault.getAvailableCollateral(msg.sender);
        emit MarketOrderAttempt(msg.sender, isBuy, amount, refPrice2, s.maxSlippageBps);
        emit MarketOrderLiquidityCheck(isBuy, refPrice2, refPrice2 != 0);
        emit MarketOrderMarginEstimation(worstCase, estMargin, available);
        require(available >= estMargin, "OrderBook: insufficient collateral for market order");
        uint256 maxPrice = isBuy ? worstCase : type(uint256).max;
        uint256 minPrice = isBuy ? 0 : Math.mulDiv(refPrice2, 10000 - s.maxSlippageBps, 10000);
        emit MarketOrderPriceBounds(maxPrice, minPrice);
        uint256 filled = _placeMarket(msg.sender, amount, isBuy, true, maxPrice, minPrice);
        return filled;
    }

    function placeMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps)
        external
        returns (uint256 filledAmount)
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(amount > 0, "Amount must be greater than 0");
        uint256 refPrice = isBuy ? s.bestAsk : s.bestBid;
        require(refPrice != 0, "OrderBook: no liquidity available");
        emit MarketOrderAttempt(msg.sender, isBuy, amount, refPrice, slippageBps);
        emit MarketOrderLiquidityCheck(isBuy, refPrice, refPrice != 0);
        uint256 maxPrice = isBuy ? Math.mulDiv(refPrice, 10000 + slippageBps, 10000) : type(uint256).max;
        uint256 minPrice = isBuy ? 0 : Math.mulDiv(refPrice, 10000 - slippageBps, 10000);
        emit MarketOrderPriceBounds(maxPrice, minPrice);
        return _placeMarket(msg.sender, amount, isBuy, false, maxPrice, minPrice);
    }

    function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps)
        external
        returns (uint256 filledAmount)
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.leverageEnabled || s.marginRequirementBps == 10000, "OrderBook: margin orders require leverage to be enabled or 1:1 margin");
        require(amount > 0, "Amount must be greater than 0");
        uint256 refPrice = isBuy ? s.bestAsk : s.bestBid;
        require(refPrice != 0, "OrderBook: no liquidity available");
        uint256 worstCase = isBuy ? Math.mulDiv(refPrice, 10000 + slippageBps, 10000) : refPrice;
        uint256 estMargin = _calculateMarginRequired(s, amount, worstCase, isBuy);
        uint256 available = s.vault.getAvailableCollateral(msg.sender);
        emit MarketOrderAttempt(msg.sender, isBuy, amount, refPrice, slippageBps);
        emit MarketOrderLiquidityCheck(isBuy, refPrice, refPrice != 0);
        emit MarketOrderMarginEstimation(worstCase, estMargin, available);
        require(available >= estMargin, "OrderBook: insufficient collateral for market order");
        uint256 maxPrice = isBuy ? worstCase : type(uint256).max;
        uint256 minPrice = isBuy ? 0 : Math.mulDiv(refPrice, 10000 - slippageBps, 10000);
        emit MarketOrderPriceBounds(maxPrice, minPrice);
        return _placeMarket(msg.sender, amount, isBuy, true, maxPrice, minPrice);
    }

    function cancelOrder(uint256 orderId) external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        OrderBookStorage.Order storage order = s.orders[orderId];
        require(order.trader != address(0), "Order does not exist");
        require(order.trader == msg.sender, "Not order owner");
        if (order.isBuy) {
            _removeFromBuyBook(s, orderId, order.price);
        } else {
            _removeFromSellBook(s, orderId, order.price);
        }
        if (order.isMarginOrder) {
            OrderBookStorage.state().vault.unreserveMargin(order.trader, bytes32(orderId));
        }
        _removeOrderFromUserList(s, msg.sender, orderId);
        emit OrderCancelled(orderId, msg.sender);
        delete s.orders[orderId];
        delete s.cumulativeMarginUsed[orderId];
        // Trigger mark update and liquidation scan after liquidity removal
        _onOrderBookLiquidityChanged();
    }

    function modifyOrder(uint256 orderId, uint256 price, uint256 amount)
        external
        validOrder(price, amount)
        returns (uint256 newOrderId)
    {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        OrderBookStorage.Order storage oldOrder = s.orders[orderId];
        require(oldOrder.trader != address(0), "Order does not exist");
        require(oldOrder.trader == msg.sender, "Not order owner");

        bool isBuy = oldOrder.isBuy;
        bool isMarginOrder = oldOrder.isMarginOrder;
        uint256 marginRequired = oldOrder.marginRequired;

        if (isBuy) { _removeFromBuyBook(s, orderId, oldOrder.price); } else { _removeFromSellBook(s, orderId, oldOrder.price); }
        _removeOrderFromUserList(s, msg.sender, orderId);
        if (isMarginOrder) { OrderBookStorage.state().vault.unreserveMargin(msg.sender, bytes32(orderId)); }
        delete s.orders[orderId];
        delete s.cumulativeMarginUsed[orderId];

        if (isMarginOrder) {
            marginRequired = _calculateMarginRequired(s, amount, price, isBuy);
        }
        newOrderId = _placeLimitOrder(msg.sender, price, amount, isBuy, isMarginOrder, marginRequired);
        emit OrderModified(orderId, newOrderId, msg.sender, price, amount);
    }

    // --- Internal matching, minimally ported ---

    function _matchBuyOrder(OrderBookStorage.State storage s, OrderBookStorage.Order memory buyOrder, uint256 remaining)
        private
        returns (uint256)
    {
        uint256 currentPrice = s.bestAsk;
        emit MatchingStarted(buyOrder.trader, remaining, buyOrder.price, currentPrice);
        if (currentPrice == 0 || currentPrice > buyOrder.price) {
            return remaining;
        }
        while (remaining > 0 && currentPrice != 0 && currentPrice <= buyOrder.price) {
            OrderBookStorage.PriceLevel storage level = s.sellLevels[currentPrice];
            if (!level.exists) { emit PriceLevelEntered(currentPrice, false, 0); currentPrice = _getNextSellPrice(s, currentPrice); continue; }
            emit PriceLevelEntered(currentPrice, true, level.totalAmount);
            uint256 currentOrderId = level.firstOrderId;
            while (remaining > 0 && currentOrderId != 0) {
                OrderBookStorage.Order storage sellOrder = s.orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                uint256 matchAmount = remaining < sellOrder.amount ? remaining : sellOrder.amount;
                emit OrderMatchAttempt(currentOrderId, sellOrder.trader, sellOrder.amount, matchAmount);
                IOBTradeExecutionFacet(address(this)).obExecuteTrade(
                    buyOrder.trader,
                    sellOrder.trader,
                    currentPrice,
                    matchAmount,
                    buyOrder.isMarginOrder,
                    sellOrder.isMarginOrder
                );
                unchecked { remaining -= matchAmount; }
                if (sellOrder.amount > matchAmount) { sellOrder.amount -= matchAmount; } else { sellOrder.amount = 0; }
                if (level.totalAmount > matchAmount) { level.totalAmount -= matchAmount; } else { level.totalAmount = 0; }
                s.filledAmounts[currentOrderId] += matchAmount;
                // Adjust reserved margin for resting margin orders
                if (sellOrder.isMarginOrder) {
                    if (sellOrder.amount == 0) {
                        s.vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId));
                    } else {
                        uint256 newReserved = _calculateMarginRequired(s, sellOrder.amount, sellOrder.price, sellOrder.isBuy);
                        s.vault.releaseExcessMargin(sellOrder.trader, bytes32(currentOrderId), newReserved);
                        s.orders[currentOrderId].marginRequired = newReserved;
                    }
                }
                if (sellOrder.amount == 0) {
                    _removeOrderFromLevel(s, currentOrderId, currentPrice, false);
                    _removeOrderFromUserList(s, sellOrder.trader, currentOrderId);
                    delete s.orders[currentOrderId];
                }
                currentOrderId = nextSellOrderId;
            }
            if (!s.sellLevels[currentPrice].exists && currentPrice == s.bestAsk) {
                s.bestAsk = _getNextSellPrice(s, currentPrice);
            }
            currentPrice = _getNextSellPrice(s, currentPrice);
        }
        uint256 filledAmount = (buyOrder.amount > remaining) ? (buyOrder.amount - remaining) : 0;
        emit MatchingCompleted(buyOrder.trader, buyOrder.amount, filledAmount, remaining);
        return remaining;
    }

    function _matchSellOrder(OrderBookStorage.State storage s, OrderBookStorage.Order memory sellOrder, uint256 remaining)
        private
        returns (uint256)
    {
        uint256 currentPrice = s.bestBid;
        while (remaining > 0 && currentPrice != 0 && currentPrice >= sellOrder.price) {
            OrderBookStorage.PriceLevel storage level = s.buyLevels[currentPrice];
            if (!level.exists) { emit PriceLevelEntered(currentPrice, false, 0); currentPrice = _getPrevBuyPrice(s, currentPrice); continue; }
            emit PriceLevelEntered(currentPrice, true, level.totalAmount);
            uint256 currentOrderId = level.firstOrderId;
            while (remaining > 0 && currentOrderId != 0) {
                OrderBookStorage.Order storage buyOrder = s.orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                uint256 matchAmount = remaining < buyOrder.amount ? remaining : buyOrder.amount;
                emit OrderMatchAttempt(currentOrderId, buyOrder.trader, buyOrder.amount, matchAmount);
                IOBTradeExecutionFacet(address(this)).obExecuteTrade(
                    buyOrder.trader,
                    sellOrder.trader,
                    currentPrice,
                    matchAmount,
                    buyOrder.isMarginOrder,
                    sellOrder.isMarginOrder
                );
                unchecked { remaining -= matchAmount; }
                if (buyOrder.amount > matchAmount) { buyOrder.amount -= matchAmount; } else { buyOrder.amount = 0; }
                if (level.totalAmount > matchAmount) { level.totalAmount -= matchAmount; } else { level.totalAmount = 0; }
                s.filledAmounts[currentOrderId] += matchAmount;
                // Adjust reserved margin for resting margin orders
                if (buyOrder.isMarginOrder) {
                    if (buyOrder.amount == 0) {
                        s.vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId));
                    } else {
                        uint256 newReserved = _calculateMarginRequired(s, buyOrder.amount, buyOrder.price, buyOrder.isBuy);
                        s.vault.releaseExcessMargin(buyOrder.trader, bytes32(currentOrderId), newReserved);
                        s.orders[currentOrderId].marginRequired = newReserved;
                    }
                }
                if (buyOrder.amount == 0) {
                    _removeOrderFromLevel(s, currentOrderId, currentPrice, true);
                    _removeOrderFromUserList(s, buyOrder.trader, currentOrderId);
                    delete s.orders[currentOrderId];
                }
                currentOrderId = nextBuyOrderId;
            }
            if (!s.buyLevels[currentPrice].exists && currentPrice == s.bestBid) {
                s.bestBid = _getPrevBuyPrice(s, currentPrice);
            }
            currentPrice = _getPrevBuyPrice(s, currentPrice);
        }
        uint256 filledAmount2 = (sellOrder.amount > remaining) ? (sellOrder.amount - remaining) : 0;
        emit MatchingCompleted(sellOrder.trader, sellOrder.amount, filledAmount2, remaining);
        return remaining;
    }

    // --- Book ops ---
    function _addToBuyBook(OrderBookStorage.State storage s, uint256 orderId, uint256 price, uint256 amount) private {
        if (!s.buyLevels[price].exists) {
            s.buyLevels[price] = OrderBookStorage.PriceLevel({ totalAmount: amount, firstOrderId: orderId, lastOrderId: orderId, exists: true });
            if (!s.buyPriceExists[price]) { s.buyPrices.push(price); s.buyPriceExists[price] = true; }
        } else {
            OrderBookStorage.PriceLevel storage level = s.buyLevels[price];
            s.orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        if (price > s.bestBid) { s.bestBid = price; }
        // Trigger mark+liquidation scan when liquidity increases
        _onOrderBookLiquidityChanged();
    }

    function _addToSellBook(OrderBookStorage.State storage s, uint256 orderId, uint256 price, uint256 amount) private {
        if (!s.sellLevels[price].exists) {
            s.sellLevels[price] = OrderBookStorage.PriceLevel({ totalAmount: amount, firstOrderId: orderId, lastOrderId: orderId, exists: true });
            if (!s.sellPriceExists[price]) { s.sellPrices.push(price); s.sellPriceExists[price] = true; }
        } else {
            OrderBookStorage.PriceLevel storage level = s.sellLevels[price];
            s.orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        if (s.bestAsk == 0 || price < s.bestAsk) { s.bestAsk = price; }
        // Trigger mark+liquidation scan when liquidity increases
        _onOrderBookLiquidityChanged();
    }

    function _removeOrderFromLevel(OrderBookStorage.State storage s, uint256 orderId, uint256 price, bool isBuy) private {
        OrderBookStorage.PriceLevel storage level = isBuy ? s.buyLevels[price] : s.sellLevels[price];
        OrderBookStorage.Order storage order = s.orders[orderId];
        if (level.totalAmount > order.amount) { level.totalAmount -= order.amount; } else { level.totalAmount = 0; }
        if (level.firstOrderId == orderId) {
            level.firstOrderId = order.nextOrderId;
            if (level.lastOrderId == orderId) { level.lastOrderId = 0; }
        } else {
            uint256 prevOrderId = level.firstOrderId;
            while (s.orders[prevOrderId].nextOrderId != orderId) { prevOrderId = s.orders[prevOrderId].nextOrderId; }
            s.orders[prevOrderId].nextOrderId = order.nextOrderId;
            if (level.lastOrderId == orderId) { level.lastOrderId = prevOrderId; }
        }
        if (level.totalAmount == 0) { level.exists = false; level.firstOrderId = 0; level.lastOrderId = 0; }
    }

    function _removeFromBuyBook(OrderBookStorage.State storage s, uint256 orderId, uint256 price) private {
        _removeOrderFromLevel(s, orderId, price, true);
        if (price == s.bestBid && !s.buyLevels[price].exists) { s.bestBid = _findNewBestBid(s); }
    }

    function _removeFromSellBook(OrderBookStorage.State storage s, uint256 orderId, uint256 price) private {
        _removeOrderFromLevel(s, orderId, price, false);
        if (price == s.bestAsk && !s.sellLevels[price].exists) { s.bestAsk = _findNewBestAsk(s); }
    }

    function _findNewBestBid(OrderBookStorage.State storage s) private view returns (uint256) {
        uint256 nb = 0; for (uint256 i = 0; i < s.buyPrices.length; i++) { if (s.buyLevels[s.buyPrices[i]].exists && s.buyPrices[i] > nb) nb = s.buyPrices[i]; }
        return nb;
    }
    function _findNewBestAsk(OrderBookStorage.State storage s) private view returns (uint256) {
        uint256 na = 0; for (uint256 i = 0; i < s.sellPrices.length; i++) { if (s.sellLevels[s.sellPrices[i]].exists) { if (na == 0 || s.sellPrices[i] < na) na = s.sellPrices[i]; } }
        return na;
    }
    function _getNextSellPrice(OrderBookStorage.State storage s, uint256 currentPrice) private view returns (uint256) {
        uint256 next = 0; for (uint256 i = 0; i < s.sellPrices.length; i++) { if (s.sellLevels[s.sellPrices[i]].exists && s.sellPrices[i] > currentPrice) { if (next == 0 || s.sellPrices[i] < next) next = s.sellPrices[i]; } }
        return next;
    }
    function _getPrevBuyPrice(OrderBookStorage.State storage s, uint256 currentPrice) private view returns (uint256) {
        uint256 prev = 0; for (uint256 i = 0; i < s.buyPrices.length; i++) { if (s.buyLevels[s.buyPrices[i]].exists && s.buyPrices[i] < currentPrice && s.buyPrices[i] > prev) { prev = s.buyPrices[i]; } }
        return prev;
    }

    function _removeOrderFromUserList(OrderBookStorage.State storage s, address user, uint256 orderId) private {
        uint256[] storage lst = s.userOrders[user];
        for (uint256 i = 0; i < lst.length; i++) {
            if (lst[i] == orderId) { if (i < lst.length - 1) { lst[i] = lst[lst.length - 1]; } lst.pop(); break; }
        }
    }

    // --- Shared helpers ---
    function _calculateMarginRequired(OrderBookStorage.State storage s, uint256 amount, uint256 price, bool isBuy) private view returns (uint256) {
        if (amount == 0) return 0;
        uint256 notional = Math.mulDiv(amount, price, 1e18);
        uint256 marginBps = isBuy ? s.marginRequirementBps : 15000;
        return Math.mulDiv(notional, marginBps, 10000);
    }
    function _placeMarket(address trader, uint256 amount, bool isBuy, bool isMarginOrder, uint256 maxPrice, uint256 minPrice) private returns (uint256 filledAmount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (s.nextOrderId == 0) s.nextOrderId = 1;
        uint256 orderId = s.nextOrderId++;
        // Do not reserve zero amount; margin sufficiency is prechecked for market orders
        OrderBookStorage.Order memory o = OrderBookStorage.Order({
            orderId: orderId,
            trader: trader,
            price: isBuy ? maxPrice : minPrice,
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0,
            isMarginOrder: isMarginOrder
        });
        emit MarketOrderCreated(orderId, trader, o.price, amount, isBuy);
        uint256 remaining = amount;
        if (isBuy) { remaining = _matchBuyOrder(s, o, remaining); } else { remaining = _matchSellOrder(s, o, remaining); }
        // No unreserve needed since we didn't reserve for market orders
        uint256 filled = amount > remaining ? (amount - remaining) : 0;
        emit MarketOrderCompleted(filled, remaining);
        emit OrderPlaced(orderId, trader, o.price, filled, isBuy, isMarginOrder);
        return filled;
    }

    function _placeLimitOrder(
        address trader,
        uint256 price,
        uint256 amount,
        bool isBuy,
        bool isMarginOrder,
        uint256 marginRequired
    ) private returns (uint256 orderId) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        if (s.nextOrderId == 0) s.nextOrderId = 1;
        orderId = s.nextOrderId++;

        if (isMarginOrder) {
            s.vault.reserveMargin(trader, bytes32(orderId), s.marketId, marginRequired);
        }

        OrderBookStorage.Order memory newOrder = OrderBookStorage.Order({
            orderId: orderId,
            trader: trader,
            price: price,
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: marginRequired,
            isMarginOrder: isMarginOrder
        });

        uint256 remaining = amount;
        if (isBuy) { remaining = _matchBuyOrder(s, newOrder, remaining); } else { remaining = _matchSellOrder(s, newOrder, remaining); }

        if (remaining > 0) {
            newOrder.amount = remaining;
            if (isMarginOrder) {
                uint256 adjustedReserved = _calculateMarginRequired(s, remaining, price, isBuy);
                newOrder.marginRequired = adjustedReserved;
                s.vault.releaseExcessMargin(trader, bytes32(orderId), adjustedReserved);
            }
            s.orders[orderId] = newOrder;
            s.userOrders[trader].push(orderId);
            if (isBuy) { _addToBuyBook(s, orderId, price, remaining); } else { _addToSellBook(s, orderId, price, remaining); }
            emit OrderPlaced(orderId, trader, price, remaining, isBuy, isMarginOrder);
        } else {
            if (isMarginOrder) {
                s.vault.unreserveMargin(trader, bytes32(orderId));
            }
            emit OrderPlaced(orderId, trader, price, 0, isBuy, isMarginOrder);
        }
    }

    function _onOrderBookLiquidityChanged() private {
        // Use dedicated interface for poke; ignore failures
        try IOBLiquidationFacet(address(this)).pokeLiquidations() { } catch { }
    }
}


