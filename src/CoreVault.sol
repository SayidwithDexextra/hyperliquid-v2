// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";

// Interface for OrderBook
interface IOrderBook {
    function calculateMarkPrice() external view returns (uint256);
    function clearUserPosition(address user) external;
}

/**
 * @title CoreVault
 * @dev Minimal core vault with library delegation for complex operations
 * @notice Dramatically reduced contract size by extracting logic to libraries
 */
contract CoreVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // ============ Constants ============
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500; // 5%
    uint256 public constant SHORT_MARGIN_REQUIREMENT_BPS = 1500; // 150%
    uint256 public constant LONG_MARGIN_REQUIREMENT_BPS = 1000; // 100%
    uint256 public constant DECIMAL_SCALE = 1e12; // 10^(ALU_DECIMALS - USDC_DECIMALS)
    uint256 public constant TICK_PRECISION = 1e6; // Price ticks in USDC precision (6 decimals)

    // ============ P&L CALCULATION STANDARDS ============
    // Standard P&L Formula: (markPrice - entryPrice) * size / TICK_PRECISION
    // - markPrice: 6 decimals (USDC precision)
    // - entryPrice: 6 decimals (USDC precision)
    // - size: 18 decimals (ALU token precision)
    // - Result: 18 decimals (standard P&L precision)
    //
    // Liquidation Loss Formula: (priceUnit * size) / (DECIMAL_SCALE * TICK_PRECISION)  
    // - Result: 6 decimals (USDC precision for collateral deduction)
    // 
    // Use standard P&L for: position tracking, portfolio analysis, margin health
    // Use liquidation loss for: actual USDC amounts to confiscate from collateral

    // ============ State Variables ============
    IERC20 public immutable collateralToken;
    
    // Core user data
    mapping(address => uint256) public userCollateral;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => PositionManager.Position[]) public userPositions;
    mapping(address => VaultAnalytics.PendingOrder[]) public userPendingOrders;
    mapping(address => bytes32[]) public userMarketIds;
    
    // User tracking for socialized loss distribution
    address[] public allKnownUsers;
    mapping(address => bool) public isKnownUser;
    // REMOVED: userMarginByMarket - margin now tracked exclusively in Position structs
    
    // Market management
    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets;
    address[] public allOrderBooks;
    mapping(bytes32 => uint256) public marketMarkPrices;
    // Maintenance margin requirement per market (bps); default 10% when 0
    mapping(bytes32 => uint256) public maintenanceMarginBps;
    
    // Global stats
    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;

    // ============ Events ============
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    // Margin reservation events (compat with CentralizedVault)
    event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event MarketAuthorized(bytes32 indexed marketId, address indexed orderBook);
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
    
    // Enhanced liquidation events
    event AvailableCollateralConfiscated(address indexed user, uint256 amount, uint256 remainingAvailable);
    event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral);

    // ============ Constructor ============
    constructor(address _collateralToken, address _admin) {
        collateralToken = IERC20(_collateralToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Collateral Management ============
    
    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "!amount");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userCollateral[msg.sender] += amount;
        totalCollateralDeposited += amount;
        
        // Track user for socialized loss distribution
        _ensureUserTracked(msg.sender);
        
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "!amount");
        require(userCollateral[msg.sender] >= amount, "!balance");
        
        // Check available collateral through library
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[msg.sender].length);
        for (uint256 i = 0; i < userPositions[msg.sender].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[msg.sender][i].marketId,
                size: userPositions[msg.sender][i].size,
                entryPrice: userPositions[msg.sender][i].entryPrice,
                marginLocked: userPositions[msg.sender][i].marginLocked
            });
        }
        uint256 available = VaultAnalytics.getAvailableCollateral(userCollateral[msg.sender], positions);
        require(available >= amount, "!available");
        
        userCollateral[msg.sender] -= amount;
        totalCollateralDeposited -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ============ Position Management (Delegated to Library) ============
    
    function updatePositionWithMargin(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        uint256 requiredMargin
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        PositionManager.NettingResult memory result = PositionManager.executePositionNetting(
            userPositions[user],
            user,
            marketId,
            sizeDelta,
            executionPrice,
            requiredMargin
        );
        
        // Handle margin changes
        if (result.marginToLock > 0) {
            totalMarginLocked += result.marginToLock;
        }
        if (result.marginToRelease > 0) {
            totalMarginLocked -= result.marginToRelease;
        }
        
        // Handle realized P&L
        if (result.realizedPnL != 0) {
            userRealizedPnL[user] += result.realizedPnL;
        }
        
        // Update market IDs
        if (result.positionClosed) {
            PositionManager.removeMarketIdFromUser(userMarketIds[user], marketId);
        } else if (!result.positionExists) {
            PositionManager.addMarketIdToUser(userMarketIds[user], marketId);
        }
    }

    /**
     * @dev Update position with margin confiscation for liquidations
     * @param user User being liquidated
     * @param marketId Market identifier
     * @param sizeDelta Position size change (should close the position)
     * @param executionPrice Liquidation execution price
     * @param liquidator Address of the liquidator
     */
    function updatePositionWithLiquidation(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        // Find the position being liquidated
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                // Ensure this is actually closing the position (or a significant portion)
                int256 oldSize = positions[i].size;
                int256 newSize = oldSize + sizeDelta;
                
                // Only proceed if this significantly reduces the position (at least 50% closure)
                uint256 closurePercentage = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta) * 100 / uint256(oldSize > 0 ? oldSize : -oldSize);
                if (closurePercentage < 50) {
                    // Not a significant liquidation, treat as normal trade
                    PositionManager.NettingResult memory partialResult = PositionManager.executePositionNetting(
                        positions,
                        user,
                        marketId,
                        sizeDelta,
                        executionPrice,
                        0 // No additional margin required for liquidation
                    );
                    
                    // Handle margin changes normally
                    if (partialResult.marginToLock > 0) {
                        totalMarginLocked += partialResult.marginToLock;
                    }
                    if (partialResult.marginToRelease > 0) {
                        totalMarginLocked -= partialResult.marginToRelease;
                    }
                    
                    if (partialResult.realizedPnL != 0) {
                        userRealizedPnL[user] += partialResult.realizedPnL;
                    }
                    return;
                }
                
                // This is a significant liquidation - confiscate margin
                uint256 marginToConfiscate = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                
                // Calculate trading loss for liquidation (USDC amount for collateral deduction)
                // Note: This differs from standard P&L (18 decimals) as it calculates actual USDC loss
                uint256 tradingLoss = 0;
                if ((oldSize > 0 && executionPrice < entryPrice) || (oldSize < 0 && executionPrice > entryPrice)) {
                    // Position is at a loss - calculate USDC amount to confiscate
                    uint256 lossPerUnit = oldSize > 0 ? (entryPrice - executionPrice) : (executionPrice - entryPrice);
                    // Convert to USDC: (lossPerUnit_6dec * size_18dec) / (DECIMAL_SCALE_12dec * TICK_PRECISION_6dec) = 6 decimals
                    tradingLoss = (lossPerUnit * uint256(oldSize > 0 ? oldSize : -oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                
                // Apply liquidation penalty
                uint256 penalty = (marginToConfiscate * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 totalLoss = tradingLoss + penalty;
                
                // Cap total loss at user's available collateral
                if (totalLoss > userCollateral[user]) {
                    totalLoss = userCollateral[user];
                }
                
                // Confiscate the margin and apply losses
                if (totalLoss > 0) {
                    userCollateral[user] -= totalLoss;
                    
                    // Give liquidator the penalty portion only
                    uint256 liquidatorReward = penalty;
                    if (liquidatorReward > totalLoss) {
                        liquidatorReward = totalLoss;
                    }
                    if (liquidatorReward > 0) {
                        userCollateral[liquidator] += liquidatorReward;
                    }
                    
                    // Emit event to track actual margin confiscation
                    emit MarginConfiscated(user, marginToConfiscate, totalLoss, penalty, liquidator);
                }
                
                // CRITICAL FIX: Manually update position without releasing margin
                // We need to update the position but NOT release the margin since it's been confiscated
                
                // Calculate realized P&L for the liquidation
                int256 realizedPnL = 0;
                if (oldSize != 0) {
                    // Calculate P&L: (execution_price - entry_price) * original_position_size
                    int256 priceDiff = int256(executionPrice) - int256(entryPrice);
                    // FIX: Use oldSize (original position) to ensure correct sign for both long/short:
                    // - Long liquidation: price falls → priceDiff negative, oldSize positive → negative loss ✓
                    // - Short liquidation: price rises → priceDiff positive, oldSize negative → negative loss ✓
                    realizedPnL = (priceDiff * oldSize) / int256(TICK_PRECISION);
                }
                
                // Update position size directly without releasing margin
                positions[i].size = newSize;
                
                // If position is fully closed, remove it entirely
                if (newSize == 0) {
                    // Remove the position from the array (swap with last and pop)
                    if (i < positions.length - 1) {
                        positions[i] = positions[positions.length - 1];
                    }
                    positions.pop();
                    
                    // Remove market ID from user's list
                    PositionManager.removeMarketIdFromUser(userMarketIds[user], marketId);
                    
                    // CRITICAL: Reduce totalMarginLocked by the confiscated amount
                    // This represents the margin that was locked but is now confiscated (not released to user)
                    if (marginToConfiscate <= totalMarginLocked) {
                        totalMarginLocked -= marginToConfiscate;
                    }
                } else {
                    // Position partially closed - recalculate required margin for remaining position
                    uint256 newRequiredMargin = _calculateExecutionMargin(newSize, executionPrice);
                    uint256 marginDifference = 0;
                    
                    if (newRequiredMargin < positions[i].marginLocked) {
                        // Less margin needed for smaller position
                        marginDifference = positions[i].marginLocked - newRequiredMargin;
                        positions[i].marginLocked = newRequiredMargin;
                        
                        // CRITICAL: Don't release this margin difference - it's confiscated
                        // Reduce totalMarginLocked by the confiscated portion
                        if (marginDifference <= totalMarginLocked) {
                            totalMarginLocked -= marginDifference;
                        }
                    } else if (newRequiredMargin > positions[i].marginLocked) {
                        // More margin needed (shouldn't happen in liquidation, but handle safely)
                        uint256 additionalMargin = newRequiredMargin - positions[i].marginLocked;
                        if (additionalMargin <= userCollateral[user]) {
                            positions[i].marginLocked = newRequiredMargin;
                            totalMarginLocked += additionalMargin;
                        }
                        // If user doesn't have enough collateral, keep current margin locked
                    }
                }
                
                // Handle realized P&L (this includes the liquidation loss)
                if (realizedPnL != 0) {
                    userRealizedPnL[user] += realizedPnL;
                }
                
                emit LiquidationExecuted(user, marketId, liquidator, totalLoss, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, newSize, entryPrice, newSize == 0 ? 0 : positions[i].marginLocked);
                return;
            }
        }
        
        // No position found - this shouldn't happen in liquidation, but handle gracefully
        revert("No position found for liquidation");
    }

    /**
     * @dev Calculate margin required for a trade execution
     * @param amount Trade amount (can be negative for short positions)
     * @param executionPrice Actual execution price
     * @return Margin required for this execution
     */
    function _calculateExecutionMargin(int256 amount, uint256 executionPrice) internal pure returns (uint256) {
        // Calculate margin based on actual execution price
        uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
        uint256 notionalValue = (absAmount * executionPrice) / (10**18);
        
        // Apply different margin requirements based on position type
        // Long positions (positive amount): 100% margin (10000 bps)
        // Short positions (negative amount): 150% margin (15000 bps)
        uint256 marginBps = amount >= 0 ? 10000 : 15000;
        return (notionalValue * marginBps) / 10000;
    }

    // ============ Unified Margin Management Interface ============
    
    /**
     * @dev Get comprehensive margin data for a user - single source of truth
     * @param user User address
     * @return totalCollateral Total user collateral
     * @return marginUsedInPositions Margin locked in active positions
     * @return marginReservedForOrders Margin reserved for pending orders  
     * @return availableMargin Available margin for new positions/orders
     * @return realizedPnL Realized profit and loss
     * @return unrealizedPnL Unrealized profit and loss
     * @return totalMarginCommitted Total margin committed (used + reserved)
     * @return isMarginHealthy Whether margin position is healthy
     */
    function getUnifiedMarginSummary(address user) external view returns (
        uint256 totalCollateral,
        uint256 marginUsedInPositions,
        uint256 marginReservedForOrders,
        uint256 availableMargin,
        int256 realizedPnL,
        int256 unrealizedPnL,
        uint256 totalMarginCommitted,
        bool isMarginHealthy
    ) {
        // Get basic collateral and P&L
        totalCollateral = userCollateral[user];
        realizedPnL = userRealizedPnL[user];
        
        // Calculate margin used in active positions
        marginUsedInPositions = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            marginUsedInPositions += userPositions[user][i].marginLocked;
        }
        
        // Calculate margin reserved for pending orders
        marginReservedForOrders = 0;
        for (uint256 i = 0; i < userPendingOrders[user].length; i++) {
            marginReservedForOrders += userPendingOrders[user][i].marginReserved;
        }
        
        // Calculate unrealized P&L
        unrealizedPnL = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            uint256 markPrice = getMarkPrice(userPositions[user][i].marketId);
            if (markPrice > 0) {
                int256 priceDiff = int256(markPrice) - int256(userPositions[user][i].entryPrice);
                unrealizedPnL += (priceDiff * userPositions[user][i].size) / int256(TICK_PRECISION);
            }
        }
        
        totalMarginCommitted = marginUsedInPositions + marginReservedForOrders;
        availableMargin = totalCollateral > totalMarginCommitted ? 
            totalCollateral - totalMarginCommitted : 0;
        
        // Simple health check: available margin should be positive
        isMarginHealthy = (int256(totalCollateral) + realizedPnL + unrealizedPnL) > int256(totalMarginCommitted);
    }
    
    /**
     * @dev Get margin utilization ratio for a user
     * @param user User address
     * @return utilizationBps Margin utilization in basis points (0-10000)
     */
    function getMarginUtilization(address user) external view returns (uint256 utilizationBps) {
        uint256 totalCollateral = userCollateral[user];
        if (totalCollateral == 0) return 0;
        
        uint256 totalMarginUsed = 0;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            totalMarginUsed += userPositions[user][i].marginLocked;
        }
        for (uint256 i = 0; i < userPendingOrders[user].length; i++) {
            totalMarginUsed += userPendingOrders[user][i].marginReserved;
        }
        
        utilizationBps = (totalMarginUsed * 10000) / totalCollateral;
        if (utilizationBps > 10000) utilizationBps = 10000;
    }

    // ============ View Functions (Delegated to VaultAnalytics) ============
    
    function getMarginSummary(address user) external view returns (VaultAnalytics.MarginSummary memory) {
        // Convert PositionManager.Position[] to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        uint256[] memory markPrices = new uint256[](userPositions[user].length);
        
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
            markPrices[i] = getMarkPrice(userPositions[user][i].marketId);
        }
        
        return VaultAnalytics.getMarginSummary(
            userCollateral[user],
            userRealizedPnL[user],
            positions,
            userPendingOrders[user],
            markPrices
        );
    }

    function getAvailableCollateral(address user) public view returns (uint256) {
        // Convert to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        // Base available = collateral - margin locked in positions
        uint256 baseAvailable = VaultAnalytics.getAvailableCollateral(userCollateral[user], positions);
        // Subtract margin reserved for pending orders
        uint256 reserved = 0;
        VaultAnalytics.PendingOrder[] storage pending = userPendingOrders[user];
        for (uint256 i = 0; i < pending.length; i++) {
            reserved += pending[i].marginReserved;
        }
        return baseAvailable > reserved ? baseAvailable - reserved : 0;
    }

    function getTotalMarginUsed(address user) public view returns (uint256) {
        // Convert to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        return VaultAnalytics.getTotalMarginUsed(positions);
    }

    function getUserPositions(address user) external view returns (PositionManager.Position[] memory) {
        return userPositions[user];
    }

    function getUserPositionCount(address user) external view returns (uint256) {
        return userPositions[user].length;
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        // Return stored mark price (updated by SETTLEMENT_ROLE)
        return marketMarkPrices[marketId];
    }

    // ============ Market Authorization ============
    
    function authorizeMarket(
        bytes32 marketId,
        address orderBook
    ) external onlyRole(FACTORY_ROLE) {
        require(orderBook != address(0), "!orderBook");
        require(marketToOrderBook[marketId] == address(0), "exists");
        
        marketToOrderBook[marketId] = orderBook;
        
        if (!registeredOrderBooks[orderBook]) {
            registeredOrderBooks[orderBook] = true;
            allOrderBooks.push(orderBook);
        }
        
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    // ============ Admin Functions ============
    
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getGlobalStats() external view returns (
        uint256 totalDeposited,
        uint256 totalLocked,
        uint256 totalUsers,
        uint256 totalMarkets
    ) {
        return (
            totalCollateralDeposited,
            totalMarginLocked,
            0, // Total users calculation would require additional tracking
            allOrderBooks.length
        );
    }

    // ============ Factory Interface Methods ============
    
    // Backward-compatible helpers used by OrderBook and router flows
    function deductFees(address user, uint256 amount, address recipient) external {
        require(hasRole(FACTORY_ROLE, msg.sender) || hasRole(ORDERBOOK_ROLE, msg.sender), "unauthorized");
        require(userCollateral[user] >= amount, "!balance");
        userCollateral[user] -= amount;
        userCollateral[recipient] += amount;
    }

    function transferCollateral(address from, address to, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(userCollateral[from] >= amount, "!balance");
        userCollateral[from] -= amount;
        userCollateral[to] += amount;
    }

    // Lock margin directly to a market (position margin) - Updated for consolidated tracking
    function lockMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0) && amount > 0, "invalid");
        require(marketToOrderBook[marketId] != address(0), "market!");
        uint256 avail = getAvailableCollateral(user);
        require(avail >= amount, "insufficient collateral");
        
        // Find and update position margin, or revert if no position exists
        bool positionFound = false;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            if (userPositions[user][i].marketId == marketId) {
                userPositions[user][i].marginLocked += amount;
                positionFound = true;
                emit MarginLocked(user, marketId, amount, userPositions[user][i].marginLocked);
                break;
            }
        }
        require(positionFound, "No position found for market");
        
        totalMarginLocked += amount;
    }

    function releaseMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0) && amount > 0, "invalid");
        
        // Find and update position margin
        bool positionFound = false;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            if (userPositions[user][i].marketId == marketId) {
                uint256 locked = userPositions[user][i].marginLocked;
                require(locked >= amount, "insufficient locked");
                userPositions[user][i].marginLocked = locked - amount;
                positionFound = true;
                emit MarginReleased(user, marketId, amount, userPositions[user][i].marginLocked);
                break;
            }
        }
        require(positionFound, "No position found for market");
        
        if (totalMarginLocked >= amount) {
            totalMarginLocked -= amount;
        }
    }

    // ===== Margin reservation API (compat with CentralizedVault) =====
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount)
        external
        onlyRole(ORDERBOOK_ROLE)
    {
        require(user != address(0) && amount > 0, "invalid");
        // Ensure market is authorized/assigned
        require(marketToOrderBook[marketId] != address(0), "market!");

        uint256 available = getAvailableCollateral(user);
        require(available >= amount, "insufficient collateral");

        // Ensure not double-reserving same orderId
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        for (uint256 i = 0; i < orders.length; i++) {
            require(orders[i].orderId != orderId, "already reserved");
        }

        orders.push(VaultAnalytics.PendingOrder({ orderId: orderId, marginReserved: amount, timestamp: block.timestamp }));
        emit MarginReserved(user, orderId, marketId, amount);
    }

    function unreserveMargin(address user, bytes32 orderId) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0), "invalid");
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        uint256 reserved = 0;
        bool found = false;
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                reserved = orders[i].marginReserved;
                // remove by swap/pop
                if (i < orders.length - 1) {
                    orders[i] = orders[orders.length - 1];
                }
                orders.pop();
                found = true;
                break;
            }
        }
        if (found) {
            emit MarginUnreserved(user, orderId, reserved);
        }
    }

    // Update reserved margin for a given order to the actual needed amount (or any target)
    function releaseExcessMargin(address user, bytes32 orderId, uint256 newTotalReservedForOrder)
        external
        onlyRole(ORDERBOOK_ROLE)
    {
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                uint256 current = orders[i].marginReserved;
                if (newTotalReservedForOrder < current) {
                    uint256 released = current - newTotalReservedForOrder;
                    orders[i].marginReserved = newTotalReservedForOrder;
                    emit MarginReleased(user, bytes32(0), released, newTotalReservedForOrder);
                } else if (newTotalReservedForOrder > current) {
                    // Increasing reservation requires sufficient available collateral
                    uint256 increase = newTotalReservedForOrder - current;
                    uint256 available = getAvailableCollateral(user);
                    require(available >= increase, "insufficient collateral");
                    orders[i].marginReserved = newTotalReservedForOrder;
                    // No event for increase; reservation change is implicit
                }
                return;
            }
        }
        // If not found, silently ignore (compat with some order flows)
    }

    function registerOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        require(!registeredOrderBooks[orderBook], "exists");
        registeredOrderBooks[orderBook] = true;
        allOrderBooks.push(orderBook);
    }

    function assignMarketToOrderBook(bytes32 marketId, address orderBook) external onlyRole(FACTORY_ROLE) {
        require(registeredOrderBooks[orderBook], "!registered");
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    function updateMarkPrice(bytes32 marketId, uint256 price) external onlyRole(SETTLEMENT_ROLE) {
        marketMarkPrices[marketId] = price;
    }

    function deregisterOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        require(registeredOrderBooks[orderBook], "!exists");
        registeredOrderBooks[orderBook] = false;
        
        // Remove from allOrderBooks array
        for (uint256 i = 0; i < allOrderBooks.length; i++) {
            if (allOrderBooks[i] == orderBook) {
                if (i < allOrderBooks.length - 1) {
                    allOrderBooks[i] = allOrderBooks[allOrderBooks.length - 1];
                }
                allOrderBooks.pop();
                break;
            }
        }
    }

    // ============ Liquidation Interface (compat with OrderBook expectations) ==========

    function getPositionSummary(
        address user,
        bytes32 marketId
    ) external view returns (int256 size, uint256 entryPrice, uint256 marginLocked) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return (positions[i].size, positions[i].entryPrice, positions[i].marginLocked);
            }
        }
        return (0, 0, 0);
    }

    function isLiquidatable(
        address user,
        bytes32 marketId,
        uint256 markPrice
    ) external view returns (bool) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                int256 size = positions[i].size;
                uint256 mm = maintenanceMarginBps[marketId];
                if (mm == 0) mm = 1000; // default 10%
                if (size > 0) {
                    // Long liquidation: with 1:1 system, only at price 0
                    return markPrice == 0;
                } else {
                    // Short liquidation: P_liq = (2.5E)/(1+m)
                    // Use integer math: numerator = 25/10 * E
                    uint256 numerator = (25 * positions[i].entryPrice) / 10;
                    uint256 denominator = 10000 + mm; // (1 + m)
                    uint256 priceLiq = (numerator * 10000) / denominator;
                    return markPrice >= priceLiq;
                }
            }
        }
        return false;
    }

    function liquidateShort(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size < 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);

                // Calculate trading loss for short liquidation (USDC amount for collateral deduction)
                // Note: This differs from standard P&L tracking (18 decimals) as it calculates actual USDC loss
                uint256 tradingLoss = 0;
                if (markPrice > entryPrice) {
                    // Short position loss: (current price - entry price) * position size
                    uint256 lossPerUnit = markPrice - entryPrice;
                    // Convert to USDC: (lossPerUnit_6dec * size_18dec) / (DECIMAL_SCALE_12dec * TICK_PRECISION_6dec) = 6 decimals
                    tradingLoss = (lossPerUnit * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                
                // Apply liquidation penalty on top of trading loss
                uint256 penalty = (locked * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 totalLoss = tradingLoss + penalty;
                
                // Cap total loss at user's available collateral
                if (totalLoss > userCollateral[user]) {
                    totalLoss = userCollateral[user];
                }
                
                if (totalLoss > 0) {
                    userCollateral[user] -= totalLoss;
                    // Give liquidator the penalty portion only, trading loss is socialized
                    uint256 liquidatorReward = penalty;
                    if (liquidatorReward > totalLoss) {
                        liquidatorReward = totalLoss;
                    }
                    if (liquidatorReward > 0) {
                        userCollateral[liquidator] += liquidatorReward;
                    }
                }

                // Release all locked margin and remove position
                // No need to update separate margin tracking - position removal handles this
                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                // remove position by swap-pop
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                // Remove market ID from user's market list
                _removeMarketIdFromUser(user, marketId);

                // Notify OrderBook to clear its local copy if possible
                address ob = marketToOrderBook[marketId];
                if (ob != address(0)) {
                    try IOrderBook(ob).clearUserPosition(user) {} catch {}
                }

                // Apply socialized loss for the uncovered position
                uint256 positionNotional = uint256(-oldSize) * entryPrice / TICK_PRECISION;
                emit SocializedLossApplied(marketId, positionNotional, user);

                emit LiquidationExecuted(user, marketId, liquidator, totalLoss, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, 0, entryPrice, 0);
                return;
            }
        }
        // no short position found; ignore
    }

    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size > 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);

                // Calculate trading loss for long liquidation (USDC amount for collateral deduction)
                // Note: This differs from standard P&L tracking (18 decimals) as it calculates actual USDC loss
                uint256 tradingLoss = 0;
                if (markPrice < entryPrice) {
                    // Long position loss: (entry price - current price) * position size
                    uint256 lossPerUnit = entryPrice - markPrice;
                    // Convert to USDC: (lossPerUnit_6dec * size_18dec) / (DECIMAL_SCALE_12dec * TICK_PRECISION_6dec) = 6 decimals
                    tradingLoss = (lossPerUnit * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                
                // Apply liquidation penalty on top of trading loss
                uint256 penalty = (locked * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 totalLoss = tradingLoss + penalty;
                
                // Cap total loss at user's available collateral
                if (totalLoss > userCollateral[user]) {
                    totalLoss = userCollateral[user];
                }
                
                if (totalLoss > 0) {
                    userCollateral[user] -= totalLoss;
                    // Give liquidator the penalty portion only, trading loss is socialized
                    uint256 liquidatorReward = penalty;
                    if (liquidatorReward > totalLoss) {
                        liquidatorReward = totalLoss;
                    }
                    if (liquidatorReward > 0) {
                        userCollateral[liquidator] += liquidatorReward;
                    }
                }

                // Release all locked margin and remove position
                // No need to update separate margin tracking - position removal handles this
                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                // Remove market ID from user's market list
                _removeMarketIdFromUser(user, marketId);

                address ob = marketToOrderBook[marketId];
                if (ob != address(0)) {
                    try IOrderBook(ob).clearUserPosition(user) {} catch {}
                }

                // Apply socialized loss for the uncovered position
                uint256 positionNotional = uint256(oldSize) * entryPrice / TICK_PRECISION;
                emit SocializedLossApplied(marketId, positionNotional, user);

                emit LiquidationExecuted(user, marketId, liquidator, totalLoss, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, 0, entryPrice, 0);
                return;
            }
        }
        // no long position found; ignore
    }

    // ============ Enhanced Liquidation Functions ============
    
    /**
     * @dev Confiscate user's available collateral to cover gap losses during liquidation
     * @param user User address
     * @param gapLossAmount Amount of gap loss to cover from available collateral
     */
    function confiscateAvailableCollateralForGapLoss(
        address user, 
        uint256 gapLossAmount
    ) external onlyRole(ORDERBOOK_ROLE) {
        require(gapLossAmount > 0, "Gap loss amount must be positive");
        
        uint256 availableCollateral = getAvailableCollateral(user);
        require(availableCollateral >= gapLossAmount, "Insufficient available collateral for gap coverage");
        
        // Deduct from user's collateral
        userCollateral[user] -= gapLossAmount;
        
        // Emit event for transparency
        emit AvailableCollateralConfiscated(user, gapLossAmount, availableCollateral - gapLossAmount);
    }
    
    /**
     * @dev Socialize losses across profitable positions when user collateral is exhausted
     * @param marketId Market where the loss occurred
     * @param lossAmount Amount to socialize across users
     * @param liquidatedUser The user who was liquidated (for event tracking)
     */
    function socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) external onlyRole(ORDERBOOK_ROLE) {
        require(lossAmount > 0, "Loss amount must be positive");
        
        // For now, implement a simple socialization mechanism
        // In production, this would be more sophisticated with profit-based distribution
        
        // Get all users who have positions in this market
        address[] memory usersWithPositions = _getUsersWithPositionsInMarket(marketId);
        uint256 totalUsersToSocialize = 0;
        
        // Count users with available collateral to share the loss
        for (uint256 i = 0; i < usersWithPositions.length; i++) {
            if (usersWithPositions[i] != liquidatedUser && userCollateral[usersWithPositions[i]] > 0) {
                totalUsersToSocialize++;
            }
        }
        
        if (totalUsersToSocialize == 0) {
            // No users to socialize to - loss becomes bad debt
            emit SocializedLossApplied(marketId, lossAmount, liquidatedUser);
            return;
        }
        
        // Simple equal distribution for now
        uint256 lossPerUser = lossAmount / totalUsersToSocialize;
        uint256 remainingLoss = lossAmount;
        
        for (uint256 i = 0; i < usersWithPositions.length && remainingLoss > 0; i++) {
            address user = usersWithPositions[i];
            if (user != liquidatedUser && userCollateral[user] > 0) {
                uint256 userLoss = remainingLoss < lossPerUser ? remainingLoss : lossPerUser;
                
                // Cap loss at user's available collateral
                if (userLoss > userCollateral[user]) {
                    userLoss = userCollateral[user];
                }
                
                if (userLoss > 0) {
                    userCollateral[user] -= userLoss;
                    remainingLoss -= userLoss;
                    
                    emit UserLossSocialized(user, userLoss, userCollateral[user]);
                }
            }
        }
        
        emit SocializedLossApplied(marketId, lossAmount - remainingLoss, liquidatedUser);
    }
    
    /**
     * @dev Get all users who have positions in a specific market
     * @param marketId Market ID to check
     * @return users Array of user addresses with positions in the market
     */
    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        // Create a dynamic array to hold users with positions
        address[] memory tempUsers = new address[](allKnownUsers.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allKnownUsers.length; i++) {
            address user = allKnownUsers[i];
            PositionManager.Position[] storage positions = userPositions[user];
            
            // Check if user has any position in this market
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    tempUsers[count] = user;
                    count++;
                    break; // Found position, move to next user
                }
            }
        }
        
        // Create correctly sized array
        address[] memory usersWithPositions = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            usersWithPositions[i] = tempUsers[i];
        }
        
        return usersWithPositions;
    }

    // ============ Internal Helper Functions ============
    
    /**
     * @dev Ensure user is tracked in allKnownUsers array for socialized loss distribution
     * @param user User address to track
     */
    function _ensureUserTracked(address user) internal {
        if (!isKnownUser[user]) {
            allKnownUsers.push(user);
            isKnownUser[user] = true;
        }
    }
    
    /**
     * @dev Remove market ID from user's market list (helper for position closure)
     * @param user User address
     * @param marketId Market ID to remove
     */
    function _removeMarketIdFromUser(address user, bytes32 marketId) internal {
        bytes32[] storage marketIds = userMarketIds[user];
        for (uint256 j = 0; j < marketIds.length; j++) {
            if (marketIds[j] == marketId) {
                // Remove by swapping with last element and popping
                if (j < marketIds.length - 1) {
                    marketIds[j] = marketIds[marketIds.length - 1];
                }
                marketIds.pop();
                break;
            }
        }
    }
}
