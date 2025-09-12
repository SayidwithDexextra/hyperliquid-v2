// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

// Interface for OrderBook mark price calculation
interface IOrderBook {
    function calculateMarkPrice() external view returns (uint256);
}

/**
 * @title CentralizedVault
 * @dev Centralized vault for handling collateral, portfolio management, and settlement
 * @notice Integrates with OrderBook for margin-based derivatives trading
 */
contract CentralizedVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // ============ Constants (Must Mirror OrderBook) ============
    uint256 public constant ALU_DECIMALS = 18;          // ALU token has 18 decimals
    uint256 public constant USDC_DECIMALS = 6;          // USDC token has 6 decimals
    uint256 public constant DECIMAL_SCALE = 1e12;       // 10^(ALU_DECIMALS - USDC_DECIMALS)
    uint256 public constant TICK_PRECISION = 1e6;       // Price ticks in USDC precision (6 decimals)

    // ============ Data Structures ============

    /**
     * @dev Comprehensive margin summary for a user
     */
    struct MarginSummary {
        uint256 totalCollateral;      // Total deposited collateral
        uint256 marginUsed;           // Margin locked in open positions
        uint256 marginReserved;       // Margin reserved for pending orders
        uint256 availableCollateral;  // Free collateral
        int256 realizedPnL;          // Realized profit/loss
        int256 unrealizedPnL;        // Unrealized profit/loss
        int256 portfolioValue;       // Total portfolio value
    }

    /**
     * @dev Position data structure (backward compatible)
     */
    struct Position {
        bytes32 marketId;
        int256 size;                 // Net position size (positive for long, negative for short)
        uint256 entryPrice;          // Volume-weighted average entry price
        uint256 marginLocked;        // Margin locked for this position
        uint256 timestamp;           // When position was last modified
    }

    /**
     * @dev Enhanced Position data structure with netting support (internal use)
     */
    struct EnhancedPosition {
        bytes32 marketId;
        int256 size;                 // Net position size (positive for long, negative for short)
        uint256 entryPrice;          // Volume-weighted average entry price
        uint256 marginLocked;        // Margin locked for this position
        uint256 timestamp;           // When position was last modified
        uint256 totalVolume;         // Total volume traded for VWAP calculation
        uint256 realizedPnL;         // Accumulated realized P&L from partial closes
    }

    /**
     * @dev Position netting result for atomic operations
     */
    struct PositionNettingResult {
        bool positionExists;         // Whether user had existing position
        int256 oldSize;              // Previous position size
        int256 newSize;              // New net position size
        uint256 newEntryPrice;       // New volume-weighted entry price
        uint256 realizedPnL;         // P&L realized from netting
        bool pnlIsProfit;            // Whether realized P&L is profit or loss
        uint256 closedUnits;         // Number of units closed/netted
        bool positionClosed;         // Whether position was fully closed
        bool positionFlipped;        // Whether position changed direction
    }

    /**
     * @dev Pending order data structure
     */
    struct PendingOrder {
        bytes32 orderId;
        bytes32 marketId;
        uint256 marginReserved;
        uint256 timestamp;
    }

    // ============ Storage ============

    // Collateral token
    IERC20 public collateralToken;

    // User storage mappings
    mapping(address => uint256) public userCollateral;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => Position[]) public userPositions;
    mapping(address => PendingOrder[]) public userPendingOrders;
    mapping(address => mapping(bytes32 => uint256)) public userMarginByMarket;
    
    // Enhanced position storage for netting system (internal)
    mapping(address => mapping(bytes32 => EnhancedPosition)) internal userEnhancedPositions;
    mapping(address => bytes32[]) internal userMarketIds; // Track which markets user has positions in

    // Market data
    mapping(bytes32 => uint256) public marketMarkPrices;
    mapping(bytes32 => bool) public authorizedMarkets;
    mapping(bytes32 => address) public marketToOrderBook; // marketId => orderBook address

    // OrderBook management
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets; // orderBook => marketIds[]
    address[] public allOrderBooks;

    // Global state
    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;
    uint256 public totalFeesCollected;

    // ============ Events ============

    // Collateral events
    event CollateralDeposited(address indexed user, uint256 amount, uint256 newBalance);
    event CollateralWithdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event CollateralTransferred(address indexed from, address indexed to, uint256 amount);

    // Margin events
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLocked);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLocked);
    event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event PositionMarginRecalculated(address indexed user, bytes32 indexed marketId, uint256 oldMargin, uint256 newMargin);

    // Position events
    event PositionUpdated(
        address indexed user,
        bytes32 indexed marketId,
        int256 oldSize,
        int256 newSize,
        uint256 entryPrice,
        uint256 marginLocked
    );

    // P&L and settlement events
    event PnLRealized(address indexed user, bytes32 indexed marketId, int256 pnl, int256 totalRealizedPnL);
    event FeesDeducted(address indexed user, uint256 feeAmount, address indexed feeRecipient);
    event PortfolioUpdated(address indexed user, int256 portfolioValue);
    
    // Position Netting Events
    event RealizedPnL(address indexed user, bytes32 indexed marketId, uint256 pnlAmount, bool isProfit, uint256 closedUnits);
    event PositionFlipped(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize);
    event PositionNetted(address indexed user, bytes32 indexed marketId, uint256 nettedUnits, uint256 realizedPnL, bool isProfit);

    // Market events
    event MarkPriceUpdated(bytes32 indexed marketId, uint256 oldPrice, uint256 newPrice);
    event MarketAuthorizationChanged(bytes32 indexed marketId, bool authorized);

    // Administrative events
    event CollateralTokenUpdated(address indexed oldToken, address indexed newToken);
    event CollateralMigrationRequired(address indexed oldToken, address indexed newToken);
    event ContractPauseStatusChanged(bool paused);

    // OrderBook management events
    event OrderBookRegistered(address indexed orderBook, address indexed registeredBy);
    event OrderBookDeregistered(address indexed orderBook, address indexed deregisteredBy);
    event MarketAssignedToOrderBook(bytes32 indexed marketId, address indexed orderBook);

    // ============ Modifiers ============

    modifier onlyAuthorizedMarket(bytes32 marketId) {
        require(authorizedMarkets[marketId], "CentralizedVault: market not authorized");
        _;
    }

    modifier validAddress(address addr) {
        require(addr != address(0), "CentralizedVault: zero address");
        _;
    }

    modifier positiveAmount(uint256 amount) {
        require(amount > 0, "CentralizedVault: amount must be positive");
        _;
    }

    // ============ Constructor ============

    constructor(
        address _collateralToken,
        address _admin
    ) validAddress(_collateralToken) validAddress(_admin) {
        collateralToken = IERC20(_collateralToken);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SETTLEMENT_ROLE, _admin);
    }

    // ============ Collateral Management ============

    /**
     * @dev Deposit USDC collateral into the vault
     * @param amount Amount of USDC to deposit
     */
    function depositCollateral(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        positiveAmount(amount) 
    {
        // Transfer collateral from user
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balances
        userCollateral[msg.sender] += amount;
        totalCollateralDeposited += amount;
        
        emit CollateralDeposited(msg.sender, amount, userCollateral[msg.sender]);
        emit PortfolioUpdated(msg.sender, getPortfolioValue(msg.sender));
    }

    /**
     * @dev Withdraw available collateral from the vault
     * @param amount Amount of USDC to withdraw
     */
    function withdrawCollateral(uint256 amount) 
        external 
        nonReentrant 
        whenNotPaused 
        positiveAmount(amount) 
    {
        uint256 availableCollateral = getAvailableCollateral(msg.sender);
        require(
            amount <= availableCollateral,
            string(abi.encodePacked(
                "CentralizedVault: insufficient available collateral. Requested: ",
                amount.toString(),
                ", Available: ",
                availableCollateral.toString()
            ))
        );

        // Update balances
        userCollateral[msg.sender] -= amount;
        totalCollateralDeposited -= amount;
        
        // Transfer collateral to user
        collateralToken.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, amount, userCollateral[msg.sender]);
        emit PortfolioUpdated(msg.sender, getPortfolioValue(msg.sender));
    }

    // ============ Margin Management (OrderBook Integration) ============

    /**
     * @dev Lock margin for a position (called by OrderBook)
     * @param user User address
     * @param marketId Market identifier
     * @param amount Amount of margin to lock
     */
    function lockMargin(
        address user,
        bytes32 marketId,
        uint256 amount
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        onlyAuthorizedMarket(marketId)
        validAddress(user)
        positiveAmount(amount) 
    {
        uint256 availableCollateral = getAvailableCollateral(user);
        require(
            amount <= availableCollateral,
            string(abi.encodePacked(
                "CentralizedVault: insufficient collateral to lock margin. User: ",
                Strings.toHexString(user),
                ", Requested: ",
                amount.toString(),
                ", Available: ",
                availableCollateral.toString()
            ))
        );

        userMarginByMarket[user][marketId] += amount;
        totalMarginLocked += amount;
        
        emit MarginLocked(user, marketId, amount, userMarginByMarket[user][marketId]);
    }

    /**
     * @dev Release margin from a position (called by OrderBook)
     * @param user User address
     * @param marketId Market identifier
     * @param amount Amount of margin to release
     */
    function releaseMargin(
        address user,
        bytes32 marketId,
        uint256 amount
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        validAddress(user)
        positiveAmount(amount) 
    {
        require(
            userMarginByMarket[user][marketId] >= amount,
            string(abi.encodePacked(
                "CentralizedVault: insufficient locked margin to release. User: ",
                Strings.toHexString(user),
                ", Market: ",
                Strings.toHexString(uint256(marketId)),
                ", Requested: ",
                amount.toString(),
                ", Locked: ",
                userMarginByMarket[user][marketId].toString()
            ))
        );

        userMarginByMarket[user][marketId] -= amount;
        totalMarginLocked -= amount;
        
        emit MarginReleased(user, marketId, amount, userMarginByMarket[user][marketId]);
    }

    /**
     * @dev Reserve margin for a pending order (called by OrderBook)
     * @param user User address
     * @param orderId Order identifier
     * @param marketId Market identifier
     * @param amount Amount of margin to reserve
     */
    function reserveMargin(
        address user,
        bytes32 orderId,
        bytes32 marketId,
        uint256 amount
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        onlyAuthorizedMarket(marketId)
        validAddress(user)
        positiveAmount(amount) 
    {
        uint256 availableCollateral = getAvailableCollateral(user);
        require(
            amount <= availableCollateral,
            string(abi.encodePacked(
                "CentralizedVault: insufficient collateral to reserve margin. User: ",
                Strings.toHexString(user),
                ", Requested: ",
                amount.toString(),
                ", Available: ",
                availableCollateral.toString()
            ))
        );

        // Check if order already exists
        for (uint256 i = 0; i < userPendingOrders[user].length; i++) {
            require(
                userPendingOrders[user][i].orderId != orderId,
                "CentralizedVault: order already has reserved margin"
            );
        }

        // Add pending order
        userPendingOrders[user].push(PendingOrder({
            orderId: orderId,
            marketId: marketId,
            marginReserved: amount,
            timestamp: block.timestamp
        }));

        emit MarginReserved(user, orderId, marketId, amount);
    }

    /**
     * @dev Unreserve margin for a cancelled/filled order (called by OrderBook)
     * @param user User address
     * @param orderId Order identifier
     */
    function unreserveMargin(
        address user,
        bytes32 orderId
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        validAddress(user) 
    {
        PendingOrder[] storage orders = userPendingOrders[user];
        bool found = false;
        uint256 reservedAmount = 0;

        // Find and remove the order
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                reservedAmount = orders[i].marginReserved;
                
                // Remove by swapping with last element
                orders[i] = orders[orders.length - 1];
                orders.pop();
                
                found = true;
                break;
            }
        }

        require(found, "CentralizedVault: order not found in pending orders");
        
        emit MarginUnreserved(user, orderId, reservedAmount);
    }
    
    /**
     * @dev Release excess margin when order executes at better price
     * @param user User address
     * @param orderId Order ID  
     * @param actualMarginNeeded Actual margin needed at execution price
     */
    function releaseExcessMargin(
        address user,
        bytes32 orderId,
        uint256 actualMarginNeeded
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        validAddress(user) 
    {
        PendingOrder[] storage orders = userPendingOrders[user];
        
        // Find the order and update its margin
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                uint256 currentMargin = orders[i].marginReserved;
                require(actualMarginNeeded <= currentMargin, "CentralizedVault: invalid margin adjustment");
                
                uint256 excessMargin = currentMargin - actualMarginNeeded;
                
                // Update the margin reservation
                orders[i].marginReserved = actualMarginNeeded;
                
                emit MarginReleased(user, orders[i].marketId, excessMargin, orders[i].marginReserved);
                return;
            }
        }
        
        revert("CentralizedVault: order not found");
    }

    // ============ Position Management ============

    /**
     * @dev Update position and handle margin atomically (called by OrderBook)
     * @param user User address
     * @param marketId Market identifier
     * @param sizeDelta Change in position size
     * @param entryPrice Price at which trade occurred
     * @param marginToLock Amount of margin to lock for new/increased positions
     */
    function updatePositionWithMargin(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 entryPrice,
        uint256 marginToLock
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        onlyAuthorizedMarket(marketId)
        validAddress(user) 
    {
        require(sizeDelta != 0, "CentralizedVault: size delta cannot be zero");
        require(entryPrice > 0, "CentralizedVault: entry price must be positive");

        // Lock margin if needed (for new positions or position increases)
        if (marginToLock > 0) {
            uint256 availableCollateral = getAvailableCollateral(user);
            require(availableCollateral >= marginToLock, "CentralizedVault: insufficient collateral for position margin");
            
            userMarginByMarket[user][marketId] += marginToLock;
            totalMarginLocked += marginToLock;
            emit MarginLocked(user, marketId, marginToLock, userMarginByMarket[user][marketId]);
        }

        // Execute position netting algorithm
        PositionNettingResult memory nettingResult = _executePositionNetting(
            user, 
            marketId, 
            sizeDelta, 
            entryPrice
        );

        // Apply the netting result
        _applyNettingResult(user, marketId, nettingResult);

        // Emit comprehensive events
        emit PositionUpdated(user, marketId, nettingResult.oldSize, nettingResult.newSize, nettingResult.newEntryPrice, 0);
        
        if (nettingResult.realizedPnL > 0) {
            emit RealizedPnL(user, marketId, nettingResult.realizedPnL, nettingResult.pnlIsProfit, nettingResult.closedUnits);
        }
        
        if (nettingResult.positionFlipped) {
            emit PositionFlipped(user, marketId, nettingResult.oldSize, nettingResult.newSize);
        }

        emit PortfolioUpdated(user, getPortfolioValue(user));
    }

    /**
     * @dev Update user position with intelligent netting (called by OrderBook)
     * @param user User address
     * @param marketId Market identifier
     * @param sizeDelta Change in position size
     * @param entryPrice Price at which trade occurred
     */
    function updatePosition(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 entryPrice
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        onlyAuthorizedMarket(marketId)
        validAddress(user) 
    {
        require(sizeDelta != 0, "CentralizedVault: size delta cannot be zero");
        require(entryPrice > 0, "CentralizedVault: entry price must be positive");

        // SECURITY FIX: Always enforce margin requirements for all positions
        // Calculate margin requirement for this trade
        uint256 marginToLock = 0;
        
        // Get current position (if exists)
        PositionNettingResult memory nettingResult = _executePositionNetting(
            user, 
            marketId, 
            sizeDelta, 
            entryPrice
        );
        
        // Calculate margin needed for the new position state
        if (!nettingResult.positionClosed && nettingResult.newSize != 0) {
            // Position still exists after netting, ensure proper margin
            uint256 absNewSize = uint256(nettingResult.newSize > 0 ? nettingResult.newSize : -nettingResult.newSize);
            uint256 notionalValue = (absNewSize * nettingResult.newEntryPrice) / (10**18);
            
            // Assume 100% margin requirement (10000 bps) for safety
            // This should be retrieved from OrderBook in production
            uint256 requiredMargin = notionalValue; // 100% margin
            uint256 currentMargin = userMarginByMarket[user][marketId];
            
            if (requiredMargin > currentMargin) {
                marginToLock = requiredMargin - currentMargin;
                
                // Check available collateral
                uint256 availableCollateral = getAvailableCollateral(user);
                require(availableCollateral >= marginToLock, 
                    "CentralizedVault: insufficient collateral for position margin");
                
                // Lock the additional margin
                userMarginByMarket[user][marketId] = requiredMargin;
                totalMarginLocked += marginToLock;
                emit MarginLocked(user, marketId, marginToLock, requiredMargin);
            }
        }

        // Apply the netting result
        _applyNettingResult(user, marketId, nettingResult);

        // FIXED: Emit comprehensive events with correct entry price
        emit PositionUpdated(user, marketId, nettingResult.oldSize, nettingResult.newSize, nettingResult.newEntryPrice, 0);
        
        if (nettingResult.realizedPnL > 0) {
            emit RealizedPnL(user, marketId, nettingResult.realizedPnL, nettingResult.pnlIsProfit, nettingResult.closedUnits);
        }
        
        if (nettingResult.positionFlipped) {
            emit PositionFlipped(user, marketId, nettingResult.oldSize, nettingResult.newSize);
        }

        emit PortfolioUpdated(user, getPortfolioValue(user));
    }

    /**
     * @dev Core position netting algorithm - the heart of the system
     * @param user User address
     * @param marketId Market identifier  
     * @param sizeDelta New order size (positive for long, negative for short)
     * @param newOrderPrice Execution price of new order
     * @return nettingResult Complete result of netting calculation
     */
    function _executePositionNetting(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 newOrderPrice
    ) internal view returns (PositionNettingResult memory nettingResult) {
        Position[] storage positions = userPositions[user];
        
        // Initialize result
        nettingResult.positionExists = false;
        nettingResult.oldSize = 0;
        nettingResult.newSize = sizeDelta;
        nettingResult.newEntryPrice = newOrderPrice;
        nettingResult.realizedPnL = 0;
        nettingResult.pnlIsProfit = false;
        nettingResult.closedUnits = 0;
        nettingResult.positionClosed = false;
        nettingResult.positionFlipped = false;

        // Find existing position
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                nettingResult.positionExists = true;
                nettingResult.oldSize = positions[i].size;
                
                // CORE NETTING LOGIC
                return _calculateDetailedPositionNetting(
                    positions[i],
                    sizeDelta,
                    newOrderPrice
                );
            }
        }

        // No existing position - standard new position
        nettingResult.newSize = sizeDelta;
        nettingResult.newEntryPrice = newOrderPrice;
        return nettingResult;
    }

    /**
     * @dev Calculate detailed position netting based on existing position and new order
     * @param existingPosition Current user position
     * @param sizeDelta New order size
     * @param newOrderPrice New order execution price
     * @return nettingResult Detailed netting calculation result
     */
    function _calculateDetailedPositionNetting(
        Position memory existingPosition,
        int256 sizeDelta,
        uint256 newOrderPrice
    ) internal pure returns (PositionNettingResult memory nettingResult) {
        nettingResult.positionExists = true;
        nettingResult.oldSize = existingPosition.size;
        
        // Check if positions are in opposite directions (netting scenario)
        bool isNettingTrade = (existingPosition.size > 0 && sizeDelta < 0) || 
                             (existingPosition.size < 0 && sizeDelta > 0);
        
        if (!isNettingTrade) {
            // SAME DIRECTION: Calculate new VWAP
            return _calculateSameDirectionPosition(existingPosition, sizeDelta, newOrderPrice);
        }

        // OPPOSITE DIRECTION: Execute netting algorithm
        return _calculateOppositeDirectionNetting(existingPosition, sizeDelta, newOrderPrice);
    }

    /**
     * @dev Handle same-direction position increase (calculate VWAP)
     * FIXED: Improved precision and error handling for VWAP calculation
     */
    function _calculateSameDirectionPosition(
        Position memory existingPosition,
        int256 sizeDelta,
        uint256 newOrderPrice
    ) internal pure returns (PositionNettingResult memory nettingResult) {
        nettingResult.positionExists = true;
        nettingResult.oldSize = existingPosition.size;
        nettingResult.newSize = existingPosition.size + sizeDelta;
        nettingResult.realizedPnL = 0;
        nettingResult.pnlIsProfit = false;
        nettingResult.closedUnits = 0;
        nettingResult.positionClosed = false;
        nettingResult.positionFlipped = false;

        // Calculate volume-weighted average price (VWAP) with improved precision
        uint256 existingAbsSize = uint256(existingPosition.size > 0 ? existingPosition.size : -existingPosition.size);
        uint256 newOrderAbsSize = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
        uint256 newAbsSize = uint256(nettingResult.newSize > 0 ? nettingResult.newSize : -nettingResult.newSize);
        
        // Ensure we don't divide by zero
        require(newAbsSize > 0, "CentralizedVault: invalid position size after netting");
        
        // Calculate volumes with proper precision
        uint256 existingVolume = existingAbsSize * existingPosition.entryPrice;
        uint256 newVolume = newOrderAbsSize * newOrderPrice;
        uint256 totalVolume = existingVolume + newVolume;
        
        // Calculate VWAP with proper rounding
        nettingResult.newEntryPrice = (totalVolume + newAbsSize / 2) / newAbsSize; // Round to nearest
        
        return nettingResult;
    }

    /**
     * @dev Handle opposite-direction netting (the core algorithm)
     * FIXED: Ensures proper entry price preservation for partial closes
     * This implements the three key scenarios:
     * CASE A: New Order < Existing Position (partial close)
     * CASE B: New Order = Existing Position (full close) 
     * CASE C: New Order > Existing Position (close + flip)
     */
    function _calculateOppositeDirectionNetting(
        Position memory existingPosition,
        int256 sizeDelta,
        uint256 newOrderPrice
    ) internal pure returns (PositionNettingResult memory nettingResult) {
        nettingResult.positionExists = true;
        nettingResult.oldSize = existingPosition.size;
        
        // Calculate absolute sizes for comparison
        uint256 existingAbsSize = uint256(existingPosition.size > 0 ? existingPosition.size : -existingPosition.size);
        uint256 newOrderAbsSize = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
        
        // Determine how much will be netted (closed)
        uint256 nettedUnits = existingAbsSize < newOrderAbsSize ? existingAbsSize : newOrderAbsSize;
        nettingResult.closedUnits = nettedUnits;
        
        // Calculate realized P&L on netted portion
        // P&L = (Exit Price - Entry Price) * Units Closed * Direction
        // FIXED: Convert from 24 decimals to 6 decimals (USDC precision)
        int256 priceDifference = int256(newOrderPrice) - int256(existingPosition.entryPrice);
        int256 directionMultiplier = existingPosition.size > 0 ? int256(1) : int256(-1);
        // Price is in 6 decimals, nettedUnits in 18 decimals, so result is 24 decimals
        // Divide by 10^18 to get USDC amount in 6 decimals
        int256 realizedPnLSigned = (priceDifference * int256(nettedUnits) * directionMultiplier) / int256(10**18);
        
        nettingResult.realizedPnL = uint256(realizedPnLSigned > 0 ? realizedPnLSigned : -realizedPnLSigned);
        nettingResult.pnlIsProfit = realizedPnLSigned > 0;
        
        // Calculate final position size based on the three cases
        if (existingAbsSize == newOrderAbsSize) {
            // CASE B: Exact netting - position fully closed
            nettingResult.newSize = 0;
            nettingResult.newEntryPrice = 0;
            nettingResult.positionClosed = true;
            nettingResult.positionFlipped = false;
            
        } else if (existingAbsSize > newOrderAbsSize) {
            // CASE A: Partial netting - existing position reduced
            // Example: LONG 50 + SHORT 40 = LONG 10 (keep original entry price)
            uint256 remainingUnits = existingAbsSize - newOrderAbsSize;
            nettingResult.newSize = existingPosition.size > 0 ? int256(remainingUnits) : -int256(remainingUnits);
            
            // CRITICAL FIX: Always preserve original entry price for partial closes
            nettingResult.newEntryPrice = existingPosition.entryPrice;
            nettingResult.positionClosed = false;
            nettingResult.positionFlipped = false;
            
        } else {
            // CASE C: Over-netting - position flips direction  
            // Example: LONG 50 + SHORT 60 = SHORT 10 (use new order price)
            uint256 residualUnits = newOrderAbsSize - existingAbsSize;
            nettingResult.newSize = sizeDelta > 0 ? int256(residualUnits) : -int256(residualUnits);
            
            // Use new order price for flipped position
            nettingResult.newEntryPrice = newOrderPrice;
            nettingResult.positionClosed = false;
            nettingResult.positionFlipped = true;
        }
        
        return nettingResult;
    }

    /**
     * @dev Apply netting result to user's position
     * @param user User address
     * @param marketId Market identifier
     * @param nettingResult Result from netting calculation
     */
    function _applyNettingResult(
        address user,
        bytes32 marketId,
        PositionNettingResult memory nettingResult
    ) internal {
        Position[] storage positions = userPositions[user];
        
        // If position is being closed or reduced, release proportional margin first
        if (nettingResult.positionExists && (nettingResult.positionClosed || nettingResult.closedUnits > 0)) {
            // Calculate margin to release based on closed units
            uint256 currentMarginLocked = userMarginByMarket[user][marketId];
            uint256 marginToRelease = 0;
            
            if (nettingResult.positionClosed) {
                // Full close - release all margin
                marginToRelease = currentMarginLocked;
            } else if (nettingResult.closedUnits > 0) {
                // Partial close - release proportional margin
                uint256 oldAbsSize = uint256(nettingResult.oldSize > 0 ? nettingResult.oldSize : -nettingResult.oldSize);
                if (oldAbsSize > 0) {
                    marginToRelease = (currentMarginLocked * nettingResult.closedUnits) / oldAbsSize;
                }
            }
            
            // Release the margin
            if (marginToRelease > 0) {
                totalMarginLocked -= marginToRelease;
                userMarginByMarket[user][marketId] -= marginToRelease;
            }
        }
        
        // Credit/debit realized P&L to user's balance
        if (nettingResult.realizedPnL > 0) {
            if (nettingResult.pnlIsProfit) {
                userCollateral[user] += nettingResult.realizedPnL;
                userRealizedPnL[user] += int256(nettingResult.realizedPnL);
            } else {
                // For losses, check total collateral (margin has been released above)
                require(userCollateral[user] >= nettingResult.realizedPnL, "CentralizedVault: insufficient collateral for loss");
                userCollateral[user] -= nettingResult.realizedPnL;
                userRealizedPnL[user] -= int256(nettingResult.realizedPnL);
            }
        }

        if (!nettingResult.positionExists) {
            // New position - add to both storage systems
            positions.push(Position({
                marketId: marketId,
                size: nettingResult.newSize,
                entryPrice: nettingResult.newEntryPrice,
                marginLocked: userMarginByMarket[user][marketId],
                timestamp: block.timestamp
            }));
            
            // Add to enhanced position storage
            userEnhancedPositions[user][marketId] = EnhancedPosition({
                marketId: marketId,
                size: nettingResult.newSize,
                entryPrice: nettingResult.newEntryPrice,
                marginLocked: userMarginByMarket[user][marketId],
                timestamp: block.timestamp,
                totalVolume: uint256(nettingResult.newSize > 0 ? nettingResult.newSize : -nettingResult.newSize) * nettingResult.newEntryPrice,
                realizedPnL: 0
            });
            
            // Track market ID
            userMarketIds[user].push(marketId);
            
        } else {
            // Update existing position in both storage systems
            for (uint256 i = 0; i < positions.length; i++) {
                if (positions[i].marketId == marketId) {
                    if (nettingResult.positionClosed) {
                        // Remove closed position from both systems
                        positions[i] = positions[positions.length - 1];
                        positions.pop();
                        
                        delete userEnhancedPositions[user][marketId];
                        
                        // Remove from market ID tracking
                        bytes32[] storage marketIds = userMarketIds[user];
                        for (uint256 j = 0; j < marketIds.length; j++) {
                            if (marketIds[j] == marketId) {
                                marketIds[j] = marketIds[marketIds.length - 1];
                                marketIds.pop();
                                break;
                            }
                        }
                    } else {
                        // Update position in both systems
                        positions[i].size = nettingResult.newSize;
                        positions[i].entryPrice = nettingResult.newEntryPrice;
                        positions[i].timestamp = block.timestamp;
                        positions[i].marginLocked = userMarginByMarket[user][marketId]; // Fix: Update marginLocked
                        
                        // Update enhanced position
                        EnhancedPosition storage enhancedPos = userEnhancedPositions[user][marketId];
                        enhancedPos.size = nettingResult.newSize;
                        enhancedPos.entryPrice = nettingResult.newEntryPrice;
                        enhancedPos.timestamp = block.timestamp;
                        enhancedPos.marginLocked = userMarginByMarket[user][marketId]; // Fix: Update marginLocked
                        enhancedPos.realizedPnL += nettingResult.realizedPnL;
                        
                        // Update total volume for VWAP tracking
                        enhancedPos.totalVolume = uint256(nettingResult.newSize > 0 ? nettingResult.newSize : -nettingResult.newSize) * nettingResult.newEntryPrice;
                    }
                    break;
                }
            }
        }
    }

    // ============ Portfolio Calculation Functions ============

    /**
     * @dev Calculate available collateral for a user
     * @param user User address
     * @return Available collateral amount
     */
    function getAvailableCollateral(address user) public view returns (uint256) {
        uint256 totalCollateral = userCollateral[user];
        uint256 marginUsed = getTotalMarginUsed(user);
        uint256 marginReserved = getTotalMarginReserved(user);
        
        uint256 totalUsed = marginUsed + marginReserved;
        
        if (totalCollateral >= totalUsed) {
            return totalCollateral - totalUsed;
        } else {
            return 0;
        }
    }

    /**
     * @dev Calculate total margin used across all positions
     * @param user User address
     * @return Total margin used
     */
    function getTotalMarginUsed(address user) public view returns (uint256) {
        uint256 totalMargin = 0;
        bytes32[] storage marketIds = userMarketIds[user];
        
        // Sum up margin from all markets where user has positions
        for (uint256 i = 0; i < marketIds.length; i++) {
            totalMargin += userMarginByMarket[user][marketIds[i]];
        }
        
        return totalMargin;
    }

    /**
     * @dev Calculate total margin reserved for pending orders
     * @param user User address
     * @return Total margin reserved
     */
    function getTotalMarginReserved(address user) public view returns (uint256) {
        uint256 totalReserved = 0;
        PendingOrder[] storage orders = userPendingOrders[user];
        
        for (uint256 i = 0; i < orders.length; i++) {
            totalReserved += orders[i].marginReserved;
        }
        
        return totalReserved;
    }

    /**
     * @dev Get the current mark price for a market
     * @param marketId Market identifier
     * @return Current mark price (6 decimals)
     * @notice Tries to get dynamic price from OrderBook, falls back to stored price
     */
    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        address orderBook = marketToOrderBook[marketId];
        
        // If we have an OrderBook for this market, get its calculated mark price
        if (orderBook != address(0)) {
            try IOrderBook(orderBook).calculateMarkPrice() returns (uint256 dynamicPrice) {
                if (dynamicPrice > 0) {
                    return dynamicPrice;
                }
            } catch {
                // Fall through to stored price if OrderBook call fails
            }
        }
        
        // Fallback to stored mark price
        return marketMarkPrices[marketId];
    }

    /**
     * @dev Calculate unrealized P&L across all positions
     * @param user User address
     * @return Unrealized P&L
     */
    function getUnrealizedPnL(address user) public view returns (int256) {
        int256 totalUnrealizedPnL = 0;
        Position[] storage positions = userPositions[user];
        
        for (uint256 i = 0; i < positions.length; i++) {
            Position storage position = positions[i];
            uint256 markPrice = getMarkPrice(position.marketId); // Use dynamic mark price
            
            if (markPrice > 0 && position.size != 0) {
                // Calculate P&L: (markPrice - entryPrice) * size / TICK_PRECISION
                int256 priceDiff = int256(markPrice) - int256(position.entryPrice);
                int256 positionPnL = (priceDiff * position.size) / int256(TICK_PRECISION);
                totalUnrealizedPnL += positionPnL;
            }
        }
        
        return totalUnrealizedPnL;
    }

    /**
     * @dev Calculate total portfolio value including P&L
     * @param user User address
     * @return Portfolio value
     */
    function getPortfolioValue(address user) public view returns (int256) {
        int256 collateralValue = int256(userCollateral[user]);
        int256 realizedPnL = userRealizedPnL[user];
        int256 unrealizedPnL = getUnrealizedPnL(user);
        
        return collateralValue + realizedPnL + unrealizedPnL;
    }

    /**
     * @dev Get comprehensive margin summary for a user
     * @param user User address
     * @return MarginSummary struct with all portfolio data
     */
    function getMarginSummary(address user) external view returns (MarginSummary memory) {
        return MarginSummary({
            totalCollateral: userCollateral[user],
            marginUsed: getTotalMarginUsed(user),
            marginReserved: getTotalMarginReserved(user),
            availableCollateral: getAvailableCollateral(user),
            realizedPnL: userRealizedPnL[user],
            unrealizedPnL: getUnrealizedPnL(user),
            portfolioValue: getPortfolioValue(user)
        });
    }

    // ============ Settlement Functions ============

    /**
     * @dev Realize P&L for a user (called by OrderBook or settlement system)
     * @param user User address
     * @param marketId Market identifier
     * @param pnl P&L amount to realize
     */
    function realizePnL(
        address user,
        bytes32 marketId,
        int256 pnl
    ) 
        external 
        onlyRole(SETTLEMENT_ROLE) 
        validAddress(user) 
    {
        userRealizedPnL[user] += pnl;
        
        emit PnLRealized(user, marketId, pnl, userRealizedPnL[user]);
        emit PortfolioUpdated(user, getPortfolioValue(user));
    }

    /**
     * @dev Transfer collateral between users for spot trades (called by OrderBook)
     * @param from User sending collateral
     * @param to User receiving collateral
     * @param amount Amount of collateral to transfer
     */
    function transferCollateral(
        address from,
        address to,
        uint256 amount
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        validAddress(from)
        validAddress(to)
        positiveAmount(amount) 
    {
        require(
            userCollateral[from] >= amount,
            string(abi.encodePacked(
                "CentralizedVault: insufficient collateral for transfer. User: ",
                Strings.toHexString(from),
                ", Required: ",
                amount.toString(),
                ", Available: ",
                userCollateral[from].toString()
            ))
        );

        // Transfer collateral between users
        userCollateral[from] -= amount;
        userCollateral[to] += amount;
        
        emit CollateralTransferred(from, to, amount);
        emit PortfolioUpdated(from, getPortfolioValue(from));
        emit PortfolioUpdated(to, getPortfolioValue(to));
    }

    /**
     * @dev Deduct trading fees from user collateral
     * @param user User address
     * @param feeAmount Fee amount to deduct
     * @param feeRecipient Address to receive the fees
     */
    function deductFees(
        address user,
        uint256 feeAmount,
        address feeRecipient
    ) 
        external 
        onlyRole(ORDERBOOK_ROLE) 
        validAddress(user)
        validAddress(feeRecipient)
        positiveAmount(feeAmount) 
    {
        require(
            userCollateral[user] >= feeAmount,
            string(abi.encodePacked(
                "CentralizedVault: insufficient collateral for fees. User: ",
                Strings.toHexString(user),
                ", Required: ",
                feeAmount.toString(),
                ", Available: ",
                userCollateral[user].toString()
            ))
        );

        userCollateral[user] -= feeAmount;
        totalFeesCollected += feeAmount;
        
        // Transfer fees to recipient
        collateralToken.safeTransfer(feeRecipient, feeAmount);
        
        emit FeesDeducted(user, feeAmount, feeRecipient);
        emit PortfolioUpdated(user, getPortfolioValue(user));
    }

    /**
     * @dev Update mark price for a market
     * @param marketId Market identifier
     * @param markPrice New mark price
     */
    function updateMarkPrice(
        bytes32 marketId,
        uint256 markPrice
    ) 
        external 
        onlyRole(SETTLEMENT_ROLE) 
        onlyAuthorizedMarket(marketId)
        positiveAmount(markPrice) 
    {
        uint256 oldPrice = marketMarkPrices[marketId];
        marketMarkPrices[marketId] = markPrice;
        
        emit MarkPriceUpdated(marketId, oldPrice, markPrice);
    }

    // ============ OrderBook Management Functions ============

    /**
     * @dev Register a new OrderBook contract
     * @param orderBook Address of the OrderBook contract
     */
    function registerOrderBook(address orderBook) 
        external 
        onlyRole(FACTORY_ROLE) 
        validAddress(orderBook) 
    {
        require(!registeredOrderBooks[orderBook], "CentralizedVault: OrderBook already registered");
        
        registeredOrderBooks[orderBook] = true;
        allOrderBooks.push(orderBook);
        
        // Grant ORDERBOOK_ROLE to the new OrderBook
        _grantRole(ORDERBOOK_ROLE, orderBook);
        
        emit OrderBookRegistered(orderBook, msg.sender);
    }

    /**
     * @dev Deregister an OrderBook contract
     * @param orderBook Address of the OrderBook contract
     */
    function deregisterOrderBook(address orderBook) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
        validAddress(orderBook) 
    {
        require(registeredOrderBooks[orderBook], "CentralizedVault: OrderBook not registered");
        
        registeredOrderBooks[orderBook] = false;
        
        // Remove from allOrderBooks array
        for (uint256 i = 0; i < allOrderBooks.length; i++) {
            if (allOrderBooks[i] == orderBook) {
                allOrderBooks[i] = allOrderBooks[allOrderBooks.length - 1];
                allOrderBooks.pop();
                break;
            }
        }
        
        // Revoke ORDERBOOK_ROLE
        _revokeRole(ORDERBOOK_ROLE, orderBook);
        
        // Deauthorize all markets associated with this OrderBook
        bytes32[] storage markets = orderBookToMarkets[orderBook];
        for (uint256 i = 0; i < markets.length; i++) {
            authorizedMarkets[markets[i]] = false;
            delete marketToOrderBook[markets[i]];
            emit MarketAuthorizationChanged(markets[i], false);
        }
        delete orderBookToMarkets[orderBook];
        
        emit OrderBookDeregistered(orderBook, msg.sender);
    }

    /**
     * @dev Assign a market to a specific OrderBook
     * @param marketId Market identifier
     * @param orderBook OrderBook address
     */
    function assignMarketToOrderBook(
        bytes32 marketId,
        address orderBook
    ) 
        external 
        onlyRole(FACTORY_ROLE) 
        validAddress(orderBook) 
    {
        require(registeredOrderBooks[orderBook], "CentralizedVault: OrderBook not registered");
        require(!authorizedMarkets[marketId], "CentralizedVault: Market already authorized");
        
        authorizedMarkets[marketId] = true;
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarkets[orderBook].push(marketId);
        
        emit MarketAuthorizationChanged(marketId, true);
        emit MarketAssignedToOrderBook(marketId, orderBook);
    }

    // ============ Administrative Functions ============

    /**
     * @dev Set market authorization status (legacy function)
     * @param marketId Market identifier
     * @param authorized Authorization status
     */
    function setMarketAuthorization(
        bytes32 marketId,
        bool authorized
    ) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        authorizedMarkets[marketId] = authorized;
        emit MarketAuthorizationChanged(marketId, authorized);
    }

    /**
     * @dev Update collateral token address
     * @param newCollateralToken New collateral token address
     */
    function setCollateralToken(
        address newCollateralToken
    ) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
        validAddress(newCollateralToken) 
    {
        address oldToken = address(collateralToken);
        collateralToken = IERC20(newCollateralToken);
        
        emit CollateralTokenUpdated(oldToken, newCollateralToken);
        emit CollateralMigrationRequired(oldToken, newCollateralToken);
    }

    /**
     * @dev Emergency pause functionality
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        emit ContractPauseStatusChanged(true);
    }

    /**
     * @dev Unpause functionality
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        emit ContractPauseStatusChanged(false);
    }

    /**
     * @dev Recalculate and fix margin for under-margined positions
     * @param user User address
     * @param marketId Market identifier
     * @param marginRequirementBps Current margin requirement in basis points
     */
    function recalculatePositionMargin(
        address user,
        bytes32 marketId,
        uint256 marginRequirementBps
    ) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE)
        validAddress(user)
    {
        require(marginRequirementBps > 0 && marginRequirementBps <= 10000, "Invalid margin requirement");
        
        // Get the position
        Position[] storage positions = userPositions[user];
        bool positionFound = false;
        uint256 positionIndex;
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                positionFound = true;
                positionIndex = i;
                break;
            }
        }
        
        require(positionFound, "Position not found");
        Position storage position = positions[positionIndex];
        
        // Calculate required margin
        uint256 absSize = position.size >= 0 ? uint256(position.size) : uint256(-position.size);
        uint256 notionalValue = (absSize * position.entryPrice) / (10**18);
        uint256 requiredMargin = (notionalValue * marginRequirementBps) / 10000;
        uint256 currentMargin = userMarginByMarket[user][marketId];
        
        if (requiredMargin > currentMargin) {
            uint256 additionalMargin = requiredMargin - currentMargin;
            uint256 availableCollateral = getAvailableCollateral(user);
            
            require(availableCollateral >= additionalMargin, 
                "Insufficient collateral to fix margin");
            
            // Lock the additional margin
            userMarginByMarket[user][marketId] = requiredMargin;
            totalMarginLocked += additionalMargin;
            
            // Update position margin locked
            position.marginLocked = requiredMargin;
            
            // Update enhanced position if exists
            if (userEnhancedPositions[user][marketId].marketId == marketId) {
                userEnhancedPositions[user][marketId].marginLocked = requiredMargin;
            }
            
            emit MarginLocked(user, marketId, additionalMargin, requiredMargin);
            emit PositionMarginRecalculated(user, marketId, currentMargin, requiredMargin);
        }
    }

    // ============ View Functions ============

    /**
     * @dev Get user positions
     * @param user User address
     * @return Array of user positions
     */
    function getUserPositions(address user) external view returns (Position[] memory) {
        return userPositions[user];
    }

    /**
     * @dev Preview position netting result without executing
     * @param user User address
     * @param marketId Market identifier
     * @param sizeDelta Proposed order size
     * @param entryPrice Proposed execution price
     * @return nettingResult Preview of what would happen
     */
    function previewPositionNetting(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 entryPrice
    ) external view returns (PositionNettingResult memory nettingResult) {
        return _executePositionNetting(user, marketId, sizeDelta, entryPrice);
    }

    /**
     * @dev Get position netting summary for UI display
     * @param user User address
     * @param marketId Market identifier
     * @param sizeDelta Proposed order size
     * @param entryPrice Proposed execution price
     * @return summary Human-readable netting summary
     */
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
    ) {
        PositionNettingResult memory result = _executePositionNetting(user, marketId, sizeDelta, entryPrice);
        
        if (!result.positionExists) {
            summary = "New position will be created";
        } else if (result.positionClosed) {
            summary = "Position will be fully closed";
        } else if (result.positionFlipped) {
            summary = "Position will flip direction";
        } else {
            summary = "Position will be partially reduced";
        }
        
        return (summary, result.realizedPnL, result.pnlIsProfit, result.closedUnits, result.newSize);
    }

    /**
     * @dev Get enhanced position data with netting information
     * @param user User address
     * @param marketId Market identifier
     * @return enhancedPosition Enhanced position with netting data
     */
    function getEnhancedPosition(address user, bytes32 marketId) 
        external view returns (EnhancedPosition memory enhancedPosition) 
    {
        return userEnhancedPositions[user][marketId];
    }

    /**
     * @dev Get all market IDs where user has positions
     * @param user User address
     * @return marketIds Array of market IDs
     */
    function getUserMarketIds(address user) external view returns (bytes32[] memory marketIds) {
        return userMarketIds[user];
    }

    /**
     * @dev Get user pending orders
     * @param user User address
     * @return Array of user pending orders
     */
    function getUserPendingOrders(address user) external view returns (PendingOrder[] memory) {
        return userPendingOrders[user];
    }

    /**
     * @dev Get position by market for a user
     * @param user User address
     * @param marketId Market identifier
     * @return position Position data (size will be 0 if not found)
     */
    function getUserPositionByMarket(
        address user,
        bytes32 marketId
    ) external view returns (Position memory position) {
        Position[] storage positions = userPositions[user];
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return positions[i];
            }
        }
        
        // Return empty position if not found
        return Position({
            marketId: marketId,
            size: 0,
            entryPrice: 0,
            marginLocked: 0,
            timestamp: 0
        });
    }

    /**
     * @dev Get total number of positions for a user
     * @param user User address
     * @return Number of positions
     */
    function getUserPositionCount(address user) external view returns (uint256) {
        return userPositions[user].length;
    }

    /**
     * @dev Get total number of pending orders for a user
     * @param user User address
     * @return Number of pending orders
     */
    function getUserPendingOrderCount(address user) external view returns (uint256) {
        return userPendingOrders[user].length;
    }

    /**
     * @dev Get global vault statistics
     * @return totalDeposited Total collateral deposited
     * @return totalLocked Total margin locked
     * @return totalFees Total fees collected
     */
    function getGlobalStats() external view returns (
        uint256 totalDeposited,
        uint256 totalLocked,
        uint256 totalFees
    ) {
        return (totalCollateralDeposited, totalMarginLocked, totalFeesCollected);
    }

    /**
     * @dev Get all registered OrderBooks
     * @return Array of registered OrderBook addresses
     */
    function getAllOrderBooks() external view returns (address[] memory) {
        return allOrderBooks;
    }

    /**
     * @dev Get markets assigned to a specific OrderBook
     * @param orderBook OrderBook address
     * @return Array of market IDs
     */
    function getOrderBookMarkets(address orderBook) external view returns (bytes32[] memory) {
        return orderBookToMarkets[orderBook];
    }

    /**
     * @dev Get OrderBook assigned to a specific market
     * @param marketId Market identifier
     * @return OrderBook address (address(0) if not assigned)
     */
    function getMarketOrderBook(bytes32 marketId) external view returns (address) {
        return marketToOrderBook[marketId];
    }

    /**
     * @dev Check if an OrderBook is registered
     * @param orderBook OrderBook address
     * @return True if registered
     */
    function isOrderBookRegistered(address orderBook) external view returns (bool) {
        return registeredOrderBooks[orderBook];
    }

    /**
     * @dev Get total number of registered OrderBooks
     * @return Number of registered OrderBooks
     */
    function getOrderBookCount() external view returns (uint256) {
        return allOrderBooks.length;
    }

    // ============ Internal Helper Functions ============

    /**
     * @dev Calculate weighted average price for position increases
     */
    function _calculateWeightedAveragePrice(
        int256 oldSize,
        uint256 oldPrice,
        int256 sizeDelta,
        uint256 newPrice,
        int256 totalSize
    ) internal pure returns (uint256) {
        uint256 oldNotional = uint256(_abs(oldSize)) * oldPrice / TICK_PRECISION;
        uint256 deltaNotional = uint256(_abs(sizeDelta)) * newPrice / TICK_PRECISION;
        uint256 totalNotional = oldNotional + deltaNotional;
        
        if (totalNotional > 0) {
            return (totalNotional * TICK_PRECISION) / uint256(_abs(totalSize));
        } else {
            return newPrice;
        }
    }

    /**
     * @dev Get absolute value of an integer
     * @param x Integer value
     * @return Absolute value
     */
    function _abs(int256 x) internal pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    // ============ Emergency Cleanup Functions ============

    /**
     * @dev Emergency cleanup function to remove ghost margin reservations
     * @param user User address to clean up
     * @param orderIds Array of order IDs that no longer exist but have margin reserved
     */
    function cleanupGhostReservations(
        address user,
        bytes32[] calldata orderIds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) validAddress(user) {
        PendingOrder[] storage orders = userPendingOrders[user];
        uint256 totalCleaned = 0;
        
        for (uint256 i = 0; i < orderIds.length; i++) {
            bytes32 targetOrderId = orderIds[i];
            
            // Find and remove ghost reservations
            for (uint256 j = 0; j < orders.length; j++) {
                if (orders[j].orderId == targetOrderId) {
                    uint256 reservedAmount = orders[j].marginReserved;
                    totalCleaned += reservedAmount;
                    
                    // Remove by swapping with last element
                    orders[j] = orders[orders.length - 1];
                    orders.pop();
                    
                    emit MarginUnreserved(user, targetOrderId, reservedAmount);
                    break;
                }
            }
        }
        
        emit GhostReservationsCleanup(user, totalCleaned, orderIds.length);
    }

    // ============ Additional Events ============
    
    event GhostReservationsCleanup(address indexed user, uint256 totalCleaned, uint256 orderCount);
}
