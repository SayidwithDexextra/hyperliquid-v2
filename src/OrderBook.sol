// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICentralizedVault {
    function lockMargin(address user, bytes32 marketId, uint256 amount) external;
    function releaseMargin(address user, bytes32 marketId, uint256 amount) external;
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external;
    function unreserveMargin(address user, bytes32 orderId) external;
    function releaseExcessMargin(address user, bytes32 orderId, uint256 actualMarginNeeded) external;
    function updatePosition(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice) external;
    function updatePositionWithMargin(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice, uint256 marginToLock) external;
    function deductFees(address user, uint256 feeAmount, address feeRecipient) external;
    function transferCollateral(address from, address to, uint256 amount) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    
    // Position information for better margin management
    function getPositionNettingSummary(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 entryPrice
    ) external view returns (
        string memory summary,
        uint256 realizedPnL,
        bool isProfit,
        uint256 closedUnits,
        int256 finalSize
    );
}

/**
 * @title OrderBook
 * @dev A centralized exchange-style order book smart contract with margin trading
 * @notice Implements limit and market orders with FIFO matching and vault integration
 */
contract OrderBook {
    // Constants for precision - aligned with USDC pricing
    uint256 public constant PRICE_DECIMALS = 6;   // USDC has 6 decimals
    uint256 public constant AMOUNT_DECIMALS = 18;  // Standard 18 decimals for amounts
    uint256 public constant PRICE_SCALE = 10**PRICE_DECIMALS;
    uint256 public constant AMOUNT_SCALE = 10**AMOUNT_DECIMALS;

    // Order structure
    struct Order {
        uint256 orderId;
        address trader;
        uint256 price;      // Price with 6 decimals (USDC)
        uint256 amount;     // Remaining amount with 18 decimals
        bool isBuy;
        uint256 timestamp;
        uint256 nextOrderId; // For linked list implementation
        uint256 marginRequired; // Margin required for this order
        bool isMarginOrder; // Whether this order uses margin
    }

    // Price level structure for efficient order management
    struct PriceLevel {
        uint256 totalAmount;
        uint256 firstOrderId; // Head of linked list
        uint256 lastOrderId;  // Tail of linked list
        bool exists;
    }

    // State variables
    mapping(uint256 => Order) public orders;
    mapping(uint256 => PriceLevel) public buyLevels;  // price => PriceLevel
    mapping(uint256 => PriceLevel) public sellLevels; // price => PriceLevel
    mapping(address => uint256[]) public userOrders;  // trader => orderIds[]

    uint256 public nextOrderId = 1;
    uint256 public bestBid = 0;     // Highest buy price
    uint256 public bestAsk = type(uint256).max; // Lowest sell price

    // Arrays to track all price levels for iteration
    uint256[] public buyPrices;
    uint256[] public sellPrices;
    mapping(uint256 => bool) public buyPriceExists;
    mapping(uint256 => bool) public sellPriceExists;

    // Vault integration
    ICentralizedVault public immutable vault;
    bytes32 public immutable marketId;
    
    // Trading parameters
    uint256 public marginRequirementBps = 10000; // 100% margin requirement by default (1:1, basis points)
    uint256 public tradingFee = 10; // 0.1% trading fee (basis points)
    address public feeRecipient;
    uint256 public maxSlippageBps = 500; // 5% maximum slippage for market orders (basis points)
    
    // Leverage control system
    bool public leverageEnabled = false; // Leverage disabled by default
    uint256 public maxLeverage = 1; // 1x leverage (1:1 margin) by default
    address public leverageController; // Who can enable/disable leverage
    
    // Position tracking for margin calculations
    mapping(address => int256) public userPositions; // user => position size
    
    // Order tracking for viewer functions  
    mapping(uint256 => uint256) public filledAmounts; // orderId => filled amount
    mapping(uint256 => uint256) public cumulativeMarginUsed; // orderId => cumulative margin used for executed portions
    uint256 public lastTradePrice = 1000000; // Last trade price, default to 1 USDC

    // ============ Trade History System ============
    
    struct Trade {
        uint256 tradeId;           // Unique trade identifier
        address buyer;             // Buyer address
        address seller;            // Seller address
        uint256 price;             // Trade price (6 decimals)
        uint256 amount;            // Trade amount (18 decimals)
        uint256 timestamp;         // Block timestamp
        uint256 buyOrderId;        // Buy order ID (0 for market orders)
        uint256 sellOrderId;       // Sell order ID (0 for market orders)
        bool buyerIsMargin;        // Whether buyer used margin
        bool sellerIsMargin;       // Whether seller used margin
        uint256 tradeValue;        // Trade value in USDC (6 decimals)
        uint256 buyerFee;          // Fee paid by buyer (6 decimals)
        uint256 sellerFee;         // Fee paid by seller (6 decimals)
    }
    
    // Trade storage
    mapping(uint256 => Trade) public trades;
    uint256 public nextTradeId = 1;
    uint256 public totalTradeCount = 0;
    
    // User trade history
    mapping(address => uint256[]) public userTradeIds;
    
    // Pagination constants
    uint256 public constant MAX_TRADES_PER_QUERY = 100;
    
    // ============ VWAP System ============
    
    // VWAP configuration
    uint256 public vwapTimeWindow = 3600; // Default 1 hour window in seconds
    uint256 public minVolumeForVWAP = 100 * AMOUNT_SCALE; // Minimum 100 units volume for valid VWAP
    bool public useVWAPForMarkPrice = true; // Enable/disable VWAP for mark price
    
    // Circular buffer for trade history (for efficient VWAP calculation)
    uint256 public constant MAX_TRADE_HISTORY = 1000; // Store last 1000 trades
    uint256[] public tradeHistoryIds; // Circular buffer of trade IDs
    uint256 public tradeHistoryStart = 0; // Start index in circular buffer
    uint256 public tradeHistoryCount = 0; // Number of trades in buffer
    
    // Cumulative values for different time windows (gas optimization)
    struct VWAPData {
        uint256 cumulativeValue; // Sum of (price * volume)
        uint256 cumulativeVolume; // Sum of volumes
        uint256 lastUpdateTime;
        uint256 tradeCount;
    }
    
    mapping(uint256 => VWAPData) public vwapWindows; // timeWindow => VWAPData
    uint256[] public supportedTimeWindows = [300, 900, 3600, 14400, 86400]; // 5m, 15m, 1h, 4h, 24h
    
    // Trade events
    event TradeExecuted(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 amount,
        uint256 tradeValue,
        uint256 timestamp
    );

    // Events
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy, bool isMarginOrder);
    event OrderMatched(address indexed buyer, address indexed seller, uint256 price, uint256 amount);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 filledAmount, uint256 remainingAmount);
    event PositionUpdated(address indexed trader, int256 oldPosition, int256 newPosition);
    event MarginOrderPlaced(uint256 indexed orderId, address indexed trader, uint256 marginRequired);
    event DebugMarginRelease(address indexed user, uint256 orderId, uint256 executionPrice, uint256 amount, bool isMarginOrder);
    
    // Leverage control events
    event LeverageEnabled(address indexed controller, uint256 maxLeverage, uint256 newMarginRequirement);
    event LeverageDisabled(address indexed controller);
    event LeverageControllerUpdated(address indexed oldController, address indexed newController);
    event MarginRequirementUpdated(uint256 oldRequirement, uint256 newRequirement);
    event TradingParametersUpdated(uint256 marginRequirement, uint256 tradingFee, address feeRecipient);
    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    event OrderModified(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed trader, uint256 newPrice, uint256 newAmount);
    
    // VWAP events
    event VWAPConfigUpdated(uint256 timeWindow, uint256 minVolume, bool useVWAP);
    event VWAPCalculated(uint256 vwap, uint256 volume, uint256 tradeCount, uint256 timeWindow);

    // Modifiers
    modifier validOrder(uint256 price, uint256 amount) {
        require(price > 0, "Price must be greater than 0");
        require(amount > 0, "Amount must be greater than 0");
        _;
    }

    modifier orderExists(uint256 orderId) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        _;
    }

    modifier onlyOrderOwner(uint256 orderId) {
        require(orders[orderId].trader == msg.sender, "Not order owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == feeRecipient, "Only admin can call this function");
        _;
    }
    
    modifier onlyLeverageController() {
        require(msg.sender == leverageController, "OrderBook: only leverage controller");
        _;
    }
    
    modifier leverageAllowed() {
        require(leverageEnabled, "OrderBook: leverage is disabled for this market");
        _;
    }
    
    modifier marginOrderAllowed() {
        // Allow margin orders if:
        // 1. Leverage is enabled (any leverage), OR
        // 2. This is a 1:1 margin order (marginRequirementBps == 10000)
        require(
            leverageEnabled || marginRequirementBps == 10000, 
            "OrderBook: margin orders require leverage to be enabled or 1:1 margin"
        );
        _;
    }

    // ============ Constructor ============

    constructor(
        address _vault,
        bytes32 _marketId,
        address _feeRecipient
    ) {
        require(_vault != address(0), "OrderBook: vault cannot be zero address");
        require(_feeRecipient != address(0), "OrderBook: fee recipient cannot be zero address");
        
        vault = ICentralizedVault(_vault);
        marketId = _marketId;
        feeRecipient = _feeRecipient;
        leverageController = _feeRecipient; // Initially set fee recipient as leverage controller
    }

    /**
     * @dev Place a limit order
     * @param price Price with 6 decimals (USDC)
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return orderId The ID of the placed order
     */
    function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) 
        external 
        validOrder(price, amount) 
        returns (uint256 orderId) 
    {
        return _placeLimitOrder(price, amount, isBuy, false, 0);
    }

    /**
     * @dev Place a margin limit order
     * @param price Price with 6 decimals (USDC)
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return orderId The ID of the placed order
     */
    function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) 
        external 
        validOrder(price, amount) 
        marginOrderAllowed
        returns (uint256 orderId) 
    {
        // For limit orders, we'll calculate margin based on the worst-case execution price
        // For buy orders: use the limit price (worst case is paying full limit price)
        // For sell orders: use the limit price (worst case is selling at full limit price)
        uint256 marginRequired = _calculateMarginRequired(amount, price);
        
        return _placeLimitOrder(price, amount, isBuy, true, marginRequired);
    }

    /**
     * @dev Internal function to place limit orders
     */
    function _placeLimitOrder(
        uint256 price, 
        uint256 amount, 
        bool isBuy, 
        bool isMarginOrder, 
        uint256 marginRequired
    ) internal returns (uint256 orderId) {
        orderId = nextOrderId++;
        
        // For margin orders, reserve margin in vault
        if (isMarginOrder) {
            vault.reserveMargin(msg.sender, bytes32(orderId), marketId, marginRequired);
        }
        
        // Create the order
        Order memory newOrder = Order({
            orderId: orderId,
            trader: msg.sender,
            price: price,
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: marginRequired,
            isMarginOrder: isMarginOrder
        });

        // Check if order can be immediately matched
        uint256 remainingAmount = amount;
        
        if (isBuy) {
            // Buy order: match against sell orders at or below this price
            remainingAmount = _matchBuyOrder(newOrder, remainingAmount);
        } else {
            // Sell order: match against buy orders at or above this price
            remainingAmount = _matchSellOrder(newOrder, remainingAmount);
        }

        // If there's remaining amount, add to order book
        if (remainingAmount > 0) {
            newOrder.amount = remainingAmount;
            orders[orderId] = newOrder;
            userOrders[msg.sender].push(orderId);
            
            if (isBuy) {
                _addToBuyBook(orderId, price, remainingAmount);
            } else {
                _addToSellBook(orderId, price, remainingAmount);
            }
            
            emit OrderPlaced(orderId, msg.sender, price, remainingAmount, isBuy, isMarginOrder);
            
            if (isMarginOrder) {
                emit MarginOrderPlaced(orderId, msg.sender, marginRequired);
            }
        } else {
            // Order was fully filled immediately - unreserve margin if it's a margin order
            if (isMarginOrder) {
                vault.unreserveMargin(msg.sender, bytes32(orderId));
            }
            
            // Still emit OrderPlaced event even for fully filled orders
            emit OrderPlaced(orderId, msg.sender, price, 0, isBuy, isMarginOrder);
        }

        return orderId;
    }

    /**
     * @dev Place a market order
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return filledAmount The amount that was filled
     */
    function placeMarketOrder(uint256 amount, bool isBuy) 
        external 
        returns (uint256 filledAmount) 
    {
        return _placeMarketOrder(amount, isBuy, false, maxSlippageBps);
    }

    /**
     * @dev Place a margin market order
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return filledAmount The amount that was filled
     */
    function placeMarginMarketOrder(uint256 amount, bool isBuy)
        external
        marginOrderAllowed
        returns (uint256 filledAmount)
    {
        return _placeMarketOrder(amount, isBuy, true, maxSlippageBps);
    }

    /**
     * @dev Place a market order with custom slippage tolerance
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @param slippageBps Maximum slippage in basis points
     * @return filledAmount The amount that was filled
     */
    function placeMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) 
        external 
        returns (uint256 filledAmount) 
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high"); // Max 50% slippage
        return _placeMarketOrder(amount, isBuy, false, slippageBps);
    }

    /**
     * @dev Place a margin market order with custom slippage tolerance
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @param slippageBps Maximum slippage in basis points
     * @return filledAmount The amount that was filled
     */
    function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps)
        external
        marginOrderAllowed
        returns (uint256 filledAmount)
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high"); // Max 50% slippage
        return _placeMarketOrder(amount, isBuy, true, slippageBps);
    }

    /**
     * @dev Internal function to place market orders with slippage protection
     */
    function _placeMarketOrder(uint256 amount, bool isBuy, bool isMarginOrder, uint256 slippageBps) 
        internal 
        returns (uint256 filledAmount) 
    {
        require(amount > 0, "Amount must be greater than 0");

        // Get reference price for slippage calculation
        uint256 referencePrice = isBuy ? bestAsk : bestBid;
        require(referencePrice > 0, "OrderBook: no liquidity available");
        
        // For margin market orders, check available collateral upfront
        if (isMarginOrder) {
            // Calculate worst-case margin requirement based on slippage
            uint256 worstCasePrice = isBuy ? 
                (referencePrice * (10000 + slippageBps)) / 10000 : // Buy: price could go up
                referencePrice; // Sell: use reference price (margin based on position size, not price)
                
            uint256 estimatedMargin = _calculateMarginRequired(amount, worstCasePrice);
            
            // Check if user has sufficient available collateral
            uint256 availableCollateral = vault.getAvailableCollateral(msg.sender);
            require(availableCollateral >= estimatedMargin, 
                "OrderBook: insufficient collateral for market order");
        }

        uint256 orderId = nextOrderId++;
        Order memory marketOrder = Order({
            orderId: orderId,
            trader: msg.sender,
            price: isBuy ? type(uint256).max : 0, // Market orders have extreme prices
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0, // Will be calculated during matching
            isMarginOrder: isMarginOrder
        });
        
        // Calculate slippage limits
        uint256 maxPrice = isBuy ? 
            (referencePrice * (10000 + slippageBps)) / 10000 : 
            type(uint256).max;
        uint256 minPrice = isBuy ? 
            0 : 
            (referencePrice * (10000 - slippageBps)) / 10000;

        uint256 remainingAmount = amount;
        
        if (isBuy) {
            remainingAmount = _matchBuyOrderWithSlippage(marketOrder, remainingAmount, maxPrice);
        } else {
            remainingAmount = _matchSellOrderWithSlippage(marketOrder, remainingAmount, minPrice);
        }

        filledAmount = amount - remainingAmount;
        
        // Market orders don't rest in the book - any unfilled amount is cancelled
        if (filledAmount > 0) {
            emit OrderPlaced(orderId, msg.sender, marketOrder.price, amount, isBuy, isMarginOrder);
        }
        
        return filledAmount;
    }

    /**
     * @dev Cancel an existing order
     * @param orderId The ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) 
        external 
        orderExists(orderId) 
        onlyOrderOwner(orderId) 
    {
        Order storage order = orders[orderId];
        address trader = order.trader;
        
        // Unreserve margin if it's a margin order
        if (order.isMarginOrder) {
            vault.unreserveMargin(trader, bytes32(orderId));
        }
        
        if (order.isBuy) {
            _removeFromBuyBook(orderId, order.price, order.amount);
        } else {
            _removeFromSellBook(orderId, order.price, order.amount);
        }

        // CRITICAL FIX: Remove order ID from user's order list
        _removeOrderFromUserList(trader, orderId);

        emit OrderCancelled(orderId, trader);
        delete orders[orderId];
        delete cumulativeMarginUsed[orderId];
    }

    /**
     * @dev Match a buy order against the sell book with slippage protection
     */
    function _matchBuyOrderWithSlippage(Order memory buyOrder, uint256 remainingAmount, uint256 maxPrice) 
        private 
        returns (uint256) 
    {
        // Match against sell orders starting from the lowest price (bestAsk)
        uint256 currentPrice = bestAsk;
        
        while (remainingAmount > 0 && currentPrice != type(uint256).max && currentPrice <= maxPrice) {
            if (!sellLevels[currentPrice].exists) {
                currentPrice = _getNextSellPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = sellLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage sellOrder = orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < sellOrder.amount ? remainingAmount : sellOrder.amount;
                
                // Release excess margin if buy order executes at better price
                // Do this BEFORE trade execution to ensure order still exists
                if (buyOrder.isMarginOrder && currentPrice < buyOrder.price && buyOrder.price != type(uint256).max) {
                    emit DebugMarginRelease(buyOrder.trader, buyOrder.orderId, currentPrice, matchAmount, true);
                    
                    // Calculate required margin at execution price
                    uint256 requiredMarginAtExecution = _calculateExecutionMargin(matchAmount, currentPrice);
                    
                    // Always update margin to reflect actual execution prices
                    if (remainingAmount == matchAmount) {
                        // This will be the last fill, total margin = cumulative + this execution
                        uint256 totalMarginUsed = cumulativeMarginUsed[buyOrder.orderId] + requiredMarginAtExecution;
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), totalMarginUsed);
                    } else {
                        // Partial fill - track cumulative margin and update vault
                        cumulativeMarginUsed[buyOrder.orderId] += requiredMarginAtExecution;
                        
                        // Calculate margin for remaining unfilled amount
                        uint256 remainingAfterMatch = remainingAmount - matchAmount;
                        uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price);
                        
                        // Total margin = cumulative used + margin for remaining
                        uint256 newTotalMargin = cumulativeMarginUsed[buyOrder.orderId] + marginForRemaining;
                        
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), newTotalMargin);
                        // Update the order's margin requirement for future calculations
                        buyOrder.marginRequired = marginForRemaining;
                    }
                }
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                remainingAmount -= matchAmount;
                sellOrder.amount -= matchAmount;
                level.totalAmount -= matchAmount;
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (sellOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, false);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    if (sellOrder.isMarginOrder) {
                        vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, sellOrder.amount);
                }
                
                currentOrderId = nextSellOrderId;
            }
            
            // Update bestAsk if this level is now empty
            if (!sellLevels[currentPrice].exists && currentPrice == bestAsk) {
                bestAsk = _getNextSellPrice(currentPrice);
            }
            
            currentPrice = _getNextSellPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Match a sell order against the buy book with slippage protection
     */
    function _matchSellOrderWithSlippage(Order memory sellOrder, uint256 remainingAmount, uint256 minPrice) 
        private 
        returns (uint256) 
    {
        // Match against buy orders starting from the highest price (bestBid)
        uint256 currentPrice = bestBid;
        
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice >= minPrice) {
            if (!buyLevels[currentPrice].exists) {
                currentPrice = _getPrevBuyPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = buyLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage buyOrder = orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < buyOrder.amount ? remainingAmount : buyOrder.amount;
                
                // For sell orders at better price: NO margin adjustment needed
                // When a sell order executes at a higher price, they receive more money
                // but their margin requirement doesn't change (it's based on the amount, not price received)
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                remainingAmount -= matchAmount;
                buyOrder.amount -= matchAmount;
                level.totalAmount -= matchAmount;
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (buyOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, true);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    if (buyOrder.isMarginOrder) {
                        vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, buyOrder.amount);
                }
                
                currentOrderId = nextBuyOrderId;
            }
            
            // Update bestBid if this level is now empty
            if (!buyLevels[currentPrice].exists && currentPrice == bestBid) {
                bestBid = _getPrevBuyPrice(currentPrice);
            }
            
            currentPrice = _getPrevBuyPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Match a buy order against the sell book (original function for limit orders)
     */
    function _matchBuyOrder(Order memory buyOrder, uint256 remainingAmount) 
        private 
        returns (uint256) 
    {
        // Match against sell orders starting from the lowest price (bestAsk)
        uint256 currentPrice = bestAsk;
        
        while (remainingAmount > 0 && currentPrice != type(uint256).max && currentPrice <= buyOrder.price) {
            if (!sellLevels[currentPrice].exists) {
                currentPrice = _getNextSellPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = sellLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage sellOrder = orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < sellOrder.amount ? remainingAmount : sellOrder.amount;
                
                // Release excess margin if buy order executes at better price
                // Do this BEFORE trade execution to ensure order still exists
                if (buyOrder.isMarginOrder && currentPrice < buyOrder.price && buyOrder.price != type(uint256).max) {
                    emit DebugMarginRelease(buyOrder.trader, buyOrder.orderId, currentPrice, matchAmount, true);
                    
                    // Calculate required margin at execution price
                    uint256 requiredMarginAtExecution = _calculateExecutionMargin(matchAmount, currentPrice);
                    
                    // Always update margin to reflect actual execution prices
                    if (remainingAmount == matchAmount) {
                        // This will be the last fill, total margin = cumulative + this execution
                        uint256 totalMarginUsed = cumulativeMarginUsed[buyOrder.orderId] + requiredMarginAtExecution;
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), totalMarginUsed);
                    } else {
                        // Partial fill - track cumulative margin and update vault
                        cumulativeMarginUsed[buyOrder.orderId] += requiredMarginAtExecution;
                        
                        // Calculate margin for remaining unfilled amount
                        uint256 remainingAfterMatch = remainingAmount - matchAmount;
                        uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price);
                        
                        // Total margin = cumulative used + margin for remaining
                        uint256 newTotalMargin = cumulativeMarginUsed[buyOrder.orderId] + marginForRemaining;
                        
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), newTotalMargin);
                        // Update the order's margin requirement for future calculations
                        buyOrder.marginRequired = marginForRemaining;
                    }
                }
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                remainingAmount -= matchAmount;
                sellOrder.amount -= matchAmount;
                level.totalAmount -= matchAmount;
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (sellOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, false);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    if (sellOrder.isMarginOrder) {
                        vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, sellOrder.amount);
                }
                
                currentOrderId = nextSellOrderId;
            }
            
            // Update bestAsk if this level is now empty
            if (!sellLevels[currentPrice].exists && currentPrice == bestAsk) {
                bestAsk = _getNextSellPrice(currentPrice);
            }
            
            currentPrice = _getNextSellPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Match a sell order against the buy book
     */
    function _matchSellOrder(Order memory sellOrder, uint256 remainingAmount) 
        private 
        returns (uint256) 
    {
        // Match against buy orders starting from the highest price (bestBid)
        uint256 currentPrice = bestBid;
        
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice >= sellOrder.price) {
            if (!buyLevels[currentPrice].exists) {
                currentPrice = _getPrevBuyPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = buyLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage buyOrder = orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < buyOrder.amount ? remainingAmount : buyOrder.amount;
                
                // For sell orders at better price: NO margin adjustment needed
                // When a sell order executes at a higher price, they receive more money
                // but their margin requirement doesn't change (it's based on the amount, not price received)
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                remainingAmount -= matchAmount;
                buyOrder.amount -= matchAmount;
                level.totalAmount -= matchAmount;
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (buyOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, true);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    if (buyOrder.isMarginOrder) {
                        vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, buyOrder.amount);
                }
                
                currentOrderId = nextBuyOrderId;
            }
            
            // Update bestBid if this level is now empty
            if (!buyLevels[currentPrice].exists && currentPrice == bestBid) {
                bestBid = _getPrevBuyPrice(currentPrice);
            }
            
            currentPrice = _getPrevBuyPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Add order to buy book
     */
    function _addToBuyBook(uint256 orderId, uint256 price, uint256 amount) private {
        if (!buyLevels[price].exists) {
            buyLevels[price] = PriceLevel({
                totalAmount: amount,
                firstOrderId: orderId,
                lastOrderId: orderId,
                exists: true
            });
            
            if (!buyPriceExists[price]) {
                buyPrices.push(price);
                buyPriceExists[price] = true;
            }
        } else {
            // Add to end of linked list (FIFO)
            PriceLevel storage level = buyLevels[price];
            orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        
        // Update best bid
        if (price > bestBid) {
            bestBid = price;
        }
    }

    /**
     * @dev Add order to sell book
     */
    function _addToSellBook(uint256 orderId, uint256 price, uint256 amount) private {
        if (!sellLevels[price].exists) {
            sellLevels[price] = PriceLevel({
                totalAmount: amount,
                firstOrderId: orderId,
                lastOrderId: orderId,
                exists: true
            });
            
            if (!sellPriceExists[price]) {
                sellPrices.push(price);
                sellPriceExists[price] = true;
            }
        } else {
            // Add to end of linked list (FIFO)
            PriceLevel storage level = sellLevels[price];
            orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        
        // Update best ask
        if (price < bestAsk) {
            bestAsk = price;
        }
    }

    /**
     * @dev Remove order from buy book
     */
    function _removeFromBuyBook(uint256 orderId, uint256 price, uint256 /* amount */) private {
        _removeOrderFromLevel(orderId, price, true);
        
        // Update best bid if necessary
        if (price == bestBid && !buyLevels[price].exists) {
            bestBid = _findNewBestBid();
        }
    }

    /**
     * @dev Remove order from sell book
     */
    function _removeFromSellBook(uint256 orderId, uint256 price, uint256 /* amount */) private {
        _removeOrderFromLevel(orderId, price, false);
        
        // Update best ask if necessary
        if (price == bestAsk && !sellLevels[price].exists) {
            bestAsk = _findNewBestAsk();
        }
    }

    /**
     * @dev Remove order from a price level
     */
    function _removeOrderFromLevel(uint256 orderId, uint256 price, bool isBuy) private {
        PriceLevel storage level = isBuy ? buyLevels[price] : sellLevels[price];
        Order storage order = orders[orderId];
        
        level.totalAmount -= order.amount;
        
        if (level.firstOrderId == orderId) {
            level.firstOrderId = order.nextOrderId;
            if (level.lastOrderId == orderId) {
                level.lastOrderId = 0;
            }
        } else {
            // Find previous order in linked list
            uint256 prevOrderId = level.firstOrderId;
            while (orders[prevOrderId].nextOrderId != orderId) {
                prevOrderId = orders[prevOrderId].nextOrderId;
            }
            orders[prevOrderId].nextOrderId = order.nextOrderId;
            
            if (level.lastOrderId == orderId) {
                level.lastOrderId = prevOrderId;
            }
        }
        
        if (level.totalAmount == 0) {
            level.exists = false;
            level.firstOrderId = 0;
            level.lastOrderId = 0;
        }
    }

    /**
     * @dev Find new best bid after current best bid is removed
     */
    function _findNewBestBid() private view returns (uint256) {
        uint256 newBestBid = 0;
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists && buyPrices[i] > newBestBid) {
                newBestBid = buyPrices[i];
            }
        }
        return newBestBid;
    }

    /**
     * @dev Find new best ask after current best ask is removed
     */
    function _findNewBestAsk() private view returns (uint256) {
        uint256 newBestAsk = type(uint256).max;
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists && sellPrices[i] < newBestAsk) {
                newBestAsk = sellPrices[i];
            }
        }
        return newBestAsk;
    }

    /**
     * @dev Get next higher sell price
     */
    function _getNextSellPrice(uint256 currentPrice) private view returns (uint256) {
        uint256 nextPrice = type(uint256).max;
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists && sellPrices[i] > currentPrice && sellPrices[i] < nextPrice) {
                nextPrice = sellPrices[i];
            }
        }
        return nextPrice;
    }

    /**
     * @dev Get next lower buy price
     */
    function _getPrevBuyPrice(uint256 currentPrice) private view returns (uint256) {
        uint256 prevPrice = 0;
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists && buyPrices[i] < currentPrice && buyPrices[i] > prevPrice) {
                prevPrice = buyPrices[i];
            }
        }
        return prevPrice;
    }

    // View functions

    /**
     * @dev Get order book depth for a given number of levels
     * @param levels Number of price levels to return
     * @return bidPrices Array of buy prices
     * @return bidAmounts Array of buy amounts
     * @return askPrices Array of sell prices  
     * @return askAmounts Array of sell amounts
     */
    function getOrderBookDepth(uint256 levels) 
        external 
        view 
        returns (
            uint256[] memory bidPrices,
            uint256[] memory bidAmounts,
            uint256[] memory askPrices,
            uint256[] memory askAmounts
        ) 
    {
        // Get buy side (bids)
        uint256[] memory allBuyPrices = new uint256[](buyPrices.length);
        uint256[] memory allBuyAmounts = new uint256[](buyPrices.length);
        uint256 buyCount = 0;
        
        // Sort buy prices in descending order
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists) {
                allBuyPrices[buyCount] = buyPrices[i];
                allBuyAmounts[buyCount] = buyLevels[buyPrices[i]].totalAmount;
                buyCount++;
            }
        }
        
        // Simple bubble sort for buy prices (descending)
        if (buyCount > 1) {
            for (uint256 i = 0; i < buyCount - 1; i++) {
                for (uint256 j = 0; j < buyCount - i - 1; j++) {
                    if (allBuyPrices[j] < allBuyPrices[j + 1]) {
                        (allBuyPrices[j], allBuyPrices[j + 1]) = (allBuyPrices[j + 1], allBuyPrices[j]);
                        (allBuyAmounts[j], allBuyAmounts[j + 1]) = (allBuyAmounts[j + 1], allBuyAmounts[j]);
                    }
                }
            }
        }
        
        // Get sell side (asks)
        uint256[] memory allSellPrices = new uint256[](sellPrices.length);
        uint256[] memory allSellAmounts = new uint256[](sellPrices.length);
        uint256 sellCount = 0;
        
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists) {
                allSellPrices[sellCount] = sellPrices[i];
                allSellAmounts[sellCount] = sellLevels[sellPrices[i]].totalAmount;
                sellCount++;
            }
        }
        
        // Simple bubble sort for sell prices (ascending)
        if (sellCount > 1) {
            for (uint256 i = 0; i < sellCount - 1; i++) {
                for (uint256 j = 0; j < sellCount - i - 1; j++) {
                    if (allSellPrices[j] > allSellPrices[j + 1]) {
                        (allSellPrices[j], allSellPrices[j + 1]) = (allSellPrices[j + 1], allSellPrices[j]);
                        (allSellAmounts[j], allSellAmounts[j + 1]) = (allSellAmounts[j + 1], allSellAmounts[j]);
                    }
                }
            }
        }
        
        // Return requested number of levels
        uint256 bidLevels = buyCount < levels ? buyCount : levels;
        uint256 askLevels = sellCount < levels ? sellCount : levels;
        
        bidPrices = new uint256[](bidLevels);
        bidAmounts = new uint256[](bidLevels);
        askPrices = new uint256[](askLevels);
        askAmounts = new uint256[](askLevels);
        
        for (uint256 i = 0; i < bidLevels; i++) {
            bidPrices[i] = allBuyPrices[i];
            bidAmounts[i] = allBuyAmounts[i];
        }
        
        for (uint256 i = 0; i < askLevels; i++) {
            askPrices[i] = allSellPrices[i];
            askAmounts[i] = allSellAmounts[i];
        }
    }

    /**
     * @dev Get user's orders
     * @param user The user address
     * @return orderIds Array of order IDs belonging to the user
     */
    function getUserOrders(address user) external view returns (uint256[] memory orderIds) {
        return userOrders[user];
    }

    /**
     * @dev Get order details
     * @param orderId The order ID
     * @return order The order struct
     */
    function getOrder(uint256 orderId) external view returns (Order memory order) {
        return orders[orderId];
    }

    /**
     * @dev Get spread (difference between best bid and best ask)
     * @return spread The current spread
     */
    function getSpread() external view returns (uint256 spread) {
        if (bestBid == 0 || bestAsk == type(uint256).max) {
            return type(uint256).max; // No spread if no orders on one side
        }
        return bestAsk > bestBid ? bestAsk - bestBid : 0;
    }

    /**
     * @dev Check if order book is crossed (bid >= ask)
     * @return crossed True if the book is crossed
     */
    function isBookCrossed() external view returns (bool crossed) {
        return bestBid != 0 && bestAsk != type(uint256).max && bestBid >= bestAsk;
    }

    // ============ Trade Execution Functions ============

    /**
     * @dev Execute a trade between buyer and seller
     * @param buyer Buyer address
     * @param seller Seller address
     * @param price Trade execution price
     * @param amount Trade amount
     * @param buyerMargin Whether buyer is using margin
     * @param sellerMargin Whether seller is using margin
     */
    function _executeTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin
    ) internal {
        // Calculate trade value (amount * price converted to USDC decimals)
        // amount: 18 decimals, price: 6 decimals -> result: 24 decimals, divide by 10^18 to get 6 decimals
        uint256 tradeValue = (amount * price) / (10**18); // Convert to USDC (6 decimals)
        
        // Calculate trading fees
        uint256 calculatedBuyerFee = 0;
        uint256 calculatedSellerFee = 0;
        if (tradingFee > 0) {
            calculatedBuyerFee = _calculateTradingFee(amount, price);
            calculatedSellerFee = _calculateTradingFee(amount, price);
        }
        
        // Record trade in history
        _recordTrade(buyer, seller, price, amount, buyerMargin, sellerMargin, tradeValue, calculatedBuyerFee, calculatedSellerFee);
        
        // ALWAYS UPDATE POSITIONS FIRST (for both margin and spot trades)
        // Update buyer position
        int256 oldBuyerPosition = userPositions[buyer];
        userPositions[buyer] += int256(amount);
        emit PositionUpdated(buyer, oldBuyerPosition, userPositions[buyer]);
        
        // Update seller position  
        int256 oldSellerPosition = userPositions[seller];
        userPositions[seller] -= int256(amount);
        emit PositionUpdated(seller, oldSellerPosition, userPositions[seller]);
        
        // Handle margin vs spot trades differently for collateral and margin management
        if (buyerMargin || sellerMargin) {
            // MARGIN TRADES: Update positions with margin requirements
            if (buyerMargin) {
                // Calculate how much of this trade is opening vs closing
                uint256 openingAmount = 0;
                if (oldBuyerPosition < 0) {
                    // Currently short, buying to close
                    int256 absOldPosition = -oldBuyerPosition;
                    if (int256(amount) > absOldPosition) {
                        // Closing short and opening long
                        openingAmount = uint256(int256(amount) - absOldPosition);
                    }
                    // else: just closing/reducing short, no new margin needed
                } else {
                    // Currently flat or long, buying to open/increase
                    openingAmount = amount;
                }
                
                // Calculate margin required for the opening portion
                uint256 marginRequired = openingAmount > 0 ? _calculateExecutionMargin(openingAmount, price) : 0;
                
                // Use the atomic update function that handles margin and position together
                vault.updatePositionWithMargin(buyer, marketId, int256(amount), price, marginRequired);
            }
            
            if (sellerMargin) {
                // Calculate how much of this trade is opening vs closing
                uint256 openingAmount = 0;
                if (oldSellerPosition > 0) {
                    // Currently long, selling to close
                    if (int256(amount) > oldSellerPosition) {
                        // Closing long and opening short
                        openingAmount = uint256(int256(amount) - oldSellerPosition);
                    }
                    // else: just closing/reducing long, no new margin needed
                } else {
                    // Currently flat or short, selling to open/increase
                    openingAmount = amount;
                }
                
                // Calculate margin required for the opening portion
                uint256 marginRequired = openingAmount > 0 ? _calculateExecutionMargin(openingAmount, price) : 0;
                
                // Use the atomic update function that handles margin and position together
                vault.updatePositionWithMargin(seller, marketId, -int256(amount), price, marginRequired);
            }
            
            // SECURITY FIX: Prevent mixing margin and spot trades
            // Both parties must use the same trade type
            require(buyerMargin == sellerMargin, "OrderBook: cannot mix margin and spot trades");
            
            // Deduct trading fees for margin traders
            if (tradingFee > 0) {
                if (buyerMargin) {
                    vault.deductFees(buyer, calculatedBuyerFee, feeRecipient);
                }
                if (sellerMargin) {
                    vault.deductFees(seller, calculatedSellerFee, feeRecipient);
                }
            }
        } else {
            // SPOT TRADES: DISABLED for futures markets to prevent margin bypass
            // All futures trades must use margin to ensure proper collateralization
            revert("OrderBook: spot trading disabled for futures markets - use margin orders");
        }
        
        // Update last trade price for market data
        lastTradePrice = price;
    }

    /**
     * @dev Calculate margin required for an order
     * @param amount Order amount
     * @param price Order price
     * @return Margin required
     */
    function _calculateMarginRequired(uint256 amount, uint256 price) internal view returns (uint256) {
        // amount is in 18 decimals, price is in 6 decimals
        // notionalValue = amount * price / 10^18 (to get USDC value with 6 decimals)
        uint256 notionalValue = (amount * price) / (10**18);
        return (notionalValue * marginRequirementBps) / 10000;
    }

    /**
     * @dev Calculate margin required for a trade execution
     * @param amount Trade amount
     * @param executionPrice Actual execution price
     * @return Margin required for this execution
     */
    function _calculateExecutionMargin(uint256 amount, uint256 executionPrice) internal view returns (uint256) {
        // Calculate margin based on actual execution price
        uint256 notionalValue = (amount * executionPrice) / (10**18);
        return (notionalValue * marginRequirementBps) / 10000;
    }

    /**
     * @dev Release excess margin when order executes at better price
     * @param user User address
     * @param orderId Order ID
     * @param executionPrice Actual execution price
     * @param amount Amount being executed
     */
    function _releaseExcessMargin(
        address user,
        uint256 orderId,
        uint256 executionPrice,
        uint256 amount
    ) internal {
        Order storage order = orders[orderId];
        
        if (order.isMarginOrder && order.marginRequired > 0) {
            // Calculate how much margin was reserved for this specific amount
            uint256 originalMarginForAmount = (order.marginRequired * amount) / order.amount;
            
            // Calculate required margin at execution price
            uint256 requiredMarginAtExecution = _calculateExecutionMargin(amount, executionPrice);
            
            if (requiredMarginAtExecution < originalMarginForAmount) {
                // Execution price is better - release excess margin
                uint256 excessMargin = originalMarginForAmount - requiredMarginAtExecution;
                
                // For full fills, we need to handle this differently
                // The order will be removed, so we can't update it
                // Instead, we need to refund the excess margin directly
                if (amount == order.amount) {
                    // Order is fully filled - refund excess margin directly
                    vault.transferCollateral(address(vault), user, excessMargin);
                } else {
                    // Order is partially filled - update the margin requirement
                    order.marginRequired = order.marginRequired - excessMargin;
                    // For partial fills, update the margin in vault
                    vault.releaseExcessMargin(user, bytes32(orderId), order.marginRequired);
                }
                
                emit DebugMarginRelease(user, orderId, executionPrice, amount, true);
            }
        }
    }

    /**
     * @dev Calculate trading fee
     * @param amount Trade amount
     * @param price Trade price
     * @return Fee amount
     */
    function _calculateTradingFee(uint256 amount, uint256 price) internal view returns (uint256) {
        // amount is in 18 decimals, price is in 6 decimals
        // notionalValue = amount * price / 10^18 (to get USDC value with 6 decimals)
        uint256 notionalValue = (amount * price) / (10**18);
        return (notionalValue * tradingFee) / 10000;
    }

    /**
     * @dev Record a trade in the trade history
     * @param buyer Buyer address
     * @param seller Seller address
     * @param price Trade price
     * @param amount Trade amount
     * @param buyerMargin Whether buyer used margin
     * @param sellerMargin Whether seller used margin
     * @param tradeValue Trade value in USDC
     * @param buyerFee Fee paid by buyer
     * @param sellerFee Fee paid by seller
     */
    function _recordTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin,
        uint256 tradeValue,
        uint256 buyerFee,
        uint256 sellerFee
    ) internal {
        uint256 tradeId = nextTradeId++;
        
        // Create trade record
        trades[tradeId] = Trade({
            tradeId: tradeId,
            buyer: buyer,
            seller: seller,
            price: price,
            amount: amount,
            timestamp: block.timestamp,
            buyOrderId: 0, // TODO: Pass actual order IDs when available
            sellOrderId: 0, // TODO: Pass actual order IDs when available
            buyerIsMargin: buyerMargin,
            sellerIsMargin: sellerMargin,
            tradeValue: tradeValue,
            buyerFee: buyerFee,
            sellerFee: sellerFee
        });
        
        // Add to user trade histories
        userTradeIds[buyer].push(tradeId);
        userTradeIds[seller].push(tradeId);
        
        // Increment total trade count
        totalTradeCount++;
        
        // Update VWAP tracking
        _updateVWAPData(tradeId, price, amount);
        
        // Emit trade event
        emit TradeExecuted(tradeId, buyer, seller, price, amount, tradeValue, block.timestamp);
    }

    // ============ Trade History Query Functions ============

    /**
     * @dev Get all trades with pagination
     * @param offset Starting index (0-based)
     * @param limit Maximum number of trades to return (max 100)
     * @return tradeData Array of trades
     * @return hasMore Whether there are more trades available
     */
    function getAllTrades(uint256 offset, uint256 limit) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        
        if (offset >= totalTradeCount) {
            return (new Trade[](0), false);
        }
        
        uint256 remainingTrades = totalTradeCount - offset;
        uint256 actualLimit = remainingTrades < limit ? remainingTrades : limit;
        
        tradeData = new Trade[](actualLimit);
        
        // Note: tradeIds start from 1, so we need to adjust indexing
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = totalTradeCount - offset - i; // Get newest trades first
            tradeData[i] = trades[tradeId];
        }
        
        hasMore = offset + actualLimit < totalTradeCount;
        return (tradeData, hasMore);
    }

    /**
     * @dev Get trades for a specific user with pagination
     * @param user User address
     * @param offset Starting index in user's trade history
     * @param limit Maximum number of trades to return (max 100)
     * @return tradeData Array of trades for the user
     * @return hasMore Whether there are more trades available for this user
     */
    function getUserTrades(address user, uint256 offset, uint256 limit) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        
        uint256[] storage userTrades = userTradeIds[user];
        
        if (offset >= userTrades.length) {
            return (new Trade[](0), false);
        }
        
        uint256 remainingTrades = userTrades.length - offset;
        uint256 actualLimit = remainingTrades < limit ? remainingTrades : limit;
        
        tradeData = new Trade[](actualLimit);
        
        // Get newest trades first (reverse chronological order)
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = userTrades[userTrades.length - 1 - offset - i];
            tradeData[i] = trades[tradeId];
        }
        
        hasMore = offset + actualLimit < userTrades.length;
        return (tradeData, hasMore);
    }

    /**
     * @dev Get recent trades (last N trades)
     * @param count Number of recent trades to return (max 100)
     * @return tradeData Array of recent trades
     */
    function getRecentTrades(uint256 count) 
        external 
        view 
        returns (Trade[] memory tradeData) 
    {
        require(count > 0 && count <= MAX_TRADES_PER_QUERY, "OrderBook: invalid count");
        
        if (totalTradeCount == 0) {
            return new Trade[](0);
        }
        
        uint256 actualCount = totalTradeCount < count ? totalTradeCount : count;
        tradeData = new Trade[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint256 tradeId = totalTradeCount - i; // Get newest trades first
            tradeData[i] = trades[tradeId];
        }
        
        return tradeData;
    }

    /**
     * @dev Get trades within a specific time range
     * @param startTime Start timestamp (inclusive)
     * @param endTime End timestamp (inclusive)
     * @param offset Starting index for pagination
     * @param limit Maximum number of trades to return (max 100)
     * @return tradeData Array of trades within the time range
     * @return hasMore Whether there are more trades available in this range
     */
    function getTradesByTimeRange(
        uint256 startTime, 
        uint256 endTime, 
        uint256 offset, 
        uint256 limit
    ) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        require(startTime <= endTime, "OrderBook: invalid time range");
        
        // This is a simplified implementation - in production you might want to use
        // more efficient indexing structures for time-based queries
        Trade[] memory tempTrades = new Trade[](limit);
        uint256 foundCount = 0;
        uint256 skippedCount = 0;
        
        // Search backwards from newest trades
        for (uint256 i = totalTradeCount; i >= 1 && foundCount < limit; i--) {
            Trade storage trade = trades[i];
            
            if (trade.timestamp >= startTime && trade.timestamp <= endTime) {
                if (skippedCount >= offset) {
                    tempTrades[foundCount] = trade;
                    foundCount++;
                } else {
                    skippedCount++;
                }
            }
            
            // Stop if we've gone too far back in time
            if (trade.timestamp < startTime) {
                break;
            }
        }
        
        // Create properly sized return array
        tradeData = new Trade[](foundCount);
        for (uint256 i = 0; i < foundCount; i++) {
            tradeData[i] = tempTrades[i];
        }
        
        // Check if there are more trades (simplified check)
        hasMore = foundCount == limit;
        
        return (tradeData, hasMore);
    }

    /**
     * @dev Get trade statistics
     * @return totalTrades Total number of trades
     * @return totalVolume Total trading volume in USDC (6 decimals)
     * @return totalFees Total fees collected in USDC (6 decimals)
     */
    function getTradeStatistics() 
        external 
        view 
        returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees) 
    {
        totalTrades = totalTradeCount;
        totalVolume = 0;
        totalFees = 0;
        
        // Calculate totals from all trades
        for (uint256 i = 1; i <= totalTradeCount; i++) {
            Trade storage trade = trades[i];
            totalVolume += trade.tradeValue;
            totalFees += trade.buyerFee + trade.sellerFee;
        }
        
        return (totalTrades, totalVolume, totalFees);
    }

    /**
     * @dev Get user trade count
     * @param user User address
     * @return Number of trades for the user
     */
    function getUserTradeCount(address user) external view returns (uint256) {
        return userTradeIds[user].length;
    }

    /**
     * @dev Get specific trade by ID
     * @param tradeId Trade ID
     * @return trade Trade data
     */
    function getTradeById(uint256 tradeId) external view returns (Trade memory trade) {
        require(tradeId > 0 && tradeId < nextTradeId, "OrderBook: invalid trade ID");
        return trades[tradeId];
    }

    // ============ Administrative Functions ============

    /**
     * @dev Update trading parameters
     * @param _marginRequirementBps Margin requirement in basis points
     * @param _tradingFee Trading fee in basis points
     * @param _feeRecipient Fee recipient address
     */
    function updateTradingParameters(
        uint256 _marginRequirementBps,
        uint256 _tradingFee,
        address _feeRecipient
    ) external onlyAdmin {
        require(_marginRequirementBps <= 5000, "OrderBook: margin requirement too high"); // Max 50%
        require(_tradingFee <= 1000, "OrderBook: trading fee too high"); // Max 10%
        require(_feeRecipient != address(0), "OrderBook: fee recipient cannot be zero");
        
        marginRequirementBps = _marginRequirementBps;
        tradingFee = _tradingFee;
        feeRecipient = _feeRecipient;
        
        emit TradingParametersUpdated(_marginRequirementBps, _tradingFee, _feeRecipient);
    }

    /**
     * @dev Update maximum slippage tolerance for market orders
     * @param _maxSlippageBps New maximum slippage in basis points
     */
    function updateMaxSlippage(uint256 _maxSlippageBps) external onlyAdmin {
        require(_maxSlippageBps <= 5000, "OrderBook: slippage too high"); // Max 50%
        
        uint256 oldSlippage = maxSlippageBps;
        maxSlippageBps = _maxSlippageBps;
        
        emit MaxSlippageUpdated(oldSlippage, _maxSlippageBps);
    }

    /**
     * @dev Modify an existing order (cancel old and place new atomically)
     * @param orderId The ID of the order to modify
     * @param price New price for the order
     * @param amount New amount for the order
     * @return newOrderId The ID of the new order
     */
    function modifyOrder(uint256 orderId, uint256 price, uint256 amount) 
        external 
        orderExists(orderId) 
        onlyOrderOwner(orderId)
        validOrder(price, amount)
        returns (uint256 newOrderId) 
    {
        Order storage oldOrder = orders[orderId];
        bool isBuy = oldOrder.isBuy;
        bool isMarginOrder = oldOrder.isMarginOrder;
        uint256 marginRequired = oldOrder.marginRequired;
        
        // Cancel the old order
        if (isMarginOrder) {
            vault.unreserveMargin(msg.sender, bytes32(orderId));
        }
        
        if (isBuy) {
            _removeFromBuyBook(orderId, oldOrder.price, oldOrder.amount);
        } else {
            _removeFromSellBook(orderId, oldOrder.price, oldOrder.amount);
        }
        
        _removeOrderFromUserList(msg.sender, orderId);
        delete orders[orderId];
        delete cumulativeMarginUsed[orderId];
        
        // Place the new order
        if (isMarginOrder) {
            marginRequired = _calculateMarginRequired(amount, price);
        }
        
        newOrderId = _placeLimitOrder(price, amount, isBuy, isMarginOrder, marginRequired);
        
        emit OrderModified(orderId, newOrderId, msg.sender, price, amount);
        
        return newOrderId;
    }

    /**
     * @dev Get user's position in this market
     * @param user User address
     * @return Position size (positive for long, negative for short)
     */
    function getUserPosition(address user) external view returns (int256) {
        return userPositions[user];
    }

    /**
     * @dev Get trading parameters
     * @return marginRequirement Margin requirement in basis points
     * @return fee Trading fee in basis points
     * @return recipient Fee recipient address
     */
    function getTradingParameters() external view returns (uint256 marginRequirement, uint256 fee, address recipient) {
        return (marginRequirementBps, tradingFee, feeRecipient);
    }

    /**
     * @dev Get market price data for orderbook viewer
     * @return midPrice Current mid price
     * @return bestBidPrice Best bid price
     * @return bestAskPrice Best ask price  
     * @return lastTradePriceReturn Last trade price
     * @return markPrice Mark price (same as mid)
     * @return spread Current spread
     * @return spreadBps Spread in basis points
     * @return isValid Whether market data is valid
     */
    function getMarketPriceData() external view returns (
        uint256 midPrice,
        uint256 bestBidPrice, 
        uint256 bestAskPrice,
        uint256 lastTradePriceReturn,
        uint256 markPrice,
        uint256 spread,
        uint256 spreadBps,
        bool isValid
    ) {
        bestBidPrice = bestBid;
        bestAskPrice = bestAsk;
        lastTradePriceReturn = lastTradePrice;
        
        // Calculate mid price
        if (bestBid > 0 && bestAsk > 0) {
            midPrice = (bestBid + bestAsk) / 2;
            spread = bestAsk - bestBid;
            spreadBps = (spread * 10000) / midPrice; // Convert to basis points
            isValid = true;
        } else if (bestBid > 0) {
            midPrice = bestBid;
            spread = 0;
            spreadBps = 0;
            isValid = true;
        } else if (bestAsk > 0) {
            midPrice = bestAsk;
            spread = 0;
            spreadBps = 0;
            isValid = true;
        } else {
            midPrice = 1000000; // Default 1 USDC
            spread = 0;
            spreadBps = 0;
            isValid = false;
        }
        
        // Use VWAP-based mark price calculation
        markPrice = calculateMarkPrice();
    }


    /**
     * @dev Get count of active orders
     * @return buyOrderCount Number of active buy orders
     * @return sellOrderCount Number of active sell orders
     */
    function getActiveOrdersCount() external view returns (uint256 buyOrderCount, uint256 sellOrderCount) {
        // Count active orders by iterating through price levels
        for (uint256 i = 0; i < buyPrices.length; i++) {
            uint256 price = buyPrices[i];
            if (buyLevels[price].exists && buyLevels[price].totalAmount > 0) {
                // Count orders at this price level
                uint256 orderId = buyLevels[price].firstOrderId;
                while (orderId != 0) {
                    if (orders[orderId].amount > 0) {
                        buyOrderCount++;
                    }
                    orderId = orders[orderId].nextOrderId;
                }
            }
        }
        
        for (uint256 i = 0; i < sellPrices.length; i++) {
            uint256 price = sellPrices[i];
            if (sellLevels[price].exists && sellLevels[price].totalAmount > 0) {
                // Count orders at this price level
                uint256 orderId = sellLevels[price].firstOrderId;
                while (orderId != 0) {
                    if (orders[orderId].amount > 0) {
                        sellOrderCount++;
                    }
                    orderId = orders[orderId].nextOrderId;
                }
            }
        }
    }

    /**
     * @dev Get best bid and ask prices
     * @return bidPrice Best bid price
     * @return askPrice Best ask price
     */
    function getBestPrices() external view returns (uint256 bidPrice, uint256 askPrice) {
        return (bestBid, bestAsk);
    }

    /**
     * @dev Get filled amount for an order
     * @param orderId Order ID
     * @return Amount filled
     */
    function getFilledAmount(uint256 orderId) external view returns (uint256) {
        return filledAmounts[orderId];
    }

    // ============ VWAP Functions ============
    
    /**
     * @dev Update VWAP data when a new trade occurs
     * @param tradeId The ID of the new trade
     * @param price The trade price
     * @param amount The trade amount
     */
    function _updateVWAPData(uint256 tradeId, uint256 price, uint256 amount) internal {
        // Add trade to circular buffer
        if (tradeHistoryCount < MAX_TRADE_HISTORY) {
            tradeHistoryIds.push(tradeId);
            tradeHistoryCount++;
        } else {
            // Overwrite oldest trade in circular buffer
            uint256 index = tradeHistoryStart;
            tradeHistoryIds[index] = tradeId;
            tradeHistoryStart = (tradeHistoryStart + 1) % MAX_TRADE_HISTORY;
        }
    }
    
    /**
     * @dev Calculate VWAP for a specific time window
     * @param timeWindow Time window in seconds
     * @return vwap The volume-weighted average price
     * @return totalVolume Total volume in the time window
     * @return tradeCount Number of trades in the time window
     * @return isValid Whether the VWAP is valid (meets minimum volume)
     */
    function calculateVWAP(uint256 timeWindow) public view returns (
        uint256 vwap,
        uint256 totalVolume,
        uint256 tradeCount,
        bool isValid
    ) {
        uint256 cutoffTime = block.timestamp - timeWindow;
        uint256 cumulativeValue = 0;
        
        // Iterate through trade history buffer
        uint256 count = tradeHistoryCount;
        for (uint256 i = 0; i < count; i++) {
            uint256 index = (tradeHistoryStart + count - 1 - i) % MAX_TRADE_HISTORY;
            uint256 tradeId = tradeHistoryIds[index];
            Trade memory trade = trades[tradeId];
            
            // Stop if trade is older than time window
            if (trade.timestamp < cutoffTime) {
                break;
            }
            
            // Accumulate value and volume
            cumulativeValue += trade.price * trade.amount;
            totalVolume += trade.amount;
            tradeCount++;
        }
        
        // Calculate VWAP
        if (totalVolume >= minVolumeForVWAP) {
            vwap = cumulativeValue / totalVolume;
            isValid = true;
        } else {
            vwap = 0;
            isValid = false;
        }
        
        return (vwap, totalVolume, tradeCount, isValid);
    }
    
    /**
     * @dev Get VWAP for the default time window
     * @return The VWAP price with 6 decimals
     */
    function getVWAP() external view returns (uint256) {
        (uint256 vwap, , , bool isValid) = calculateVWAP(vwapTimeWindow);
        return isValid ? vwap : 0;
    }
    
    /**
     * @dev Get VWAP data for multiple time windows
     * @return vwap5m VWAP for 5 minute window
     * @return vwap15m VWAP for 15 minute window
     * @return vwap1h VWAP for 1 hour window
     * @return vwap4h VWAP for 4 hour window
     * @return vwap24h VWAP for 24 hour window
     */
    function getMultiWindowVWAP() external view returns (
        uint256 vwap5m,
        uint256 vwap15m,
        uint256 vwap1h,
        uint256 vwap4h,
        uint256 vwap24h
    ) {
        (vwap5m, , , ) = calculateVWAP(300);     // 5 minutes
        (vwap15m, , , ) = calculateVWAP(900);    // 15 minutes
        (vwap1h, , , ) = calculateVWAP(3600);    // 1 hour
        (vwap4h, , , ) = calculateVWAP(14400);   // 4 hours
        (vwap24h, , , ) = calculateVWAP(86400);  // 24 hours
    }
    
    /**
     * @dev Configure VWAP parameters
     * @param _timeWindow New time window in seconds
     * @param _minVolume Minimum volume for valid VWAP
     * @param _useVWAP Whether to use VWAP for mark price
     */
    function configureVWAP(
        uint256 _timeWindow,
        uint256 _minVolume,
        bool _useVWAP
    ) external {
        require(msg.sender == leverageController || msg.sender == feeRecipient, "Unauthorized");
        require(_timeWindow > 0 && _timeWindow <= 86400, "Invalid time window"); // Max 24 hours
        
        vwapTimeWindow = _timeWindow;
        minVolumeForVWAP = _minVolume;
        useVWAPForMarkPrice = _useVWAP;
        
        emit VWAPConfigUpdated(_timeWindow, _minVolume, _useVWAP);
    }

    // ============ Mark Price Functions ============

    /**
     * @dev Calculate the current mark price using VWAP-based hierarchy
     * @return Current mark price with 6 decimals (USDC)
     * @notice Priority: 1) VWAP, 2) Mid-price, 3) Last trade, 4) Fallbacks
     */
    function calculateMarkPrice() public view returns (uint256) {
        // Priority 1: Use VWAP if enabled and valid
        if (useVWAPForMarkPrice) {
            (uint256 vwap, , , bool isValid) = calculateVWAP(vwapTimeWindow);
            if (isValid && vwap > 0) {
                return vwap;
            }
        }
        
        // Priority 2: Both bid and ask exist - use mid-price
        if (bestBid > 0 && bestAsk < type(uint256).max) {
            return (bestBid + bestAsk) / 2;
        }
        
        // Priority 3: Use last trade price if available
        if (lastTradePrice > 0) {
            // Apply bounds if order book is one-sided
            if (bestBid > 0 && bestAsk == type(uint256).max) {
                // Only bid exists - ensure mark price isn't too far above bid
                uint256 maxPrice = bestBid + (bestBid / 20); // Max 5% above bid
                return lastTradePrice > maxPrice ? maxPrice : lastTradePrice;
            }
            if (bestBid == 0 && bestAsk < type(uint256).max) {
                // Only ask exists - ensure mark price isn't too far below ask
                uint256 minPrice = bestAsk - (bestAsk / 20); // Max 5% below ask
                return lastTradePrice < minPrice ? minPrice : lastTradePrice;
            }
            return lastTradePrice;
        }
        
        // Priority 4: Fallback to single-sided order book
        if (bestBid > 0 && bestAsk == type(uint256).max) {
            return bestBid + (bestBid / 100); // 1% premium
        }
        if (bestBid == 0 && bestAsk < type(uint256).max) {
            return bestAsk - (bestAsk / 100); // 1% discount
        }
        
        // Priority 5: No trades and no orders - return default price
        return 1000000; // 1 USDC with 6 decimals
    }

    /**
     * @dev Get the current mark price (alias for calculateMarkPrice)
     * @return Current mark price with 6 decimals (USDC)
     */
    function getMarkPrice() external view returns (uint256) {
        return calculateMarkPrice();
    }

    // ============ Leverage Control Functions ============

    /**
     * @dev Enable leverage trading for this market
     * @param _maxLeverage Maximum leverage allowed (e.g., 10 for 10x)
     * @param _marginRequirementBps New margin requirement in basis points
     */
    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) 
        external 
        onlyLeverageController 
    {
        require(_maxLeverage > 1 && _maxLeverage <= 100, "OrderBook: invalid max leverage");
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OrderBook: invalid margin requirement");
        require(_marginRequirementBps <= (10000 / _maxLeverage), "OrderBook: margin requirement too low for max leverage");
        
        leverageEnabled = true;
        maxLeverage = _maxLeverage;
        marginRequirementBps = _marginRequirementBps;
        
        emit LeverageEnabled(msg.sender, _maxLeverage, _marginRequirementBps);
        emit MarginRequirementUpdated(marginRequirementBps, _marginRequirementBps);
    }

    /**
     * @dev Disable leverage trading for this market (revert to 1:1 margin)
     */
    function disableLeverage() 
        external 
        onlyLeverageController 
    {
        leverageEnabled = false;
        maxLeverage = 1;
        marginRequirementBps = 10000; // 100% margin requirement (1:1)
        
        emit LeverageDisabled(msg.sender);
        emit MarginRequirementUpdated(marginRequirementBps, 10000);
    }

    /**
     * @dev Update leverage controller
     * @param _newController New leverage controller address
     */
    function setLeverageController(address _newController) 
        external 
        onlyLeverageController 
    {
        require(_newController != address(0), "OrderBook: invalid controller address");
        
        address oldController = leverageController;
        leverageController = _newController;
        
        emit LeverageControllerUpdated(oldController, _newController);
    }

    /**
     * @dev Update margin requirement (only when leverage is enabled)
     * @param _marginRequirementBps New margin requirement in basis points
     */
    function setMarginRequirement(uint256 _marginRequirementBps) 
        external 
        onlyLeverageController 
        leverageAllowed
    {
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OrderBook: invalid margin requirement");
        require(_marginRequirementBps <= (10000 / maxLeverage), "OrderBook: margin requirement too low for max leverage");
        
        uint256 oldRequirement = marginRequirementBps;
        marginRequirementBps = _marginRequirementBps;
        
        emit MarginRequirementUpdated(oldRequirement, _marginRequirementBps);
    }

    /**
     * @dev Get leverage status and parameters
     * @return enabled Whether leverage is enabled
     * @return maxLev Maximum leverage allowed
     * @return marginReq Current margin requirement in basis points
     * @return controller Current leverage controller
     */
    function getLeverageInfo() external view returns (
        bool enabled,
        uint256 maxLev,
        uint256 marginReq,
        address controller
    ) {
        return (leverageEnabled, maxLeverage, marginRequirementBps, leverageController);
    }

    // ============ Internal Helper Functions ============

    /**
     * @dev Remove order ID from user's order list
     * @param user User address
     * @param orderId Order ID to remove
     */
    function _removeOrderFromUserList(address user, uint256 orderId) internal {
        uint256[] storage userOrderList = userOrders[user];
        
        for (uint256 i = 0; i < userOrderList.length; i++) {
            if (userOrderList[i] == orderId) {
                // Remove by swapping with last element and popping
                userOrderList[i] = userOrderList[userOrderList.length - 1];
                userOrderList.pop();
                break;
            }
        }
    }
}
