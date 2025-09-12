// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./OrderBook.sol";
import "./FuturesMarketFactory.sol";
import "./CentralizedVault.sol";

/**
 * @title TradingRouter
 * @dev Unified trading interface for multiple OrderBook markets with portfolio aggregation
 * @notice Serves as the central hub for all trading operations, providing cross-market functionality
 */
contract TradingRouter is AccessControl, ReentrancyGuard, Pausable {
    // ============ Access Control Roles ============
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ============ Core Dependencies ============
    CentralizedVault public immutable VAULT_ROUTER;
    FuturesMarketFactory public immutable ORDER_BOOK_FACTORY;

    // ============ Data Structures ============

    /**
     * @dev Order side enumeration for consistency
     */
    enum OrderSide {
        BUY,
        SELL
    }

    /**
     * @dev Market price data structure
     */
    struct MarketPriceData {
        bytes32 marketId;
        uint256 midPrice;
        uint256 bestBid;
        uint256 bestAsk;
        uint256 lastPrice;
        uint256 spread;
        uint256 spreadBps;
        bool isValid;
        string source;
    }

    /**
     * @dev Position breakdown for advanced analytics
     */
    struct PositionBreakdown {
        bytes32 marketId;
        int256 size;                    // Position size (+ for long, - for short)
        uint256 entryPrice;             // Entry price when opened
        uint256 currentPrice;           // Current market price
        uint256 marginLocked;           // Margin locked for position
        uint256 timestamp;              // When position opened
        int256 unrealizedPnL;          // Current unrealized P&L
        uint256 unrealizedPnLPercent;  // P&L as percentage
        uint256 notionalValue;          // Current notional value
        uint256 marginUtilization;     // Margin utilization percentage
        bool isLong;                   // Position direction
        bool isProfitable;             // Current profitability
    }

    /**
     * @dev Portfolio summary analytics
     */
    struct PositionPortfolioSummary {
        uint256 totalPositions;            // Total number of positions
        uint256 profitablePositions;       // Number of profitable positions
        int256 totalUnrealizedPnL;        // Total unrealized P&L
        uint256 totalNotionalValue;        // Total notional value
        uint256 totalMarginLocked;         // Total margin locked
        uint256 averageMarginUtilization;  // Average margin utilization
        uint256 portfolioConcentration;    // Concentration risk metric
    }

    /**
     * @dev Trading statistics structure
     */
    struct TradingStats {
        uint256 totalTrades;
        uint256 totalVolume;
        uint256 totalFees;
    }

    // ============ Storage ============

    // Trading statistics
    TradingStats public globalStats;
    mapping(bytes32 => uint256) public marketVolumes;
    mapping(address => uint256) public userTrades;

    // Price tracking for P&L calculations
    mapping(bytes32 => uint256) public lastTradePrices;

    // ============ Events ============

    event LimitOrderPlaced(
        address indexed trader,
        bytes32 indexed marketId,
        bytes32 indexed orderId,
        OrderSide side,
        uint128 amount,
        uint64 priceTick,
        uint256 leverage
    );

    event MarketOrderExecuted(
        address indexed trader,
        bytes32 indexed marketId,
        OrderSide side,
        uint128 amountRequested,
        uint128 amountFilled,
        uint256 leverage
    );

    event MultiMarketTrade(
        address indexed trader,
        bytes32[] marketIds,
        uint256[] amounts,
        uint256 totalValue
    );

    event ArbitrageOpportunityDetected(
        bytes32 indexed marketId1,
        bytes32 indexed marketId2,
        uint256 priceDifference,
        uint256 potentialProfit
    );

    event TradingStatsUpdated(
        bytes32 indexed marketId,
        address indexed user,
        uint256 volume,
        uint256 fees
    );

    // ============ Constructor ============

    constructor(
        address _vaultRouter,
        address _orderBookFactory,
        address _admin
    ) {
        require(_vaultRouter != address(0), "TradingRouter: vault cannot be zero address");
        require(_orderBookFactory != address(0), "TradingRouter: factory cannot be zero address");
        require(_admin != address(0), "TradingRouter: admin cannot be zero address");

        VAULT_ROUTER = CentralizedVault(_vaultRouter);
        ORDER_BOOK_FACTORY = FuturesMarketFactory(_orderBookFactory);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    // ============ Core Trading Functions ============

    /**
     * @dev Place a limit order on a specific market
     * @param marketId Market identifier
     * @param side Order side (BUY or SELL)
     * @param amount Order amount with 18 decimals
     * @param priceTick Price in tick format (6 decimals for USDC precision)
     * @param leverage Leverage multiplier (1x to 100x)
     * @return orderId Generated order ID
     */
    function placeLimitOrder(
        bytes32 marketId,
        OrderSide side,
        uint128 amount,
        uint64 priceTick,
        uint256 leverage,
        uint32 /* expiry */
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        require(amount > 0, "TradingRouter: amount must be greater than 0");
        require(priceTick > 0, "TradingRouter: price must be greater than 0");
        require(leverage >= 1 && leverage <= 100, "TradingRouter: invalid leverage");

        OrderBook orderBook = _getOrderBook(marketId);
        
        // Convert parameters to OrderBook format
        // OrderBook expects prices in 6 decimals (USDC precision), so no conversion needed
        uint256 price = uint256(priceTick); // Keep as 6 decimals for USDC precision
        bool isBuy = (side == OrderSide.BUY);
        bool isMarginOrder = (leverage > 1);

        // Place order through OrderBook
        uint256 orderIdUint;
        if (isMarginOrder) {
            orderIdUint = orderBook.placeMarginLimitOrder(
                price,
                uint256(amount),
                isBuy
            );
        } else {
            orderIdUint = orderBook.placeLimitOrder(
                price,
                uint256(amount),
                isBuy
            );
        }

        orderId = bytes32(orderIdUint);

        emit LimitOrderPlaced(
            msg.sender,
            marketId,
            orderId,
            side,
            amount,
            priceTick,
            leverage
        );

        return orderId;
    }

    /**
     * @dev Execute a market buy order with slippage protection
     * @param marketId Market identifier
     * @param amount Amount to buy with 18 decimals
     * @param maxPriceTick Maximum acceptable price per unit
     * @return amountFilled Actual amount filled
     */
    function marketBuy(
        bytes32 marketId,
        uint128 amount,
        uint64 maxPriceTick
    ) external nonReentrant whenNotPaused returns (uint128 amountFilled) {
        return _executeMarketOrder(marketId, amount, maxPriceTick, true, 1);
    }

    /**
     * @dev Execute a market buy order with leverage and slippage protection
     * @param marketId Market identifier
     * @param amount Amount to buy with 18 decimals
     * @param maxPriceTick Maximum acceptable price per unit
     * @param leverage Leverage multiplier (1x to 100x)
     * @return amountFilled Actual amount filled
     */
    function marketBuyWithLeverage(
        bytes32 marketId,
        uint128 amount,
        uint64 maxPriceTick,
        uint256 leverage
    ) external nonReentrant whenNotPaused returns (uint128 amountFilled) {
        require(leverage >= 1 && leverage <= 100, "TradingRouter: invalid leverage");
        return _executeMarketOrder(marketId, amount, maxPriceTick, true, leverage);
    }

    /**
     * @dev Execute a market sell order with slippage protection
     * @param marketId Market identifier
     * @param amount Amount to sell with 18 decimals
     * @param minPriceTick Minimum acceptable price per unit
     * @return amountFilled Actual amount filled
     */
    function marketSell(
        bytes32 marketId,
        uint128 amount,
        uint64 minPriceTick
    ) external nonReentrant whenNotPaused returns (uint128 amountFilled) {
        return _executeMarketOrder(marketId, amount, minPriceTick, false, 1);
    }

    /**
     * @dev Execute a market sell order with leverage and slippage protection
     * @param marketId Market identifier
     * @param amount Amount to sell with 18 decimals
     * @param minPriceTick Minimum acceptable price per unit
     * @param leverage Leverage multiplier (1x to 100x)
     * @return amountFilled Actual amount filled
     */
    function marketSellWithLeverage(
        bytes32 marketId,
        uint128 amount,
        uint64 minPriceTick,
        uint256 leverage
    ) external nonReentrant whenNotPaused returns (uint128 amountFilled) {
        require(leverage >= 1 && leverage <= 100, "TradingRouter: invalid leverage");
        return _executeMarketOrder(marketId, amount, minPriceTick, false, leverage);
    }

    /**
     * @dev Internal function to execute market orders with slippage protection
     */
    function _executeMarketOrder(
        bytes32 marketId,
        uint128 amount,
        uint64 priceTick,
        bool isBuy,
        uint256 leverage
    ) internal returns (uint128 amountFilled) {
        require(amount > 0, "TradingRouter: amount must be greater than 0");
        
        OrderBook orderBook = _getOrderBook(marketId);
        bool isMarginOrder = (leverage > 1);

        // Get current best price for slippage check
        uint256 bestPrice = isBuy ? orderBook.bestAsk() : orderBook.bestBid();
        uint256 limitPrice = uint256(priceTick); // Keep as 6 decimals for USDC precision
        
        // Slippage protection
        if (isBuy && bestPrice > limitPrice) {
            revert("TradingRouter: price exceeds maximum");
        }
        if (!isBuy && bestPrice < limitPrice) {
            revert("TradingRouter: price below minimum");
        }

        // Execute market order
        uint256 filledAmount;
        if (isMarginOrder) {
            filledAmount = orderBook.placeMarginMarketOrder(uint256(amount), isBuy);
        } else {
            filledAmount = orderBook.placeMarketOrder(uint256(amount), isBuy);
        }

        amountFilled = uint128(filledAmount);

        // Update statistics
        uint256 notionalValue = (filledAmount * bestPrice) / 1e18;
        _updateTradingStats(marketId, msg.sender, notionalValue, 0);

        // Update last trade price
        lastTradePrices[marketId] = bestPrice;

        emit MarketOrderExecuted(
            msg.sender,
            marketId,
            isBuy ? OrderSide.BUY : OrderSide.SELL,
            amount,
            amountFilled,
            leverage
        );

        return amountFilled;
    }

    /**
     * @dev Cancel an existing order
     * @param marketId Market identifier
     * @param orderId Order ID to cancel
     */
    function cancelOrder(
        bytes32 marketId,
        bytes32 orderId
    ) external nonReentrant whenNotPaused {
        OrderBook orderBook = _getOrderBook(marketId);
        orderBook.cancelOrder(uint256(orderId));
    }

    /**
     * @dev Cancel multiple orders across different markets
     * @param marketIds Array of market identifiers
     * @param orderIds Array of order IDs to cancel
     */
    function batchCancelOrders(
        bytes32[] calldata marketIds,
        bytes32[] calldata orderIds
    ) external nonReentrant whenNotPaused {
        require(marketIds.length == orderIds.length, "TradingRouter: array length mismatch");
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            OrderBook orderBook = _getOrderBook(marketIds[i]);
            orderBook.cancelOrder(uint256(orderIds[i]));
        }
    }

    // ============ Portfolio & Data Aggregation ============

    /**
     * @dev Get all active orders for a user across all markets
     * @param user User address
     * @return marketIds Array of market identifiers
     * @return orderIds Array of order ID arrays per market
     * @return orders Array of order arrays per market
     */
    function getUserActiveOrders(address user) external view returns (
        bytes32[] memory marketIds,
        bytes32[][] memory orderIds,
        OrderBook.Order[][] memory orders
    ) {
        bytes32[] memory allMarkets = ORDER_BOOK_FACTORY.getAllMarkets();
        
        // Count markets with active orders
        uint256 activeMarketCount = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            OrderBook orderBook = OrderBook(ORDER_BOOK_FACTORY.getOrderBookForMarket(allMarkets[i]));
            uint256[] memory userOrderIds = orderBook.getUserOrders(user);
            if (userOrderIds.length > 0) {
                activeMarketCount++;
            }
        }

        // Initialize return arrays
        marketIds = new bytes32[](activeMarketCount);
        orderIds = new bytes32[][](activeMarketCount);
        orders = new OrderBook.Order[][](activeMarketCount);

        // Populate data
        uint256 marketIndex = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            OrderBook orderBook = OrderBook(ORDER_BOOK_FACTORY.getOrderBookForMarket(allMarkets[i]));
            uint256[] memory userOrderIds = orderBook.getUserOrders(user);
            
            if (userOrderIds.length > 0) {
                marketIds[marketIndex] = allMarkets[i];
                orderIds[marketIndex] = new bytes32[](userOrderIds.length);
                orders[marketIndex] = new OrderBook.Order[](userOrderIds.length);
                
                for (uint256 j = 0; j < userOrderIds.length; j++) {
                    orderIds[marketIndex][j] = bytes32(userOrderIds[j]);
                    (
                        uint256 orderId,
                        address trader,
                        uint256 price,
                        uint256 amount,
                        bool isBuy,
                        uint256 timestamp,
                        uint256 nextOrderId,
                        uint256 marginRequired,
                        bool isMarginOrder
                    ) = orderBook.orders(userOrderIds[j]);
                    
                    orders[marketIndex][j] = OrderBook.Order({
                        orderId: orderId,
                        trader: trader,
                        price: price,
                        amount: amount,
                        isBuy: isBuy,
                        timestamp: timestamp,
                        nextOrderId: nextOrderId,
                        marginRequired: marginRequired,
                        isMarginOrder: isMarginOrder
                    });
                }
                marketIndex++;
            }
        }

        return (marketIds, orderIds, orders);
    }

    /**
     * @dev Get market price data for multiple markets
     * @param marketIds Array of market identifiers
     * @return priceData Array of market price data
     */
    function getMultiMarketData(bytes32[] calldata marketIds) external view returns (MarketPriceData[] memory priceData) {
        priceData = new MarketPriceData[](marketIds.length);
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 marketId = marketIds[i];
            address orderBookAddress = ORDER_BOOK_FACTORY.getOrderBookForMarket(marketId);
            
            if (orderBookAddress != address(0)) {
                OrderBook orderBook = OrderBook(orderBookAddress);
                
                uint256 bestBid = orderBook.bestBid();
                uint256 bestAsk = orderBook.bestAsk();
                uint256 lastPrice = lastTradePrices[marketId];
                
                // Calculate mid price and spread
                uint256 midPrice = 0;
                uint256 spread = 0;
                uint256 spreadBps = 0;
                bool isValid = false;
                
                if (bestBid > 0 && bestAsk < type(uint256).max) {
                    midPrice = (bestBid + bestAsk) / 2;
                    spread = bestAsk - bestBid;
                    spreadBps = (spread * 10000) / midPrice;
                    isValid = true;
                }
                
                // Use last trade price if no mid price available
                if (midPrice == 0 && lastPrice > 0) {
                    midPrice = lastPrice;
                    isValid = true;
                }
                
                priceData[i] = MarketPriceData({
                    marketId: marketId,
                    midPrice: midPrice,
                    bestBid: bestBid,
                    bestAsk: bestAsk,
                    lastPrice: lastPrice,
                    spread: spread,
                    spreadBps: spreadBps,
                    isValid: isValid,
                    source: ORDER_BOOK_FACTORY.getMarketSymbol(marketId)
                });
            } else {
                // Market not found
                priceData[i] = MarketPriceData({
                    marketId: marketId,
                    midPrice: 0,
                    bestBid: 0,
                    bestAsk: 0,
                    lastPrice: 0,
                    spread: 0,
                    spreadBps: 0,
                    isValid: false,
                    source: ""
                });
            }
        }
        
        return priceData;
    }

    /**
     * @dev Get user's portfolio value across all markets
     * @param user User address
     * @return totalValue Total portfolio value
     * @return marketExposures Array of market exposures
     */
    function getUserPortfolioValue(address user) external view returns (
        uint256 totalValue,
        int256[] memory marketExposures
    ) {
        CentralizedVault.MarginSummary memory marginSummary = VAULT_ROUTER.getMarginSummary(user);
        CentralizedVault.Position[] memory positions = VAULT_ROUTER.getUserPositions(user);
        
        totalValue = uint256(marginSummary.portfolioValue);
        marketExposures = new int256[](positions.length);
        
        for (uint256 i = 0; i < positions.length; i++) {
            marketExposures[i] = positions[i].size;
        }
        
        return (totalValue, marketExposures);
    }

    // ============ Advanced Analytics Features ============

    /**
     * @dev Get detailed position breakdowns for a user
     * @param user User address
     * @return breakdowns Array of position breakdowns
     * @return summary Portfolio summary
     */
    function getUserPositionBreakdowns(address user) external view returns (
        PositionBreakdown[] memory breakdowns,
        PositionPortfolioSummary memory summary
    ) {
        CentralizedVault.Position[] memory positions = VAULT_ROUTER.getUserPositions(user);
        breakdowns = new PositionBreakdown[](positions.length);
        
        uint256 profitableCount = 0;
        int256 totalUnrealizedPnL = 0;
        uint256 totalNotionalValue = 0;
        uint256 totalMarginLocked = 0;
        uint256 totalMarginUtilization = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            CentralizedVault.Position memory position = positions[i];
            
            // Get current market price
            address orderBookAddress = ORDER_BOOK_FACTORY.getOrderBookForMarket(position.marketId);
            uint256 currentPrice = 0;
            
            if (orderBookAddress != address(0)) {
                OrderBook orderBook = OrderBook(orderBookAddress);
                uint256 bestBid = orderBook.bestBid();
                uint256 bestAsk = orderBook.bestAsk();
                
                if (bestBid > 0 && bestAsk < type(uint256).max) {
                    currentPrice = (bestBid + bestAsk) / 2;
                } else if (lastTradePrices[position.marketId] > 0) {
                    currentPrice = lastTradePrices[position.marketId];
                }
            }
            
            // Calculate position metrics
            bool isLong = position.size > 0;
            uint256 absSize = uint256(isLong ? position.size : -position.size);
            uint256 notionalValue = (absSize * currentPrice) / 1e18;
            
            // Calculate unrealized P&L
            int256 unrealizedPnL = 0;
            uint256 unrealizedPnLPercent = 0;
            bool isProfitable = false;
            
            if (currentPrice > 0 && position.entryPrice > 0) {
                if (isLong) {
                    // Long position: profit when current > entry
                    unrealizedPnL = int256((currentPrice * absSize) / 1e18) - int256((position.entryPrice * absSize) / 1e18);
                    isProfitable = currentPrice > position.entryPrice;
                } else {
                    // Short position: profit when entry > current
                    unrealizedPnL = int256((position.entryPrice * absSize) / 1e18) - int256((currentPrice * absSize) / 1e18);
                    isProfitable = position.entryPrice > currentPrice;
                }
                
                // Calculate percentage
                if (position.entryPrice > 0) {
                    uint256 priceDiff = currentPrice > position.entryPrice ? 
                        currentPrice - position.entryPrice : 
                        position.entryPrice - currentPrice;
                    unrealizedPnLPercent = (priceDiff * 10000) / position.entryPrice;
                }
            }
            
            // Calculate margin utilization
            uint256 marginUtilization = 0;
            if (notionalValue > 0) {
                marginUtilization = (position.marginLocked * 10000) / notionalValue;
            }
            
            breakdowns[i] = PositionBreakdown({
                marketId: position.marketId,
                size: position.size,
                entryPrice: position.entryPrice,
                currentPrice: currentPrice,
                marginLocked: position.marginLocked,
                timestamp: position.timestamp,
                unrealizedPnL: unrealizedPnL,
                unrealizedPnLPercent: unrealizedPnLPercent,
                notionalValue: notionalValue,
                marginUtilization: marginUtilization,
                isLong: isLong,
                isProfitable: isProfitable
            });
            
            // Aggregate for summary
            if (isProfitable) profitableCount++;
            totalUnrealizedPnL += unrealizedPnL;
            totalNotionalValue += notionalValue;
            totalMarginLocked += position.marginLocked;
            totalMarginUtilization += marginUtilization;
        }
        
        // Calculate portfolio concentration
        uint256 portfolioConcentration = _calculatePortfolioConcentration(breakdowns);
        
        summary = PositionPortfolioSummary({
            totalPositions: positions.length,
            profitablePositions: profitableCount,
            totalUnrealizedPnL: totalUnrealizedPnL,
            totalNotionalValue: totalNotionalValue,
            totalMarginLocked: totalMarginLocked,
            averageMarginUtilization: positions.length > 0 ? totalMarginUtilization / positions.length : 0,
            portfolioConcentration: portfolioConcentration
        });
        
        return (breakdowns, summary);
    }

    /**
     * @dev Get comprehensive user trading data in one call
     * @param user User address
     * @return positions User positions from vault
     * @return activeOrderMarkets Markets with active orders
     * @return activeOrderIds Order IDs per market
     * @return activeOrders Orders per market
     * @return portfolioValue Total portfolio value
     * @return marketExposures Market exposure array
     * @return marginSummary Margin summary from vault
     */
    function getUserTradingData(address user) external view returns (
        CentralizedVault.Position[] memory positions,
        bytes32[] memory activeOrderMarkets,
        bytes32[][] memory activeOrderIds,
        OrderBook.Order[][] memory activeOrders,
        uint256 portfolioValue,
        int256[] memory marketExposures,
        CentralizedVault.MarginSummary memory marginSummary
    ) {
        // Get positions and margin data from vault
        positions = VAULT_ROUTER.getUserPositions(user);
        marginSummary = VAULT_ROUTER.getMarginSummary(user);
        portfolioValue = uint256(marginSummary.portfolioValue);
        
        // Get market exposures
        marketExposures = new int256[](positions.length);
        for (uint256 i = 0; i < positions.length; i++) {
            marketExposures[i] = positions[i].size;
        }
        
        // Get active orders
        (activeOrderMarkets, activeOrderIds, activeOrders) = this.getUserActiveOrders(user);
        
        return (
            positions,
            activeOrderMarkets,
            activeOrderIds,
            activeOrders,
            portfolioValue,
            marketExposures,
            marginSummary
        );
    }

    // ============ Cross-Market Features ============

    /**
     * @dev Detect arbitrage opportunities between two markets
     * @param marketId1 First market identifier
     * @param marketId2 Second market identifier
     * @return priceDifference Absolute price difference
     * @return potentialProfit Potential profit in basis points
     * @return direction True if market1 > market2, false otherwise
     */
    function detectArbitrage(bytes32 marketId1, bytes32 marketId2) external view returns (
        uint256 priceDifference,
        uint256 potentialProfit,
        bool direction
    ) {
        bytes32[] memory marketIds = new bytes32[](2);
        marketIds[0] = marketId1;
        marketIds[1] = marketId2;
        
        MarketPriceData[] memory priceData = this.getMultiMarketData(marketIds);
        
        if (priceData[0].isValid && priceData[1].isValid) {
            uint256 price1 = priceData[0].midPrice;
            uint256 price2 = priceData[1].midPrice;
            
            if (price1 > price2) {
                priceDifference = price1 - price2;
                potentialProfit = (priceDifference * 10000) / price2;
                direction = true;
            } else {
                priceDifference = price2 - price1;
                potentialProfit = (priceDifference * 10000) / price1;
                direction = false;
            }
        }
        
        return (priceDifference, potentialProfit, direction);
    }

    /**
     * @dev Get spreads for multiple markets
     * @param marketIds Array of market identifiers
     * @return spreads Array of spreads in absolute terms
     * @return spreadsBps Array of spreads in basis points
     */
    function getMultiMarketSpreads(bytes32[] calldata marketIds) external view returns (
        uint256[] memory spreads,
        uint256[] memory spreadsBps
    ) {
        MarketPriceData[] memory priceData = this.getMultiMarketData(marketIds);
        
        spreads = new uint256[](marketIds.length);
        spreadsBps = new uint256[](marketIds.length);
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            spreads[i] = priceData[i].spread;
            spreadsBps[i] = priceData[i].spreadBps;
        }
        
        return (spreads, spreadsBps);
    }

    // ============ Statistics & Tracking ============

    /**
     * @dev Update trading statistics (called by OrderBooks)
     * @param marketId Market identifier
     * @param user User address
     * @param volume Trade volume
     * @param fees Fees paid
     */
    function updateTradingStats(
        bytes32 marketId,
        address user,
        uint256 volume,
        uint256 fees
    ) external onlyRole(UPDATER_ROLE) {
        _updateTradingStats(marketId, user, volume, fees);
    }

    /**
     * @dev Internal function to update trading statistics
     */
    function _updateTradingStats(
        bytes32 marketId,
        address user,
        uint256 volume,
        uint256 fees
    ) internal {
        globalStats.totalTrades++;
        globalStats.totalVolume += volume;
        globalStats.totalFees += fees;
        
        marketVolumes[marketId] += volume;
        userTrades[user]++;
        
        emit TradingStatsUpdated(marketId, user, volume, fees);
    }

    /**
     * @dev Get global trading statistics
     * @return totalTrades Total number of trades
     * @return totalVolume Total trading volume
     * @return totalFees Total fees collected
     */
    function getTradingStats() external view returns (
        uint256 totalTrades,
        uint256 totalVolume,
        uint256 totalFees
    ) {
        return (globalStats.totalTrades, globalStats.totalVolume, globalStats.totalFees);
    }

    /**
     * @dev Get trading volume for a specific market
     * @param marketId Market identifier
     * @return volume Total volume for the market
     */
    function getMarketVolume(bytes32 marketId) external view returns (uint256 volume) {
        return marketVolumes[marketId];
    }

    /**
     * @dev Get trade count for a specific user
     * @param user User address
     * @return tradeCount Total trades by the user
     */
    function getUserTradeCount(address user) external view returns (uint256 tradeCount) {
        return userTrades[user];
    }

    // ============ Utility Functions ============

    /**
     * @dev Get OrderBook contract for a market
     * @param marketId Market identifier
     * @return OrderBook contract instance
     */
    function _getOrderBook(bytes32 marketId) internal view returns (OrderBook) {
        address orderBookAddress = ORDER_BOOK_FACTORY.getOrderBookForMarket(marketId);
        require(orderBookAddress != address(0), "TradingRouter: market not found");
        return OrderBook(orderBookAddress);
    }

    /**
     * @dev Calculate portfolio concentration risk
     * @param breakdowns Array of position breakdowns
     * @return concentration Concentration in basis points
     */
    function _calculatePortfolioConcentration(PositionBreakdown[] memory breakdowns) internal pure returns (uint256) {
        if (breakdowns.length == 0) return 0;
        if (breakdowns.length == 1) return 10000; // 100% concentration
        
        uint256 totalNotional = 0;
        uint256 maxPositionNotional = 0;
        
        // Calculate total notional and find largest position
        for (uint256 i = 0; i < breakdowns.length; i++) {
            totalNotional += breakdowns[i].notionalValue;
            if (breakdowns[i].notionalValue > maxPositionNotional) {
                maxPositionNotional = breakdowns[i].notionalValue;
            }
        }
        
        // Calculate concentration as percentage of largest position
        if (totalNotional > 0) {
            return (maxPositionNotional * 10000) / totalNotional;
        }
        
        return 0;
    }

    /**
     * @dev Get position breakdown for a specific market
     * @param user User address
     * @param marketId Market identifier
     * @return breakdown Position breakdown
     * @return hasPosition Whether user has a position
     */
    function getUserPositionBreakdownByMarket(address user, bytes32 marketId) external view returns (
        PositionBreakdown memory breakdown,
        bool hasPosition
    ) {
        CentralizedVault.Position[] memory positions = VAULT_ROUTER.getUserPositions(user);
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                (PositionBreakdown[] memory breakdowns,) = this.getUserPositionBreakdowns(user);
                
                // Find the matching breakdown
                for (uint256 j = 0; j < breakdowns.length; j++) {
                    if (breakdowns[j].marketId == marketId) {
                        return (breakdowns[j], true);
                    }
                }
            }
        }
        
        // Return empty breakdown if no position found
        return (PositionBreakdown({
            marketId: marketId,
            size: 0,
            entryPrice: 0,
            currentPrice: 0,
            marginLocked: 0,
            timestamp: 0,
            unrealizedPnL: 0,
            unrealizedPnLPercent: 0,
            notionalValue: 0,
            marginUtilization: 0,
            isLong: false,
            isProfitable: false
        }), false);
    }

    // ============ Administrative Functions ============

    /**
     * @dev Pause the contract (emergency function)
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }


    /**
     * @dev Grant UPDATER_ROLE to OrderBook contracts
     * @param orderBook OrderBook address
     */
    function grantUpdaterRole(address orderBook) external onlyRole(ADMIN_ROLE) {
        _grantRole(UPDATER_ROLE, orderBook);
    }

    /**
     * @dev Revoke UPDATER_ROLE from an address
     * @param account Address to revoke role from
     */
    function revokeUpdaterRole(address account) external onlyRole(ADMIN_ROLE) {
        _revokeRole(UPDATER_ROLE, account);
    }
}
