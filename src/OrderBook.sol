// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICentralizedVault {
    function lockMargin(address user, bytes32 marketId, uint256 amount) external;
    function releaseMargin(address user, bytes32 marketId, uint256 amount) external;
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external;
    function unreserveMargin(address user, bytes32 orderId) external;
    function safeUnreserveMargin(address user, bytes32 orderId) external returns (bool success, uint256 amount);
    function releaseExcessMargin(address user, bytes32 orderId, uint256 actualMarginNeeded) external;
    function updatePosition(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice) external;
    function updatePositionWithMargin(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice, uint256 marginToLock) external;
    function deductFees(address user, uint256 feeAmount, address feeRecipient) external;
    function transferCollateral(address from, address to, uint256 amount) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    
    // Consume (write-off) a portion of locked margin without crediting it back to the user.
    // Used during liquidation to account for losses covered by isolated margin.
    function consumeLockedMargin(address user, bytes32 marketId, uint256 amount) external;
    
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
    uint256 public constant MARGIN_REQUIREMENT_LONG_BPS = 10000; // 100% margin requirement for longs (1:1)
    uint256 public constant MARGIN_REQUIREMENT_SHORT_BPS = 15000; // 150% margin requirement for shorts
    uint256 public tradingFee = 10; // 0.1% trading fee (basis points)
    address public feeRecipient;
    uint256 public constant MAINTENANCE_MARGIN_BPS = 500; // 5% maintenance margin
    uint256 public maxSlippageBps = 500; // 5% maximum slippage for market orders (basis points)
    
    
    // Position tracking for margin calculations
    mapping(address => int256) public userPositions; // user => position size
    
    // Isolated Margin Position Structure
    struct IsolatedPosition {
        uint256 positionId;
        address trader;
        int256 size; // Positive for long, negative for short
        uint256 entryPrice;
        uint256 isolatedMargin;
        uint256 liquidationPrice;
        uint256 maintenanceMargin;
        uint256 openTimestamp;
        bool isActive;
        bool isFrozen;  // Position is frozen for liquidation
    }
    
    // Isolated margin position tracking
    mapping(address => mapping(uint256 => IsolatedPosition)) public userIsolatedPositions;
    mapping(address => uint256[]) public userPositionIds;
    mapping(address => uint256) public userNextPositionId;
    
    // Liquidation tracking
    struct LiquidationEvent {
        address trader;
        uint256 positionId;
        uint256 liquidationPrice;
        uint256 bankruptcyPrice;
        uint256 shortfall;
        uint256 timestamp;
    }
    
    uint256 public totalShortfall;
    mapping(uint256 => LiquidationEvent) public liquidationHistory;
    uint256 public nextLiquidationId = 1;
    
    // Socialized loss tracking
    mapping(address => uint256) public socializedLossDebt; // Track losses to be socialized
    mapping(address => uint256) public socializedLossCredit; // Track profits available for socialization
    
    
    // Position limits based on collateral
    uint256 public maxPositionMultiplier = 10; // Max position size = collateral * multiplier
    mapping(address => uint256) public userMaxPositionSize;
    
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
    bool public useVWAPForMarkPrice = false; // Enable/disable VWAP for mark price
    
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
    event DebugMarginCalculation(uint256 amount, uint256 price, bool isBuy, uint256 marginRequired);
    event MarginUnreserveError(uint256 indexed orderId, address indexed trader, string reason);
    
    event TradingParametersUpdated(uint256 tradingFee, address feeRecipient);
    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    event OrderModified(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed trader, uint256 newPrice, uint256 newAmount);
    
    // VWAP events
    event VWAPConfigUpdated(uint256 timeWindow, uint256 minVolume, bool useVWAP);
    event VWAPCalculated(uint256 vwap, uint256 volume, uint256 tradeCount, uint256 timeWindow);
    
    // Isolated margin events
    event IsolatedPositionOpened(
        address indexed trader,
        uint256 indexed positionId,
        int256 size,
        uint256 entryPrice,
        uint256 isolatedMargin,
        uint256 liquidationPrice
    );
    event IsolatedPositionClosed(
        address indexed trader,
        uint256 indexed positionId,
        uint256 closePrice,
        int256 pnl,
        string reason
    );
    event LiquidationTriggered(
        address indexed trader,
        uint256 indexed positionId,
        uint256 markPrice,
        uint256 liquidationPrice,
        uint256 loss
    );
    event CollateralWaterfallExecuted(
        address indexed trader,
        uint256 isolatedMarginUsed,
        uint256 availableCollateralUsed,
        uint256 remainingShortfall
    );
    event LosseSocialized(
        uint256 totalShortfall,
        uint256 totalProfits,
        uint256 socializationPercentage
    );
    event TraderSocialized(
        address indexed trader,
        uint256 originalProfit,
        uint256 socializedAmount,
        uint256 finalProfit
    );

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
    
    modifier marginOrderAllowed() {
        // All margin orders are allowed since we have fixed margin requirements
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
        // Use the side-specific margin calculation function (100% for longs, 150% for shorts)
        uint256 marginRequired = _calculateMarginRequiredWithSide(amount, price, isBuy);
        
        // Additional validation
        require(marginRequired > 0, "OrderBook: calculated margin must be positive");
        
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
        
        // For margin orders, reserve margin in vault (clamp to minimum 1 unit if inputs are positive)
        if (isMarginOrder) {
            uint256 reserveAmount = marginRequired;
            if (reserveAmount == 0 && amount > 0 && price > 0) {
                reserveAmount = 1; // 1 in 6 decimals
            }
            if (reserveAmount > 0) {
                vault.reserveMargin(msg.sender, bytes32(orderId), marketId, reserveAmount);
            }
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
                
            // Use the side-specific margin calculation function (100% for longs, 150% for shorts)
            uint256 estimatedMargin = _calculateMarginRequiredWithSide(amount, worstCasePrice, isBuy);
            
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
     * @dev Open an isolated margin position
     * @param size Position size (positive for long, negative for short)
     * @param marginAmount Amount of margin to allocate to this position
     * @return positionId The ID of the opened position
     */
    function openIsolatedPosition(
        int256 size,
        uint256 marginAmount
    ) external returns (uint256 positionId) {
        require(size != 0, "OrderBook: position size cannot be zero");
        
        // DEPRECATED: This function now just places a market order
        // Isolated positions are created automatically on all trades
        uint256 absSize = uint256(size > 0 ? size : -size);
        bool isBuy = size > 0;
        
        // Place market order - isolated position created automatically
        this.placeMarginMarketOrder(absSize, isBuy);
        
        // Return 0 as positions are created automatically
        return 0;
    }
    
    /**
     * @dev Close an isolated position manually
     * @param positionId Position ID to close
     * @return pnl The realized profit/loss
     */
    function closeIsolatedPosition(
        uint256 positionId
    ) external  returns (int256 pnl) {
        IsolatedPosition storage position = userIsolatedPositions[msg.sender][positionId];
        require(position.isActive, "OrderBook: position not active");
        require(!position.isFrozen, "OrderBook: position is frozen for liquidation");
        require(position.trader == msg.sender, "OrderBook: not position owner");
        
        uint256 currentPrice = calculateMarkPrice();
        uint256 absSize = uint256(position.size > 0 ? position.size : -position.size);
        
        // Calculate PnL
        bool isProfit;
        (pnl, isProfit) = calculatePositionPnL(msg.sender, positionId);
        
        // Close the position
        position.isActive = false;
        userPositions[msg.sender] -= position.size;
        
        // Release the isolated margin (isolated positions use lockMargin, not reserveMargin)
        if (position.isolatedMargin > 0) {
            vault.releaseMargin(msg.sender, marketId, position.isolatedMargin);
        }
        
        // Process PnL
        if (isProfit) {
            // Credit profit to user's available balance
            if (uint256(pnl) > 0) {
                vault.transferCollateral(address(this), msg.sender, uint256(pnl));
            }
        } else {
            // Loss is already accounted for in the isolated margin
            uint256 loss = uint256(-pnl);
            if (loss > position.isolatedMargin) {
                // User needs to pay additional loss from available balance
                uint256 additionalLoss = loss - position.isolatedMargin;
                if (additionalLoss > 0) {
                    vault.deductFees(msg.sender, additionalLoss, address(this));
                }
            }
        }
        
        emit IsolatedPositionClosed(
            msg.sender,
            positionId,
            currentPrice,
            pnl,
            "manual"
        );
        
        return pnl;
    }

    // ============ Liquidation Functions ============

    /**
     * @dev Execute a forced market buy for liquidation
     * @param size Amount to buy
     * @param maxCost Maximum cost allowed for the buy
     * @return avgPrice Average execution price
     */
    function _executeMarketBuy(uint256 size, uint256 maxCost) internal returns (uint256 avgPrice) {
        require(size > 0, "OrderBook: invalid size");
        require(maxCost > 0, "OrderBook: invalid max cost");
        
        uint256 remainingSize = size;
        uint256 totalCost = 0;
        uint256 totalFilled = 0;
        
        // Start from lowest ask price
        uint256 currentPrice = bestAsk;
        
        while (remainingSize > 0 && currentPrice < type(uint256).max) {
            PriceLevel storage level = sellLevels[currentPrice];
            if (!level.exists || level.totalAmount == 0) {
                // Find next price level
                bool foundNext = false;
                for (uint256 i = 0; i < sellPrices.length; i++) {
                    if (sellPrices[i] > currentPrice) {
                        currentPrice = sellPrices[i];
                        foundNext = true;
                        break;
                    }
                }
                if (!foundNext) break; // No more sell orders
                continue;
            }
            
            // Calculate fill at this level
            uint256 levelAmount = level.totalAmount;
            uint256 fillAmount = remainingSize < levelAmount ? remainingSize : levelAmount;
            uint256 fillCost = (fillAmount * currentPrice) / AMOUNT_SCALE;
            
            // Check if we have enough funds
            if (totalCost + fillCost > maxCost) {
                // Calculate how much we can fill with remaining funds
                fillAmount = ((maxCost - totalCost) * AMOUNT_SCALE) / currentPrice;
                if (fillAmount == 0) break;
                fillCost = (fillAmount * currentPrice) / AMOUNT_SCALE;
            }
            
            // Execute fills at this level
            uint256 orderId = level.firstOrderId;
            uint256 levelFilled = 0;
            
            while (orderId != 0 && levelFilled < fillAmount) {
                Order storage order = orders[orderId];
                uint256 orderFill = fillAmount - levelFilled < order.amount ? 
                    fillAmount - levelFilled : order.amount;
                
                // Execute the fill
                _executeOrderFill(order, orderFill, currentPrice);
                levelFilled += orderFill;
                
                // Move to next order if current is fully filled
                if (order.amount == 0) {
                    orderId = order.nextOrderId;
                }
            }
            
            // Update totals
            totalCost += fillCost;
            totalFilled += levelFilled;
            remainingSize -= levelFilled;
            
            // Move to next price level
            currentPrice = type(uint256).max; // Reset to max
            for (uint256 i = 0; i < sellPrices.length; i++) {
                if (sellPrices[i] > level.firstOrderId && sellPrices[i] < currentPrice) {
                    currentPrice = sellPrices[i];
                }
            }
            if (currentPrice == type(uint256).max) break;
        }
        
        require(totalFilled > 0, "OrderBook: no liquidity");
        
        // Calculate average execution price
        avgPrice = (totalCost * AMOUNT_SCALE) / totalFilled;
        
        // If we couldn't fill the entire size, trigger socialized loss
        if (remainingSize > 0) {
            uint256 remainingValue = (remainingSize * avgPrice) / AMOUNT_SCALE;
            _socializeLosses(remainingValue);
        }
        
        return avgPrice;
    }
    
    /**
     * @dev Check and liquidate positions that are underwater
     * @param trader Address of the trader to check
     * @param positionId Position ID to check (for isolated positions) or 0 for regular margin positions
     * @return liquidated Whether the position was liquidated
     */
    function checkAndLiquidatePosition(
        address trader,
        uint256 positionId
    ) external  returns (bool liquidated) {
        // Check if this is an isolated position first
        IsolatedPosition storage position = userIsolatedPositions[trader][positionId];
        if (position.isActive) {
            // This is an active isolated position
        
        uint256 currentPrice = calculateMarkPrice();
        
        // Check if position should be liquidated
        bool shouldLiquidate = false;
        if (position.size > 0) {
            // Long position: liquidate if price <= liquidation price
            shouldLiquidate = currentPrice <= position.liquidationPrice;
        } else {
            // Short position: liquidate if price >= liquidation price
            shouldLiquidate = currentPrice >= position.liquidationPrice;
        }
        
        if (!shouldLiquidate) {
            return false;
        }
        
            // Execute liquidation
            _executeLiquidation(trader, positionId, currentPrice);
            return true;
        } else {
            // No active isolated position, check regular margin position
            return checkMarginLiquidation(trader);
        }
    }
    
    /**
     * @dev Internal function to execute liquidation
     * @param trader Address of the trader
     * @param positionId Position ID
     * @param liquidationPrice Current mark price triggering liquidation
     */
    function _executeLiquidation(
        address trader,
        uint256 positionId,
        uint256 liquidationPrice
    ) internal {
        IsolatedPosition storage position = userIsolatedPositions[trader][positionId];
        
        // Freeze position
        position.isFrozen = true;
        
        // Handle short position liquidation
        if (position.size < 0) {
            uint256 absSize = uint256(-position.size);
            
            // Calculate total available collateral
            // For shorts: Initial margin (150%) + Short proceeds (100%)
            uint256 totalCollateral = position.isolatedMargin + (absSize * position.entryPrice) / 1e18;
            
            // Reserve 5% for liquidation penalty
            uint256 liquidationPenalty = (totalCollateral * 500) / 10000; // 5%
            uint256 availableForBuy = totalCollateral - liquidationPenalty;
            
            // Execute forced market buy
            uint256 executionPrice = _executeMarketBuy(absSize, availableForBuy);
            
            // Calculate final PnL
            int256 pnl = position.size < 0
                ? int256((uint256(-position.size) * (position.entryPrice - executionPrice)) / 1e18)
                : int256((uint256(position.size) * (executionPrice - position.entryPrice)) / 1e18);
            
            // Pay liquidation penalty to msg.sender
            if (liquidationPenalty > 0) {
                vault.transferCollateral(trader, msg.sender, liquidationPenalty);
            }
            
            // Return any remaining collateral to trader
            uint256 remainingCollateral = 0;
            if (pnl > 0) {
                remainingCollateral = uint256(pnl);
                if (remainingCollateral > liquidationPenalty) {
                    remainingCollateral -= liquidationPenalty;
                    vault.releaseMargin(trader, marketId, remainingCollateral);
                }
            }
            
            // Clear position
            delete userIsolatedPositions[trader][positionId];
            
            // Emit liquidation event
            emit IsolatedPositionClosed(
                trader,
                positionId,
                executionPrice,
                pnl,
                "liquidation"
            );
        } else {
            // Handle long position liquidation
            uint256 absSize = uint256(position.size);
            uint256 loss;
            if (position.size > 0) {
                // Long position loss
                if (liquidationPrice < position.entryPrice) {
                    loss = ((position.entryPrice - liquidationPrice) * absSize) / AMOUNT_SCALE;
                }
            } else {
                // Short position loss
                loss = ((liquidationPrice - position.entryPrice) * absSize) / AMOUNT_SCALE;
            }
        
        // Convert loss to 6 decimals (USDC format) for vault operations
        loss = scaleFrom18Decimals(loss, 6);
        
        // Apply liquidation penalty (2.5% of position value)
        uint256 positionNotional = (absSize * liquidationPrice) / AMOUNT_SCALE;
        uint256 liquidationPenalty = (positionNotional * 250) / 10000; // 2.5%
        
        // Convert penalty to 6 decimals (USDC format) for vault operations
        liquidationPenalty = scaleFrom18Decimals(liquidationPenalty, 6);
        
        // Distribute penalty: 1.5% to keeper (msg.sender), 1% to protocol
        uint256 keeperReward = (liquidationPenalty * 60) / 100; // 60% of penalty = 1.5% of position
        uint256 protocolFee = liquidationPenalty - keeperReward;
        
        // Execute collateral waterfall
        uint256 totalLoss = loss + liquidationPenalty;
        uint256 isolatedMarginUsed = position.isolatedMargin > totalLoss ? totalLoss : position.isolatedMargin;
        uint256 shortfall = totalLoss > position.isolatedMargin ? totalLoss - position.isolatedMargin : 0;
        
        if (shortfall > 0) {
            // Use available collateral from vault
            uint256 availableCollateral = vault.getAvailableCollateral(trader);
            uint256 collateralUsed = shortfall > availableCollateral ? availableCollateral : shortfall;
            
            if (collateralUsed > 0) {
                // Deduct from user's available collateral
                if (collateralUsed > 0) {
                    vault.deductFees(trader, collateralUsed, address(this));
                }
            }
            
            uint256 remainingShortfall = shortfall - collateralUsed;
            
            if (remainingShortfall > 0) {
                // Track for socialization
                totalShortfall += remainingShortfall;
                socializedLossDebt[trader] += remainingShortfall;
                
                // Trigger socialization immediately
                _socializeLosses(remainingShortfall);
            }
            
            emit CollateralWaterfallExecuted(
                trader,
                isolatedMarginUsed,
                collateralUsed,
                remainingShortfall
            );
        }
        
        // Consume the portion of isolated margin that covered the loss, and release any unused remainder
        if (isolatedMarginUsed > 0) {
            // Write-off consumed margin so it no longer appears as locked
            vault.consumeLockedMargin(trader, marketId, isolatedMarginUsed);
        }
        uint256 unusedMargin = position.isolatedMargin - isolatedMarginUsed;
        if (unusedMargin > 0) {
            vault.releaseMargin(trader, marketId, unusedMargin);
        }
        
        // Close the position
        position.isActive = false;
        userPositions[trader] -= position.size; // Subtract before resetting
        position.size = 0; // Reset position size
        position.isolatedMargin = 0; // Reset isolated margin
        position.liquidationPrice = 0; // Reset liquidation price
        
        // Pay keeper reward
        if (keeperReward > 0 && msg.sender != trader) {
            vault.transferCollateral(trader, msg.sender, keeperReward);
        }
        
        // Protocol fee to fee recipient
        if (protocolFee > 0) {
            vault.transferCollateral(trader, feeRecipient, protocolFee);
        }
        
        // Record liquidation event
        liquidationHistory[nextLiquidationId++] = LiquidationEvent({
            trader: trader,
            positionId: positionId,
            liquidationPrice: liquidationPrice,
            bankruptcyPrice: position.entryPrice,
            shortfall: shortfall,
            timestamp: block.timestamp
        });
        
        emit LiquidationTriggered(
            trader,
            positionId,
            liquidationPrice,
            position.liquidationPrice,
            totalLoss
        );
        
        emit IsolatedPositionClosed(
            trader,
            positionId,
            liquidationPrice,
            -int256(totalLoss),
            "liquidation"
        );
        }
    }
    
    /**
     * @dev Check and liquidate regular margin positions that are underwater
     * @param trader Address of the trader to check
     * @return liquidated Whether the position was liquidated
     */
    function checkMarginLiquidation(address trader) internal returns (bool) {
        int256 positionSize = userPositions[trader];
        
        // No position to liquidate
        if (positionSize == 0) {
            return false;
        }
        
        uint256 currentPrice = calculateMarkPrice();
        uint256 absSize = uint256(positionSize > 0 ? positionSize : -positionSize);
        
        // For regular margin positions, we need to check if they should be liquidated
        // This is a fallback for non-isolated positions - most positions should be isolated
        uint256 availableMargin = vault.getAvailableCollateral(trader);
        
        // Calculate liquidation price based on maintenance margin
        uint256 maintenanceMargin = (availableMargin * MAINTENANCE_MARGIN_BPS) / 10000;
        
        // Calculate liquidation price based on position size and maintenance margin
        uint256 liquidationPrice;
        if (positionSize > 0) {
            // Long position: liquidation price = entry price - (maintenance margin / position size)
            // For now, use current price as entry price since we don't store entry price for regular positions
            liquidationPrice = currentPrice - (maintenanceMargin * AMOUNT_SCALE) / absSize;
        } else {
            // Short position: liquidation price = entry price + (maintenance margin / position size)
            liquidationPrice = currentPrice + (maintenanceMargin * AMOUNT_SCALE) / absSize;
        }
        
        // Check if position should be liquidated
        bool shouldLiquidate = false;
        if (positionSize > 0) {
            // Long position: liquidate if current price <= liquidation price
            shouldLiquidate = currentPrice <= liquidationPrice;
        } else {
            // Short position: liquidate if current price >= liquidation price
            shouldLiquidate = currentPrice >= liquidationPrice;
        }
        
        if (!shouldLiquidate) {
            return false;
        }
        
        // Execute liquidation
        _executeMarginLiquidation(trader, liquidationPrice);
        
        emit LiquidationTriggered(
            trader,
            0, // positionId = 0 for regular margin positions
            currentPrice,
            liquidationPrice,
            0 // loss will be calculated in _executeMarginLiquidation
        );
        
        return true;
    }
    
    /**
     * @dev Execute liquidation for regular margin positions
     * @param trader Address of the trader
     * @param liquidationPrice Price at which liquidation occurs
     */
    function _executeMarginLiquidation(
        address trader,
        uint256 liquidationPrice
    ) internal {
        int256 positionSize = userPositions[trader];
        uint256 absSize = uint256(positionSize > 0 ? positionSize : -positionSize);
        
        // Calculate the loss
        uint256 currentPrice = calculateMarkPrice();
        uint256 loss;
        if (positionSize > 0) {
            // Long position loss
            if (liquidationPrice < currentPrice) {
                loss = ((currentPrice - liquidationPrice) * absSize) / AMOUNT_SCALE;
            }
        } else {
            // Short position loss
            if (liquidationPrice > currentPrice) {
                loss = ((liquidationPrice - currentPrice) * absSize) / AMOUNT_SCALE;
            }
        }
        
        // Calculate liquidation penalty (5% of position value)
        uint256 liquidationPenalty = (absSize * liquidationPrice * 500) / (AMOUNT_SCALE * 10000);
        
        // Calculate keeper reward (1% of position value)
        uint256 keeperReward = (absSize * liquidationPrice * 100) / (AMOUNT_SCALE * 10000);
        
        // Calculate protocol fee (0.5% of position value)
        uint256 protocolFee = (absSize * liquidationPrice * 50) / (AMOUNT_SCALE * 10000);
        
        // Execute collateral waterfall
        uint256 totalLoss = loss + liquidationPenalty;
        uint256 availableCollateral = vault.getAvailableCollateral(trader);
        uint256 collateralUsed = totalLoss > availableCollateral ? availableCollateral : totalLoss;
        
        if (collateralUsed > 0) {
            // Deduct from user's available collateral
            if (collateralUsed > 0) {
                vault.deductFees(trader, collateralUsed, address(this));
            }
        }
        
        uint256 remainingShortfall = totalLoss > availableCollateral ? totalLoss - availableCollateral : 0;
        
        if (remainingShortfall > 0) {
            // Track for socialization
            totalShortfall += remainingShortfall;
            socializedLossDebt[trader] += remainingShortfall;
            
            // Trigger socialization immediately
            _socializeLosses(remainingShortfall);
        }
        
        // Close the position
        userPositions[trader] = 0;
        
        // Pay keeper reward
        if (keeperReward > 0 && msg.sender != trader) {
            vault.transferCollateral(trader, msg.sender, keeperReward);
        }
        
        // Protocol fee to fee recipient
        if (protocolFee > 0) {
            vault.transferCollateral(trader, feeRecipient, protocolFee);
        }
        
        emit CollateralWaterfallExecuted(
            trader,
            0, // isolatedMarginUsed = 0 for regular margin positions
            collateralUsed,
            remainingShortfall
        );
    }
    
    // ============ Socialized Loss Functions ============
    
    /**
     * @dev Socialize losses among profitable traders
     * @param shortfallAmount Amount to be socialized
     */
    function _socializeLosses(uint256 shortfallAmount) internal {
        // Get all profitable positions
        uint256 totalProfits = 0;
        address[] memory profitableTraders = new address[](100); // Max 100 for gas efficiency
        uint256[] memory traderProfits = new uint256[](100);
        uint256 profitableCount = 0;
        
        // Iterate through all active positions to find profitable ones
        // In production, this would need pagination or off-chain calculation
        // For now, we'll use a simplified approach
        
        // Calculate total profits available for socialization
        for (uint256 i = 0; i < profitableCount && i < 100; i++) {
            totalProfits += traderProfits[i];
        }
        
        if (totalProfits == 0) {
            // No profits to socialize against - system bankruptcy
            // In production, this would trigger emergency procedures
            return;
        }
        
        // Calculate socialization percentage
        uint256 socializationBps = (shortfallAmount * 10000) / totalProfits;
        if (socializationBps > 10000) {
            socializationBps = 10000; // Cap at 100%
        }
        
        // Apply socialization to each profitable trader
        for (uint256 i = 0; i < profitableCount && i < 100; i++) {
            address trader = profitableTraders[i];
            uint256 profit = traderProfits[i];
            uint256 socializedAmount = (profit * socializationBps) / 10000;
            
            // Deduct from trader's balance
            vault.deductFees(trader, socializedAmount, address(this));
            socializedLossCredit[trader] += socializedAmount;
            
            emit TraderSocialized(
                trader,
                profit,
                socializedAmount,
                profit - socializedAmount
            );
        }
        
        emit LosseSocialized(
            shortfallAmount,
            totalProfits,
            socializationBps
        );
    }
    
    /**
     * @dev Calculate unrealized PnL for a position
     * @param trader Trader address
     * @param positionId Position ID
     * @return pnl Profit/loss amount (positive for profit)
     * @return isProfit Whether it's a profit
     */
    function calculatePositionPnL(
        address trader,
        uint256 positionId
    ) public view returns (int256 pnl, bool isProfit) {
        IsolatedPosition memory position = userIsolatedPositions[trader][positionId];
        if (!position.isActive) {
            return (0, false);
        }
        
        uint256 currentPrice = calculateMarkPrice();
        uint256 absSize = uint256(position.size > 0 ? position.size : -position.size);
        
        if (position.size > 0) {
            // Long position
            if (currentPrice > position.entryPrice) {
                pnl = int256(((currentPrice - position.entryPrice) * absSize) / AMOUNT_SCALE);
                isProfit = true;
            } else {
                pnl = -int256(((position.entryPrice - currentPrice) * absSize) / AMOUNT_SCALE);
                isProfit = false;
            }
        } else {
            // Short position
            if (currentPrice < position.entryPrice) {
                pnl = int256(((position.entryPrice - currentPrice) * absSize) / AMOUNT_SCALE);
                isProfit = true;
            } else {
                pnl = -int256(((currentPrice - position.entryPrice) * absSize) / AMOUNT_SCALE);
                isProfit = false;
            }
        }
        
        return (pnl, isProfit);
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
        bool isMarginOrder = order.isMarginOrder;
        
        // Store order details before deletion for event
        uint256 price = order.price;
        uint256 amount = order.amount;
        bool isBuy = order.isBuy;
        
        // First, remove from order book to prevent any further matching
        if (isBuy) {
            _removeFromBuyBook(orderId, price, amount);
        } else {
            _removeFromSellBook(orderId, price, amount);
        }

        // Remove order ID from user's order list
        _removeOrderFromUserList(trader, orderId);

        // Delete order data
        delete orders[orderId];
        delete cumulativeMarginUsed[orderId];
        
        // Finally, unreserve margin if it's a margin order
        // Using try-catch pattern to ensure order cancellation completes even if vault fails
        if (isMarginOrder) {
            try vault.unreserveMargin(trader, bytes32(orderId)) {
                // Successfully unreserved
            } catch {
                // If unreserve fails, try the safe version
                try ICentralizedVault(address(vault)).safeUnreserveMargin(trader, bytes32(orderId)) returns (bool, uint256) {
                    // Handled through safe unreserve
                } catch {
                    // Log the error but don't revert the cancellation
                    emit MarginUnreserveError(orderId, trader, "Failed to unreserve margin during cancellation");
                }
            }
        }

        emit OrderCancelled(orderId, trader);
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
                        uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price, true);
                        
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
                    
                    // Remove from user's order list
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    
                    // Delete order data first
                    delete orders[currentOrderId];
                    
                    // Unreserve margin with error handling
                    if (sellOrder.isMarginOrder) {
                        try vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId)) {
                            // Successfully unreserved
                        } catch {
                            // Try safe unreserve as fallback
                            try ICentralizedVault(address(vault)).safeUnreserveMargin(sellOrder.trader, bytes32(currentOrderId)) returns (bool, uint256) {
                                // Handled
                            } catch {
                                emit MarginUnreserveError(currentOrderId, sellOrder.trader, "Failed to unreserve on fill");
                            }
                        }
                    }
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
                    
                    // Remove from user's order list
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    
                    // Delete order data first
                    delete orders[currentOrderId];
                    
                    // Unreserve margin with error handling
                    if (buyOrder.isMarginOrder) {
                        try vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId)) {
                            // Successfully unreserved
                        } catch {
                            // Try safe unreserve as fallback
                            try ICentralizedVault(address(vault)).safeUnreserveMargin(buyOrder.trader, bytes32(currentOrderId)) returns (bool, uint256) {
                                // Handled
                            } catch {
                                emit MarginUnreserveError(currentOrderId, buyOrder.trader, "Failed to unreserve on fill");
                            }
                        }
                    }
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
                        uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price, true);
                        
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
                    
                    // Remove from user's order list
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    
                    // Delete order data first
                    delete orders[currentOrderId];
                    
                    // Unreserve margin with error handling
                    if (sellOrder.isMarginOrder) {
                        try vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId)) {
                            // Successfully unreserved
                        } catch {
                            // Try safe unreserve as fallback
                            try ICentralizedVault(address(vault)).safeUnreserveMargin(sellOrder.trader, bytes32(currentOrderId)) returns (bool, uint256) {
                                // Handled
                            } catch {
                                emit MarginUnreserveError(currentOrderId, sellOrder.trader, "Failed to unreserve on fill");
                            }
                        }
                    }
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
                    
                    // Remove from user's order list
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    
                    // Delete order data first
                    delete orders[currentOrderId];
                    
                    // Unreserve margin with error handling
                    if (buyOrder.isMarginOrder) {
                        try vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId)) {
                            // Successfully unreserved
                        } catch {
                            // Try safe unreserve as fallback
                            try ICentralizedVault(address(vault)).safeUnreserveMargin(buyOrder.trader, bytes32(currentOrderId)) returns (bool, uint256) {
                                // Handled
                            } catch {
                                emit MarginUnreserveError(currentOrderId, buyOrder.trader, "Failed to unreserve on fill");
                            }
                        }
                    }
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
        // amount: 18 decimals, price: 6 decimals -> result: 24 decimals, divide by 10^18 to get 6 decimals (USDC format)
        uint256 tradeValue = (amount * price) / (10**18); // Result in 6 decimals (USDC format)
        
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
            // MARGIN TRADES: Create isolated positions automatically
            if (buyerMargin) {
                // Process buyer's position change
                _processTradeForIsolatedPosition(buyer, int256(amount), price, oldBuyerPosition);
            }
            
            if (sellerMargin) {
                // Process seller's position change
                _processTradeForIsolatedPosition(seller, -int256(amount), price, oldSellerPosition);
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
        // For market orders hitting multiple levels, track the highest price executed
        // This ensures lastTradePrice reflects the most favorable execution
        if (price > lastTradePrice) {
            lastTradePrice = price;
        }
    }

    /**
     * @dev Process a trade and create/update isolated positions automatically
     * @param trader Address of the trader
     * @param sizeDelta Size change from trade (positive for buy, negative for sell)
     * @param price Execution price
     * @param oldPosition Previous net position
     */
    function _processTradeForIsolatedPosition(
        address trader,
        int256 sizeDelta,
        uint256 price,
        int256 oldPosition
    ) internal {
        // Determine if this trade is opening or closing
        bool isOpening = false;
        uint256 openingAmount = 0;
        uint256 closingAmount = 0;
        
        if (sizeDelta > 0) {
            // Buying
            if (oldPosition >= 0) {
                // Was flat or long, now longer - fully opening
                isOpening = true;
                openingAmount = uint256(sizeDelta);
            } else {
                // Was short
                uint256 absSizeDelta = uint256(sizeDelta);
                uint256 absOldPosition = uint256(-oldPosition);
                
                if (absSizeDelta <= absOldPosition) {
                    // Just closing/reducing short
                    closingAmount = absSizeDelta;
                } else {
                    // Closing short and opening long
                    closingAmount = absOldPosition;
                    openingAmount = absSizeDelta - absOldPosition;
                    isOpening = true;
                }
            }
        } else {
            // Selling
            uint256 absSizeDelta = uint256(-sizeDelta);
            
            if (oldPosition <= 0) {
                // Was flat or short, now shorter - fully opening
                isOpening = true;
                openingAmount = absSizeDelta;
            } else {
                // Was long
                uint256 absOldPosition = uint256(oldPosition);
                
                if (absSizeDelta <= absOldPosition) {
                    // Just closing/reducing long
                    closingAmount = absSizeDelta;
                } else {
                    // Closing long and opening short
                    closingAmount = absOldPosition;
                    openingAmount = absSizeDelta - absOldPosition;
                    isOpening = true;
                }
            }
        }
        
        // Handle closing existing positions
        if (closingAmount > 0) {
            _closePortionOfIsolatedPositions(trader, closingAmount, price, sizeDelta > 0);
        }
        
        // Handle opening new position
        if (isOpening && openingAmount > 0) {
            // Calculate required margin
            // Short positions require 150% margin due to unlimited risk
            // Long positions require 100% margin
            // Note: openingAmount is in 18 decimals (ALU), price is in 6 decimals (USDC)
            // notionalValue = (openingAmount * price) / 10^18 = openingAmount * price / 10^18
            // This gives us the notional value in 6 decimals (USDC format)
            uint256 notionalValue = (openingAmount * price) / 10**18;
            uint256 marginRequired = sizeDelta < 0 ? 
                (notionalValue * 150) / 100 :  // 150% for shorts
                notionalValue;                  // 100% for longs
            
            // No need to convert - notionalValue is already in 6 decimals (USDC format)
            
            // Create new isolated position
            uint256 positionId = userNextPositionId[trader]++;
            
            // Calculate liquidation price
            uint256 maintenanceMargin = (marginRequired * MAINTENANCE_MARGIN_BPS) / 10000;
            
            // Convert margin values to 18 decimals for liquidation price calculation
            uint256 marginRequired18 = scaleTo18Decimals(marginRequired, 6);
            uint256 maintenanceMargin18 = scaleTo18Decimals(maintenanceMargin, 6);
            
            uint256 liquidationPrice = _calculateLiquidationPrice(
                sizeDelta > 0 ? int256(openingAmount) : -int256(openingAmount),
                price,
                marginRequired18,
                maintenanceMargin18
            );
            
            // Update position in vault to maintain consistency
            // This ensures the vault tracks the position for portfolio calculations
            vault.updatePositionWithMargin(
                trader,
                marketId,
                sizeDelta > 0 ? int256(openingAmount) : -int256(openingAmount),
                price,
                marginRequired
            );
            
            // Store position
            userIsolatedPositions[trader][positionId] = IsolatedPosition({
                positionId: positionId,
                trader: trader,
                size: sizeDelta > 0 ? int256(openingAmount) : -int256(openingAmount),
                entryPrice: price,
                isolatedMargin: marginRequired,
                liquidationPrice: liquidationPrice,
                maintenanceMargin: maintenanceMargin,
                openTimestamp: block.timestamp,
                isActive: true,
                isFrozen: false
            });
            
            userPositionIds[trader].push(positionId);
            
            emit IsolatedPositionOpened(
                trader,
                positionId,
                sizeDelta > 0 ? int256(openingAmount) : -int256(openingAmount),
                price,
                marginRequired,
                liquidationPrice
            );
        }
    }

    /**
     * @dev Close a portion of isolated positions (FIFO)
     * @param trader Address of the trader
     * @param amount Amount to close
     * @param closePrice Price at which to close
     * @param isReducingShort True if buying to reduce short, false if selling to reduce long
     */
    function _closePortionOfIsolatedPositions(
        address trader,
        uint256 amount,
        uint256 closePrice,
        bool isReducingShort
    ) internal {
        uint256 remainingToClose = amount;
        uint256[] memory positionIds = userPositionIds[trader];
        
        for (uint256 i = 0; i < positionIds.length && remainingToClose > 0; i++) {
            IsolatedPosition storage position = userIsolatedPositions[trader][positionIds[i]];
            
            if (!position.isActive) continue;
            
            // Check if position matches the closing direction
            bool positionIsShort = position.size < 0;
            if (positionIsShort != !isReducingShort) continue;
            
            uint256 positionAbsSize = uint256(position.size > 0 ? position.size : -position.size);
            uint256 amountToClose = remainingToClose > positionAbsSize ? positionAbsSize : remainingToClose;
            
            // Calculate PnL
            int256 pnl;
            if (position.size > 0) {
                // Long position
                pnl = int256((amountToClose * (closePrice - position.entryPrice)) / 10**18);
            } else {
                // Short position
                pnl = int256((amountToClose * (position.entryPrice - closePrice)) / 10**18);
            }
            
            // Release proportional margin
            uint256 marginToRelease = (position.isolatedMargin * amountToClose) / positionAbsSize;
            if (marginToRelease > 0) {
                vault.releaseMargin(trader, marketId, marginToRelease);
            }
            
            // Update position in vault (closing/reducing)
            int256 closingSizeDelta = position.size > 0 ? -int256(amountToClose) : int256(amountToClose);
            vault.updatePosition(trader, marketId, closingSizeDelta, closePrice);
            
            // Update or close position
            if (amountToClose == positionAbsSize) {
                // Fully close position
                position.isActive = false;
                
                // Handle PnL
                if (uint256(pnl) > 0) {
                    vault.transferCollateral(address(0), trader, uint256(pnl));
                } else if (pnl < 0) {
                    uint256 loss = uint256(-pnl);
                    if (loss <= marginToRelease) {
                        // Loss covered by released margin
                    } else {
                        // Additional loss from available collateral
                        vault.transferCollateral(trader, address(0), loss - marginToRelease);
                    }
                }
                
                emit IsolatedPositionClosed(trader, positionIds[i], closePrice, pnl, "trade");
            } else {
                // Partially close position
                position.size = position.size > 0 
                    ? position.size - int256(amountToClose)
                    : position.size + int256(amountToClose);
                position.isolatedMargin -= marginToRelease;
                
                // Handle partial PnL
                if (pnl > 0) {
                    vault.transferCollateral(address(0), trader, uint256(pnl));
                } else if (pnl < 0) {
                    uint256 loss = uint256(-pnl);
                    vault.transferCollateral(trader, address(0), loss);
                }
            }
            
            remainingToClose -= amountToClose;
        }
    }

    /**
     * @dev Calculate margin required for an order
     * @param amount Order amount
     * @param price Order price
     * @return Margin required (6 decimals)
     */
    function _calculateMarginRequired(uint256 amount, uint256 price, bool isLong) internal pure returns (uint256) {
        // Notional value in USDC (6 decimals)
        // amount (18) * price (6) / 1e18 = 6
        uint256 notionalValue = (amount * price) / 10**18;
        // Use appropriate margin requirement based on position type
        uint256 marginBps = isLong ? MARGIN_REQUIREMENT_LONG_BPS : MARGIN_REQUIREMENT_SHORT_BPS;
        // Round up margin requirement and enforce minimum of 1 unit (6 decimals)
        uint256 required = (notionalValue * marginBps + 9999) / 10000;
        if (required == 0 && amount > 0 && price > 0) {
            required = 1; // 1 in 6 decimals
        }
        return required;
    }

    function getCalculatedMargin(uint256 amount, uint256 price) external view returns (uint256) {
        return _calculateMarginRequired(amount, price, true); // Default to long position for external view
    }

    /**
     * @dev Calculate margin required for a trade with different requirements for longs vs shorts
     * @param amount Trade amount
     * @param price Trade price
     * @param isBuy True for buy order (long), false for sell order (short)
     * @return Margin required for this trade
     */
    function _calculateMarginRequiredWithSide(uint256 amount, uint256 price, bool isBuy) internal pure returns (uint256) {
        // Compute notional in 6 decimals: amount(18) * price(6) / 1e18
        if (amount == 0 || price == 0) {
            return 0;
        }
        uint256 notional6 = (amount * price) / 10**18;
        // Use fixed margin requirements: 100% for longs, 150% for shorts
        uint256 marginBps = isBuy ? MARGIN_REQUIREMENT_LONG_BPS : MARGIN_REQUIREMENT_SHORT_BPS;
        // Round up division by 10000
        uint256 required = (notional6 * marginBps + 9999) / 10000;
        // Enforce minimum of 1 unit (6 decimals) when inputs are positive
        if (required == 0) {
            required = 1;
        }
        return required;
    }

    /**
     * @dev Calculate margin required for a trade execution
     * @param amount Trade amount
     * @param executionPrice Actual execution price
     * @return Margin required for this execution
     */
    function _calculateExecutionMargin(uint256 amount, uint256 executionPrice) internal view returns (uint256) {
        // Calculate margin based on actual execution price
        // amount is in 18 decimals, executionPrice is in 6 decimals
        // notionalValue = amount * executionPrice / 10^18 (to get value in 6 decimals)
        // This gives us the notional value in 6 decimals (USDC format)
        uint256 notionalValue = (amount * executionPrice) / (10**18);
        return (notionalValue * MARGIN_REQUIREMENT_LONG_BPS) / 10000; // Always use long margin for this calculation
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
        // amount is in 18 decimals, price is in 6 decimals (USDC format)
        // notionalValue = amount * price / 10^18 (to get value in 6 decimals)
        uint256 notionalValue = (amount * price) / (10**18);
        // notionalValue is already in 6 decimals (USDC format), no scaling needed
        return (notionalValue * tradingFee) / 10000;
    }

    /**
     * @dev Execute a fill for a single order during liquidation
     * @param order Order to fill
     * @param fillAmount Amount to fill
     * @param fillPrice Price at which to fill
     */
    function _executeOrderFill(
        Order storage order,
        uint256 fillAmount,
        uint256 fillPrice
    ) internal {
        require(fillAmount <= order.amount, "OrderBook: invalid fill amount");
        
        // Calculate trade value and fees
        uint256 tradeValue = (fillAmount * fillPrice) / AMOUNT_SCALE;
        uint256 fee = _calculateTradingFee(fillAmount, fillPrice);
        
        // Update order
        order.amount -= fillAmount;
        
        // Record trade
        trades[nextTradeId] = Trade({
            tradeId: nextTradeId,
            buyer: address(this), // Contract is buyer during liquidation
            seller: order.trader,
            price: fillPrice,
            amount: fillAmount,
            timestamp: block.timestamp,
            buyOrderId: 0, // Liquidation has no order ID
            sellOrderId: order.orderId,
            buyerIsMargin: false,
            sellerIsMargin: order.isMarginOrder,
            tradeValue: tradeValue,
            buyerFee: 0, // No fee for liquidation
            sellerFee: fee
        });
        
        // Update trade history
        userTradeIds[order.trader].push(nextTradeId);
        nextTradeId++;
        totalTradeCount++;
        
        // Update VWAP data
        _updateVWAPData(nextTradeId - 1, fillPrice, fillAmount);
        
        // Emit events
        emit TradeExecuted(
            nextTradeId - 1,
            address(this),
            order.trader,
            fillPrice,
            fillAmount,
            tradeValue,
            block.timestamp
        );
        
        if (order.amount > 0) {
            emit OrderPartiallyFilled(order.orderId, fillAmount, order.amount);
        } else {
            emit OrderMatched(address(this), order.trader, fillPrice, fillAmount);
        }
    }
    
    /**
     * @dev Calculate liquidation price for an isolated position
     * @param size Position size (positive for long, negative for short)
     * @param entryPrice Entry price
     * @param isolatedMargin Isolated margin amount
     * @param maintenanceMargin Maintenance margin requirement
     * @return Liquidation price
     */
    function _calculateLiquidationPrice(
        int256 size,
        uint256 entryPrice,
        uint256 isolatedMargin,
        uint256 maintenanceMargin
    ) internal pure returns (uint256) {
        uint256 absSize = uint256(size > 0 ? size : -size);
        
        if (size > 0) {
            // Long position: fully collateralized (100% upfront)
            // Can only liquidate at $0 since user owns the asset outright
            return 0;
        } else {
            // Short position with 150% margin requirement
            // For shorts: Liquidation Price = Entry Price * (1 + (150% - Maintenance Margin) / 100)
            // Where Maintenance Margin = 5%
            
            if (isolatedMargin == 0) {
                return type(uint256).max; // Cannot liquidate if no margin
            }
            
            // Calculate liquidation threshold
            // 150% - 5% = 145% upward move threshold
            uint256 liquidationThreshold = (entryPrice * 14500) / 10000; // 145% of entry price
            
            // Calculate total funds locked:
            // Initial Margin (150% of position) + Short Sale Proceeds (100% of position)
            // = 250% of position value
            uint256 totalFunds = (entryPrice * 250) / 100; // 250% in same decimals as price
            
            // P_liq = totalFunds / (1 + MMR)
            uint256 mmrRatio = 100_000; // 10% in 6 decimals
            uint256 onePlusMMR = PRICE_SCALE + mmrRatio; // 1.10 in 6 decimals
            return (totalFunds * PRICE_SCALE) / onePlusMMR;
        }
    }
    
    /**
     * @dev Get total position value for a user across all positions
     * @param user User address
     * @return Total position value in USDC
     */
    function _getUserTotalPositionValue(address user) internal view returns (uint256) {
        uint256 totalValue = 0;
        uint256[] memory positionIds = userPositionIds[user];
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            IsolatedPosition memory pos = userIsolatedPositions[user][positionIds[i]];
            if (pos.isActive) {
                uint256 absSize = uint256(pos.size > 0 ? pos.size : -pos.size);
                uint256 posValue = (absSize * pos.entryPrice) / AMOUNT_SCALE;
                totalValue += posValue;
            }
        }
        
        return totalValue;
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
     * @param _tradingFee Trading fee in basis points
     * @param _feeRecipient Fee recipient address
     */
    function updateTradingParameters(
        uint256 _tradingFee,
        address _feeRecipient
    ) external onlyAdmin {
        require(_tradingFee <= 1000, "OrderBook: trading fee too high"); // Max 10%
        require(_feeRecipient != address(0), "OrderBook: fee recipient cannot be zero");
        
        tradingFee = _tradingFee;
        feeRecipient = _feeRecipient;
        
        emit TradingParametersUpdated(_tradingFee, _feeRecipient);
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
            marginRequired = _calculateMarginRequired(amount, price, true); // Default to long position for margin check
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
     * @return longMargin Long position margin requirement in basis points
     * @return shortMargin Short position margin requirement in basis points
     * @return fee Trading fee in basis points
     * @return recipient Fee recipient address
     */
    function getTradingParameters() external view returns (
        uint256 longMargin,
        uint256 shortMargin,
        uint256 fee,
        address recipient
    ) {
        return (MARGIN_REQUIREMENT_LONG_BPS, MARGIN_REQUIREMENT_SHORT_BPS, tradingFee, feeRecipient);
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
        require(msg.sender == feeRecipient, "Unauthorized");
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
            return lastTradePrice;
        }
        
        // Priority 4: Fallback to single-sided order book
        if (bestBid > 0 && bestAsk == type(uint256).max) {
            return bestBid; // Use bid price directly
        }
        if (bestBid == 0 && bestAsk < type(uint256).max) {
            return bestAsk; // Use ask price directly
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



    // ============ Decimal Scaling Functions ============
    
    /**
     * @dev Scale amount to 18 decimals
     * @param amount Amount to scale
     * @param decimals Current decimal precision
     * @return Scaled amount in 18 decimals
     */
    function scaleTo18Decimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return amount;
        return amount * (10 ** (18 - decimals));
    }

    /**
     * @dev Scale amount from 18 decimals to target decimals
     * @param amount Amount in 18 decimals
     * @param decimals Target decimal precision
     * @return Scaled amount in target decimals
     */
    function scaleFrom18Decimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return amount;
        
        uint256 divisor = 10 ** (18 - decimals);
        
        // Use rounding instead of truncation to prevent small amounts from becoming 0
        // Add half the divisor before dividing to round to nearest value
        return (amount + divisor / 2) / divisor;
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
    
    // ============ View Functions for Isolated Positions ============
    
    /**
     * @dev Get user's active isolated positions
     * @param trader Trader address
     * @return positions Array of position IDs
     */
    function getUserPositions(address trader) external view returns (uint256[] memory) {
        return userPositionIds[trader];
    }
    
    /**
     * @dev Get detailed position information
     * @param trader Trader address
     * @param positionId Position ID
     * @return position The isolated position details
     */
    function getPosition(address trader, uint256 positionId) external view returns (IsolatedPosition memory) {
        return userIsolatedPositions[trader][positionId];
    }
    
    /**
     * @dev Check if a position is at risk of liquidation
     * @param trader Trader address
     * @param positionId Position ID
     * @return atRisk Whether position is at risk
     * @return healthPercentage Position health (100% = liquidation price)
     */
    function checkPositionHealth(address trader, uint256 positionId) external view returns (bool atRisk, uint256 healthPercentage) {
        IsolatedPosition memory position = userIsolatedPositions[trader][positionId];
        if (!position.isActive) {
            return (false, 0);
        }
        
        uint256 currentPrice = calculateMarkPrice();
        
        if (position.size > 0) {
            // Long position
            if (currentPrice <= position.liquidationPrice) {
                return (true, 100); // At or past liquidation
            }
            healthPercentage = ((currentPrice - position.liquidationPrice) * 10000) / (position.entryPrice - position.liquidationPrice);
        } else {
            // Short position
            if (currentPrice >= position.liquidationPrice) {
                return (true, 100); // At or past liquidation
            }
            healthPercentage = ((position.liquidationPrice - currentPrice) * 10000) / (position.liquidationPrice - position.entryPrice);
        }
        
        // Consider at risk if health < 150%
        atRisk = healthPercentage < 15000;
        
        return (atRisk, healthPercentage);
    }
    
    
    /**
     * @dev Get total system shortfall
     * @return Total shortfall amount pending socialization
     */
    function getTotalShortfall() external view returns (uint256) {
        return totalShortfall;
    }
}
