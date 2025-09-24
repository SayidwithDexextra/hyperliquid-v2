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
    function getOrderBookDepth(uint256 levels) external view returns (
        uint256[] memory bidPrices,
        uint256[] memory bidAmounts,
        uint256[] memory askPrices,
        uint256[] memory askAmounts
    );
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
    // ===== Dynamic Maintenance Margin (MMR) Parameters =====
    // BASE_MMR_BPS (default 10%) + PENALTY_MMR_BPS (default 10%) + f(fill_ratio) capped by MAX_MMR_BPS (default 50%)
    uint256 public baseMmrBps = 1000;           // 10%
    uint256 public penaltyMmrBps = 1000;        // +10% hard floor uplift
    uint256 public maxMmrBps = 5000;            // 50% cap
    // Linear scaling slopes
    uint256 public scalingSlopeBps = 1000;      // +10% at full fill ratio (size/liquidity)
    uint256 public priceGapSlopeBps = 0;        // +0% by default (enable to add price-gap sensitivity)
    // Liquidity sampling depth for fill_ratio computation (best N levels)
    uint256 public mmrLiquidityDepthLevels = 5; // 5 levels by default
    
    // Global stats
    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;

    // ============ Events ============
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginToppedUp(address indexed user, bytes32 indexed marketId, uint256 amount);
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
    
    // ============ Administrative Position Closure Events ============
    event SocializationStarted(bytes32 indexed marketId, uint256 totalLossAmount, address indexed liquidatedUser, uint256 timestamp);
    event ProfitablePositionFound(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 entryPrice, uint256 markPrice, uint256 unrealizedPnL, uint256 profitScore);
    event AdministrativePositionClosure(address indexed user, bytes32 indexed marketId, uint256 sizeBeforeReduction, uint256 sizeAfterReduction, uint256 realizedProfit, uint256 newEntryPrice);
    event SocializationCompleted(bytes32 indexed marketId, uint256 totalLossCovered, uint256 remainingLoss, uint256 positionsAffected, address indexed liquidatedUser);
    event SocializationFailed(bytes32 indexed marketId, uint256 lossAmount, string reason, address indexed liquidatedUser);
    
    // Debug events for comprehensive tracking
    event DebugProfitCalculation(address indexed user, bytes32 indexed marketId, uint256 entryPrice, uint256 markPrice, int256 positionSize, int256 unrealizedPnL, uint256 profitScore);
    event DebugPositionReduction(address indexed user, bytes32 indexed marketId, uint256 originalSize, uint256 reductionAmount, uint256 newSize, uint256 realizedPnL);
    event DebugSocializationState(bytes32 indexed marketId, uint256 remainingLoss, uint256 totalProfitableUsers, uint256 processedUsers);

    // ============ Structs for Administrative Position Closure ============
    
    struct ProfitablePosition {
        address user;
        int256 positionSize;
        uint256 entryPrice;
        uint256 unrealizedPnL;
        uint256 profitScore; // Profit % × Position Size (for ranking)
        bool isLong;
    }
    
    struct PositionClosureResult {
        bool success;
        uint256 realizedProfit;
        uint256 newPositionSize;
        uint256 newEntryPrice;
        string failureReason;
    }

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
                
                // Calculate uncovered loss for ADL
                uint256 coveredByUser = totalLoss > userCollateral[user] ? userCollateral[user] : totalLoss;
                uint256 uncoveredLoss = totalLoss - coveredByUser;
                totalLoss = coveredByUser; // Only take what user can cover
                
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
                
                // 🔧 CRITICAL FIX: Trigger ADL for uncovered losses
                if (uncoveredLoss > 0) {
                    _socializeLoss(marketId, uncoveredLoss, user);
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
        _increasePositionMargin(user, marketId, amount);
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

    // ============ User Top-Up Interface ============
    
    /**
     * @dev Allow users to top up margin for their existing position using available collateral
     * @param marketId Market to top up margin for
     * @param amount Additional margin amount to lock (in 6 decimals)
     */
    function topUpPositionMargin(bytes32 marketId, uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "!amount");
        require(marketToOrderBook[marketId] != address(0), "market!");
        
        uint256 available = getAvailableCollateral(msg.sender);
        require(available >= amount, "insufficient collateral");
        _increasePositionMargin(msg.sender, marketId, amount);
        emit MarginToppedUp(msg.sender, marketId, amount);
    }

    /**
     * @dev Internal helper to increase margin on an existing position.
     *      Reverts if no position found or position size is zero.
     */
    function _increasePositionMargin(address user, bytes32 marketId, uint256 amount) internal {
        bool positionFound = false;
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            if (userPositions[user][i].marketId == marketId && userPositions[user][i].size != 0) {
                userPositions[user][i].marginLocked += amount;
                positionFound = true;
                emit MarginLocked(user, marketId, amount, userPositions[user][i].marginLocked);
                break;
            }
        }
        require(positionFound, "No position found for market");
        totalMarginLocked += amount;
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

    /**
     * @dev Get maintenance margin in basis points (always 10% = 1000 bps)
     * @param marketId Market identifier (unused, kept for compatibility)
     * @return Maintenance margin in basis points
     */
    function maintenanceMarginBps(bytes32 marketId) external view returns (uint256) {
        // Backwards-compatible helper: return base + penalty as indicative floor for this market
        marketId; // unused
        uint256 floorBps = baseMmrBps + penaltyMmrBps;
        return floorBps > maxMmrBps ? maxMmrBps : floorBps;
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
                // Calculate maintenance requirement (6 decimals) with dynamic MMR
                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                uint256 notional6 = (absSize * markPrice) / (10**18);
                uint256 maintenance6 = (notional6 * mmrBps) / 10000;

                // Calculate equity for this position in 6 decimals
                int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;

                return equity6 < int256(maintenance6);
            }
        }
        return false;
    }

    /**
     * @dev Compute liquidation price for user's position in a market using current equity.
     *      - Uses current mark price to compute equity (includes unrealized PnL)
     *      - Long:   P_liq = (P_now - E/Q) * 10000 / (10000 - MMR_BPS)
     *      - Short:  P_liq = (P_now + E/Q) * 10000 / (10000 + MMR_BPS)
     *      Returns (0, false) if no position exists.
     */
    function getLiquidationPrice(
        address user,
        bytes32 marketId
    ) external view returns (uint256 liquidationPrice, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                uint256 markPrice = getMarkPrice(marketId);
                if (markPrice == 0) {
                    return (0, true);
                }

                // Compute equity (6 decimals) and abs size
                int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                if (absSize == 0) {
                    return (0, true);
                }

                // E/Q in 6 decimals: (equity6 * 1e18) / absSize
                int256 eOverQ6 = (equity6 * int256(1e18)) / int256(absSize);

                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                if (positions[i].size > 0) {
                    // Long liquidation price: ((P_now - E/Q) * 10000) / (10000 - MMR)
                    int256 numerator = int256(markPrice) - eOverQ6;
                    uint256 denomBps = 10000 - mmrBps;
                    if (denomBps == 0) return (0, true);
                    int256 liqSigned = (numerator * int256(10000)) / int256(denomBps);
                    liquidationPrice = liqSigned > 0 ? uint256(liqSigned) : 0;
                } else {
                    // Short liquidation price: ((P_now + E/Q) * 10000) / (10000 + MMR)
                    int256 numerator = int256(markPrice) + eOverQ6;
                    uint256 denomBps = 10000 + mmrBps;
                    int256 liqSigned = (numerator * int256(10000)) / int256(denomBps);
                    liquidationPrice = liqSigned > 0 ? uint256(liqSigned) : 0;
                }
                return (liquidationPrice, true);
            }
        }
        return (0, false);
    }

    /**
     * @dev Get position equity and notional in 6 decimals.
     *      equity6 = marginLocked + pnl6(mark), notional6 = |Q| * P_now / 1e18.
     */
    function getPositionEquity(
        address user,
        bytes32 marketId
    ) external view returns (int256 equity6, uint256 notional6, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                notional6 = (absSize * markPrice) / (10**18);

                int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                equity6 = int256(positions[i].marginLocked) + pnl6;
                return (equity6, notional6, true);
            }
        }
        return (0, 0, false);
    }

    /**
     * @dev Get position free margin relative to maintenance: max(equity - MMR*notional, 0)
     */
    function getPositionFreeMargin(
        address user,
        bytes32 marketId
    ) external view returns (uint256 freeMargin6, uint256 maintenance6, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                uint256 notional6 = (absSize * markPrice) / (10**18);
                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                maintenance6 = (notional6 * mmrBps) / 10000;

                int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;

                if (equity6 > int256(maintenance6)) {
                    freeMargin6 = uint256(equity6 - int256(maintenance6));
                } else {
                    freeMargin6 = 0;
                }
                return (freeMargin6, maintenance6, true);
            }
        }
        return (0, 0, false);
    }

    /**
     * @dev Public view: get effective MMR (bps) and fill ratio (1e18) for a user's position.
     */
    function getEffectiveMaintenanceMarginBps(
        address user,
        bytes32 marketId
    ) external view returns (uint256 mmrBps, uint256 fillRatio1e18, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                (mmrBps, fillRatio1e18) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                return (mmrBps, fillRatio1e18, true);
            }
        }
        return (0, 0, false);
    }

    function getEffectiveMaintenanceDetails(
        address user,
        bytes32 marketId
    ) external view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                (mmrBps, fillRatio1e18, gapRatio1e18) = _computeEffectiveMMRMetrics(user, marketId, positions[i].size);
                return (mmrBps, fillRatio1e18, gapRatio1e18, true);
            }
        }
        return (0, 0, 0, false);
    }

    // ===== Dynamic MMR internal helpers =====
    function _computeEffectiveMMRMetrics(
        address /*user*/, // reserved for future per-user risk adjustments
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18) {
        // Base + penalty
        uint256 mmr = baseMmrBps + penaltyMmrBps;

        // Determine direction and absolute size
        bool isLong = positionSize > 0;
        uint256 absSize = uint256(positionSize > 0 ? positionSize : -positionSize);

        // Pull depth once
        address obAddr = marketToOrderBook[marketId];
        uint256 sumOpposite;
        uint256 remaining = absSize;
        uint256 vwapNumerator; // price(6) * amount(18)
        uint256 markPrice = getMarkPrice(marketId);
        uint256 vwapPrice = 0;

        if (obAddr != address(0)) {
            try IOrderBook(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels) returns (
                uint256[] memory bidPrices,
                uint256[] memory bidAmounts,
                uint256[] memory askPrices,
                uint256[] memory askAmounts
            ) {
                if (isLong) {
                    // Closing long → sell into bids
                    for (uint256 i = 0; i < bidAmounts.length; i++) {
                        uint256 amt = bidAmounts[i];
                        sumOpposite += amt;
                        uint256 take = remaining < amt ? remaining : amt;
                        if (take > 0) {
                            vwapNumerator += bidPrices[i] * take;
                            remaining -= take;
                            if (remaining == 0) {
                                break;
                            }
                        }
                    }
                } else {
                    // Closing short → buy from asks
                    for (uint256 j = 0; j < askAmounts.length; j++) {
                        uint256 amt = askAmounts[j];
                        sumOpposite += amt;
                        uint256 take = remaining < amt ? remaining : amt;
                        if (take > 0) {
                            vwapNumerator += askPrices[j] * take;
                            remaining -= take;
                            if (remaining == 0) {
                                break;
                            }
                        }
                    }
                }

                if (absSize > 0) {
                    if (vwapNumerator > 0) {
                        vwapPrice = vwapNumerator / (absSize - remaining);
                    }
                }
            } catch {}
        }

        // Compute fill ratio based on opposite-side liquidity depth
        if (sumOpposite == 0) {
            fillRatio1e18 = 1e18; // No liquidity → max risk
        } else {
            uint256 numerator = absSize * 1e18;
            fillRatio1e18 = numerator / sumOpposite;
            if (fillRatio1e18 > 1e18) fillRatio1e18 = 1e18;
        }

        // Price gap sensitivity (relative to current mark)
        gapRatio1e18 = 0;
        if (markPrice > 0 && vwapPrice > 0) {
            if (isLong) {
                // Adverse for long closes is lower price than mark
                if (vwapPrice < markPrice) {
                    gapRatio1e18 = ((markPrice - vwapPrice) * 1e18) / markPrice;
                }
            } else {
                // Adverse for short closes is higher price than mark
                if (vwapPrice > markPrice) {
                    gapRatio1e18 = ((vwapPrice - markPrice) * 1e18) / markPrice;
                }
            }
            if (gapRatio1e18 > 1e18) gapRatio1e18 = 1e18;
        } else if (sumOpposite == 0) {
            // No liquidity → treat as max price gap risk
            gapRatio1e18 = 1e18;
        }

        // Linear scaling components
        uint256 scalingFill = (scalingSlopeBps * fillRatio1e18) / 1e18;
        uint256 scalingGap = (priceGapSlopeBps * gapRatio1e18) / 1e18;
        mmr += scalingFill + scalingGap;
        if (mmr > maxMmrBps) mmr = maxMmrBps;
        return (mmr, fillRatio1e18, gapRatio1e18);
    }

    function _computeEffectiveMMRBps(
        address user,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18) {
        (uint256 m, uint256 f, ) = _computeEffectiveMMRMetrics(user, marketId, positionSize);
        return (m, f);
    }

    function _getCloseLiquidity(bytes32 marketId, uint256 /*absSize*/) internal view returns (uint256 liquidity18) {
        address obAddr = marketToOrderBook[marketId];
        if (obAddr == address(0)) return 0;
        // Attempt to get depth; if it fails, return 0 to enforce max risk
        try IOrderBook(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels) returns (
            uint256[] memory bidPrices,
            uint256[] memory bidAmounts,
            uint256[] memory askPrices,
            uint256[] memory askAmounts
        ) {
            // For simplicity, approximate close direction using current best prices
            // If bestBid is nonzero and bestAsk is max, treat as one-sided; we sum both sides anyway for robustness
            // We cannot know position direction here; use total opposite side relative to worst-case. 
            // Heuristic: use max of aggregated bids and aggregated asks as available liquidity proxy
            uint256 sumBids;
            for (uint256 i = 0; i < bidAmounts.length; i++) {
                sumBids += bidAmounts[i];
            }
            uint256 sumAsks;
            for (uint256 j = 0; j < askAmounts.length; j++) {
                sumAsks += askAmounts[j];
            }
            // Use larger of sides as proxy market liquidity for stability
            liquidity18 = sumBids > sumAsks ? sumBids : sumAsks;
            return liquidity18;
        } catch {
            return 0;
        }
    }

    // ===== Admin setters for dynamic MMR parameters =====
    function setMmrParams(
        uint256 _baseMmrBps,
        uint256 _penaltyMmrBps,
        uint256 _maxMmrBps,
        uint256 _scalingSlopeBps,
        uint256 _liquidityDepthLevels
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_baseMmrBps <= 10000 && _penaltyMmrBps <= 10000 && _maxMmrBps <= 10000, "bps!");
        require(_liquidityDepthLevels > 0 && _liquidityDepthLevels <= 50, "depth!");
        baseMmrBps = _baseMmrBps;
        penaltyMmrBps = _penaltyMmrBps;
        maxMmrBps = _maxMmrBps;
        scalingSlopeBps = _scalingSlopeBps;
        mmrLiquidityDepthLevels = _liquidityDepthLevels;
    }

    /**
     * @dev Advanced MMR params including price gap sensitivity slope (bps at 100% gap).
     */
    function setMmrParamsAdvanced(
        uint256 _baseMmrBps,
        uint256 _penaltyMmrBps,
        uint256 _maxMmrBps,
        uint256 _scalingSlopeBps,
        uint256 _liquidityDepthLevels,
        uint256 _priceGapSlopeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_baseMmrBps <= 10000 && _penaltyMmrBps <= 10000 && _maxMmrBps <= 10000, "bps!");
        require(_liquidityDepthLevels > 0 && _liquidityDepthLevels <= 50, "depth!");
        baseMmrBps = _baseMmrBps;
        penaltyMmrBps = _penaltyMmrBps;
        maxMmrBps = _maxMmrBps;
        scalingSlopeBps = _scalingSlopeBps;
        mmrLiquidityDepthLevels = _liquidityDepthLevels;
        priceGapSlopeBps = _priceGapSlopeBps;
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
            uint256 actualLoss = tradingLoss + penalty;
            
            // Calculate how much the user can actually cover from their collateral
            uint256 coveredByUser = actualLoss > userCollateral[user] ? userCollateral[user] : actualLoss;
            uint256 uncoveredLoss = actualLoss - coveredByUser;
            
            if (coveredByUser > 0) {
                userCollateral[user] -= coveredByUser;
                // Give liquidator the penalty portion only, trading loss is socialized
                uint256 liquidatorReward = penalty;
                if (liquidatorReward > coveredByUser) {
                    liquidatorReward = coveredByUser;
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

                // If there's uncovered loss, trigger ADL system
                if (uncoveredLoss > 0) {
                    _socializeLoss(marketId, uncoveredLoss, user);
                }

                emit LiquidationExecuted(user, marketId, liquidator, coveredByUser, userCollateral[user]);
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
            uint256 actualLoss = tradingLoss + penalty;
            
            // Calculate how much the user can actually cover from their collateral
            uint256 coveredByUser = actualLoss > userCollateral[user] ? userCollateral[user] : actualLoss;
            uint256 uncoveredLoss = actualLoss - coveredByUser;
            
            if (coveredByUser > 0) {
                userCollateral[user] -= coveredByUser;
                // Give liquidator the penalty portion only, trading loss is socialized
                uint256 liquidatorReward = penalty;
                if (liquidatorReward > coveredByUser) {
                    liquidatorReward = coveredByUser;
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

                // If there's uncovered loss, trigger ADL system
                if (uncoveredLoss > 0) {
                    _socializeLoss(marketId, uncoveredLoss, user);
                }

                emit LiquidationExecuted(user, marketId, liquidator, coveredByUser, userCollateral[user]);
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
     * @dev External wrapper for socialized loss - called by OrderBook
     * @param marketId Market where the loss occurred
     * @param lossAmount Amount to socialize across users
     * @param liquidatedUser The user who was liquidated (for event tracking)
     */
    function socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) external onlyRole(ORDERBOOK_ROLE) {
        _socializeLoss(marketId, lossAmount, liquidatedUser);
    }
    
    /**
     * @dev Internal function to socialize losses via Administrative Position Closure (ADL) system
     * @param marketId Market where the loss occurred
     * @param lossAmount Amount to socialize across users
     * @param liquidatedUser The user who was liquidated (for event tracking)
     */
    function _socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) internal {
        require(lossAmount > 0, "Loss amount must be positive");
        
        // DEBUG: Start socialization process
        emit SocializationStarted(marketId, lossAmount, liquidatedUser, block.timestamp);
        
        // Step 1: Find all profitable positions in this market (excluding liquidated user)
        ProfitablePosition[] memory profitablePositions = _findProfitablePositions(marketId, liquidatedUser);
        
        if (profitablePositions.length == 0) {
            // No profitable positions to socialize to - loss becomes bad debt
            emit SocializationFailed(marketId, lossAmount, "No profitable positions found", liquidatedUser);
            emit SocializedLossApplied(marketId, lossAmount, liquidatedUser);
            return;
        }
        
        emit DebugSocializationState(marketId, lossAmount, profitablePositions.length, 0);
        
        // Step 2: Sort positions by profit score (highest profit first)
        _sortProfitablePositionsByScore(profitablePositions);
        
        // Step 3: Apply Administrative Position Closure (ADL) to cover the loss
        uint256 remainingLoss = lossAmount;
        uint256 positionsAffected = 0;
        uint256 totalLossCovered = 0;
        
        for (uint256 i = 0; i < profitablePositions.length && remainingLoss > 0; i++) {
            ProfitablePosition memory profitablePos = profitablePositions[i];
            
            // Calculate how much loss this position can cover (all values in 6 decimals)
            // profitablePos.unrealizedPnL is derived from standard P&L (18 decimals). Convert to 6 decimals.
            uint256 maxCoverage = profitablePos.unrealizedPnL / DECIMAL_SCALE; // 18 → 6
            uint256 targetCoverage = remainingLoss > maxCoverage ? maxCoverage : remainingLoss;
            
            if (targetCoverage == 0) continue;
            
            // Execute administrative position closure
            PositionClosureResult memory closureResult = _executeAdministrativePositionClosure(
                profitablePos.user,
                marketId,
                profitablePos.positionSize,
                profitablePos.entryPrice,
                targetCoverage
            );
            
            if (closureResult.success) {
                positionsAffected++;
                totalLossCovered += closureResult.realizedProfit;
                remainingLoss -= closureResult.realizedProfit;
                
                emit AdministrativePositionClosure(
                    profitablePos.user,
                    marketId,
                    uint256(profitablePos.positionSize >= 0 ? profitablePos.positionSize : -profitablePos.positionSize),
                    closureResult.newPositionSize,
                    closureResult.realizedProfit,
                    closureResult.newEntryPrice
                );
                
                // CRITICAL FIX: Confiscate the realized profit from the user to cover the socialized loss
                // The profit should be taken from the user, not given back to them
                if (closureResult.realizedProfit <= userCollateral[profitablePos.user]) {
                    // Deduct profit from user's collateral to cover the loss
                    userCollateral[profitablePos.user] -= closureResult.realizedProfit;
                    emit UserLossSocialized(profitablePos.user, closureResult.realizedProfit, userCollateral[profitablePos.user]);
                } else {
                    // If user doesn't have enough collateral, take what they have
                    uint256 availableCollateral = userCollateral[profitablePos.user];
                    userCollateral[profitablePos.user] = 0;
                    emit UserLossSocialized(profitablePos.user, availableCollateral, 0);
                    
                    // Update the actual loss covered to reflect what was actually taken
                    totalLossCovered = totalLossCovered - closureResult.realizedProfit + availableCollateral;
                    remainingLoss = remainingLoss + closureResult.realizedProfit - availableCollateral;
                }
                
            } else {
                // DEBUG: Position closure failed
                emit SocializationFailed(marketId, targetCoverage, closureResult.failureReason, profitablePos.user);
            }
            
            // DEBUG: Track progress
            emit DebugSocializationState(marketId, remainingLoss, profitablePositions.length, i + 1);
        }
        
        // Final result
        emit SocializationCompleted(marketId, totalLossCovered, remainingLoss, positionsAffected, liquidatedUser);
        emit SocializedLossApplied(marketId, totalLossCovered, liquidatedUser);
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
    
    // ============ Administrative Position Closure Implementation ============
    
    /**
     * @dev Find all profitable positions in a market for ADL system
     * @param marketId Market ID to search
     * @param excludeUser User to exclude (the liquidated user)
     * @return Array of profitable positions sorted by profit score
     */
    function _findProfitablePositions(
        bytes32 marketId, 
        address excludeUser
    ) internal returns (ProfitablePosition[] memory) {
        address[] memory usersWithPositions = _getUsersWithPositionsInMarket(marketId);
        uint256 markPrice = getMarkPrice(marketId);
        
        // First pass: count profitable positions
        uint256 profitableCount = 0;
        for (uint256 i = 0; i < usersWithPositions.length; i++) {
            address user = usersWithPositions[i];
            if (user == excludeUser) continue;
            
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    // Calculate unrealized PnL
                    int256 unrealizedPnL = _calculateUnrealizedPnL(positions[j], markPrice);
                    if (unrealizedPnL > 0) {
                        profitableCount++;
                    }
                    break;
                }
            }
        }
        
        if (profitableCount == 0) {
            return new ProfitablePosition[](0);
        }
        
        // Second pass: populate profitable positions array
        ProfitablePosition[] memory profitablePositions = new ProfitablePosition[](profitableCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < usersWithPositions.length; i++) {
            address user = usersWithPositions[i];
            if (user == excludeUser) continue;
            
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    PositionManager.Position storage pos = positions[j];
                    int256 unrealizedPnL = _calculateUnrealizedPnL(pos, markPrice);
                    
                    if (unrealizedPnL > 0) {
                        uint256 absSize = uint256(pos.size >= 0 ? pos.size : -pos.size);
                        uint256 profitScore = uint256(unrealizedPnL) * absSize / 1e18; // Profit × Position Size
                        
                        profitablePositions[index] = ProfitablePosition({
                            user: user,
                            positionSize: pos.size,
                            entryPrice: pos.entryPrice,
                            unrealizedPnL: uint256(unrealizedPnL),
                            profitScore: profitScore,
                            isLong: pos.size > 0
                        });
                        
                        // DEBUG: Emit profitable position found
                        emit ProfitablePositionFound(
                            user,
                            marketId,
                            pos.size,
                            pos.entryPrice,
                            markPrice,
                            uint256(unrealizedPnL),
                            profitScore
                        );
                        
                        // DEBUG: Emit detailed profit calculation
                        emit DebugProfitCalculation(
                            user,
                            marketId,
                            pos.entryPrice,
                            markPrice,
                            pos.size,
                            unrealizedPnL,
                            profitScore
                        );
                        
                        index++;
                    }
                    break;
                }
            }
        }
        
        return profitablePositions;
    }
    
    /**
     * @dev Calculate unrealized PnL for a position at current mark price
     * @param position Position to calculate PnL for
     * @param markPrice Current mark price
     * @return Unrealized PnL in USDC (6 decimals)
     */
    function _calculateUnrealizedPnL(
        PositionManager.Position storage position,
        uint256 markPrice
    ) internal view returns (int256) {
        if (position.size == 0 || markPrice == 0 || position.entryPrice == 0) {
            return 0;
        }
        
        // Calculate PnL: (mark_price - entry_price) * position_size / tick_precision
        int256 priceDiff = int256(markPrice) - int256(position.entryPrice);
        return (priceDiff * position.size) / int256(TICK_PRECISION);
    }
    
    /**
     * @dev Sort profitable positions by profit score (highest first) using insertion sort
     * @param positions Array of positions to sort (modified in-place)
     */
    function _sortProfitablePositionsByScore(ProfitablePosition[] memory positions) internal pure {
        if (positions.length <= 1) return;
        
        // Simple insertion sort (efficient for small arrays)
        for (uint256 i = 1; i < positions.length; i++) {
            ProfitablePosition memory key = positions[i];
            uint256 j = i;
            
            // Sort in descending order by profit score
            while (j > 0 && positions[j - 1].profitScore < key.profitScore) {
                positions[j] = positions[j - 1];
                j--;
            }
            positions[j] = key;
        }
    }
    
    /**
     * @dev Execute administrative position closure to realize profits for loss coverage
     * @param user User whose position will be reduced
     * @param marketId Market ID
     * @param currentPositionSize Current position size
     * @param entryPrice Current entry price
     * @param targetProfit Amount of profit to realize
     * @return PositionClosureResult with success status and details
     */
    function _executeAdministrativePositionClosure(
        address user,
        bytes32 marketId,
        int256 currentPositionSize,
        uint256 entryPrice,
        uint256 targetProfit
    ) internal returns (PositionClosureResult memory) {
        uint256 markPrice = getMarkPrice(marketId);
        if (markPrice == 0 || entryPrice == 0) {
            return PositionClosureResult({
                success: false,
                realizedProfit: 0,
                newPositionSize: uint256(currentPositionSize >= 0 ? currentPositionSize : -currentPositionSize),
                newEntryPrice: entryPrice,
                failureReason: "Invalid prices"
            });
        }
        
        // Find the actual position in storage
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size == currentPositionSize) {
                PositionManager.Position storage position = positions[i];
                
                // Calculate how much position to close to realize target profit
                uint256 absCurrentSize = uint256(currentPositionSize >= 0 ? currentPositionSize : -currentPositionSize);
                int256 totalUnrealizedPnL = _calculateUnrealizedPnL(position, markPrice);
                
                if (totalUnrealizedPnL <= 0) {
                    return PositionClosureResult({
                        success: false,
                        realizedProfit: 0,
                        newPositionSize: absCurrentSize,
                        newEntryPrice: entryPrice,
                        failureReason: "Position not profitable"
                    });
                }
                
                // Calculate reduction ratio to achieve target profit
                uint256 totalProfitAvailable18 = uint256(totalUnrealizedPnL); // 18 decimals (standard P&L precision)
                
                // Scale target profit from 6 decimals (USDC) to 18 decimals for ratio math
                uint256 targetProfit18 = targetProfit * DECIMAL_SCALE; // 6 → 18 decimals
                uint256 actualTargetProfit18 = targetProfit18 > totalProfitAvailable18 ? totalProfitAvailable18 : targetProfit18;
                
                // Calculate position reduction amount using 18-decimal ratio precision
                uint256 reductionRatio = (actualTargetProfit18 * 1e18) / totalProfitAvailable18; // 18 decimal precision
                uint256 sizeReduction = (absCurrentSize * reductionRatio) / 1e18;
                
                if (sizeReduction == 0) {
                    return PositionClosureResult({
                        success: false,
                        realizedProfit: 0,
                        newPositionSize: absCurrentSize,
                        newEntryPrice: entryPrice,
                        failureReason: "Reduction too small"
                    });
                }
                
                // Apply the position reduction
                uint256 newAbsSize = absCurrentSize - sizeReduction;
                int256 newSize = currentPositionSize >= 0 ? int256(newAbsSize) : -int256(newAbsSize);
                
                // Calculate actual realized profit (18 decimals) then convert to 6 decimals for accounting
                int256 priceDiff = int256(markPrice) - int256(entryPrice);
                int256 sizeReductionSigned = currentPositionSize >= 0 ? int256(sizeReduction) : -int256(sizeReduction);
                uint256 actualRealizedProfit18 = uint256((priceDiff * sizeReductionSigned) / int256(TICK_PRECISION));
                uint256 actualRealizedProfit = actualRealizedProfit18 / DECIMAL_SCALE;
                
                // DEBUG: Emit position reduction details
                emit DebugPositionReduction(
                    user,
                    marketId,
                    absCurrentSize,
                    sizeReduction,
                    newAbsSize,
                    actualRealizedProfit
                );
                
                if (newAbsSize == 0) {
                    // Position fully closed
                    // Release margin
                    if (position.marginLocked <= totalMarginLocked) {
                        totalMarginLocked -= position.marginLocked;
                    }
                    
                    // Remove position
                    if (i < positions.length - 1) {
                        positions[i] = positions[positions.length - 1];
                    }
                    positions.pop();
                    
                    // Remove market ID from user's list
                    _removeMarketIdFromUser(user, marketId);
                    
                    // Notify OrderBook
                    address ob = marketToOrderBook[marketId];
                    if (ob != address(0)) {
                        try IOrderBook(ob).clearUserPosition(user) {} catch {}
                    }
                    
                    emit PositionUpdated(user, marketId, currentPositionSize, 0, entryPrice, 0);
                    
                    return PositionClosureResult({
                        success: true,
                        realizedProfit: actualRealizedProfit,
                        newPositionSize: 0,
                        newEntryPrice: 0,
                        failureReason: ""
                    });
                    
                } else {
                    // Position partially closed - update size and recalculate margin
                    position.size = newSize;
                    
                    // Proportionally adjust margin
                    uint256 newMargin = (position.marginLocked * newAbsSize) / absCurrentSize;
                    uint256 marginReleased = position.marginLocked - newMargin;
                    
                    position.marginLocked = newMargin;
                    if (marginReleased <= totalMarginLocked) {
                        totalMarginLocked -= marginReleased;
                    }
                    
                    emit PositionUpdated(user, marketId, currentPositionSize, newSize, entryPrice, newMargin);
                    
                    return PositionClosureResult({
                        success: true,
                        realizedProfit: actualRealizedProfit,
                        newPositionSize: newAbsSize,
                        newEntryPrice: entryPrice, // Entry price stays the same
                        failureReason: ""
                    });
                }
            }
        }
        
        return PositionClosureResult({
            success: false,
            realizedProfit: 0,
            newPositionSize: uint256(currentPositionSize >= 0 ? currentPositionSize : -currentPositionSize),
            newEntryPrice: entryPrice,
            failureReason: "Position not found"
        });
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
