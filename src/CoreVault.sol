// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";
import "./diamond/interfaces/IOBPricingFacet.sol";

// Minimal ERC20 metadata interface to validate decimals at runtime
interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

// Removed legacy IOrderBook usage; use IOBPricingFacet for depth/view calls

/**
 * @title CoreVault
 * @dev Minimal core vault with library delegation for complex operations
 * @notice Dramatically reduced contract size by extracting logic to libraries
 */
contract CoreVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Address for address;

    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // LiquidationManager implementation to which heavy liquidation logic is delegated
    address public liquidationManager;


    /**
     * @dev Admin setter for liquidation manager implementation
     */
    function setLiquidationManager(address _impl) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_impl != address(0), "invalid impl");
        liquidationManager = _impl;
    }

    /**
     * @dev Internal helper to delegatecall into LiquidationManager with proper error bubbling
     */
    function _delegateLiq(bytes memory data) internal returns (bytes memory) {
        address impl = liquidationManager;
        require(impl != address(0), "liq impl not set");
        return impl.functionDelegateCall(data);
    }

    // ============ Constants ============
    uint256 public constant LIQUIDATION_PENALTY_BPS = 1000; // 10%
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
    // Cumulative ledger of socialized loss haircuts applied to each user (USDC, 6 decimals)
    mapping(address => uint256) public userSocializedLoss;
    
    // User tracking for socialized loss distribution
    address[] public allKnownUsers;
    mapping(address => bool) public isKnownUser;
    // REMOVED: userMarginByMarket - margin now tracked exclusively in Position structs
    
    // Market management
    mapping(bytes32 => address) public marketToOrderBook;
    // Track positions that are currently under liquidation control
    mapping(address => mapping(bytes32 => bool)) public isUnderLiquidationPosition;

    // Anchor price and timestamp captured when a position first enters liquidation control.
    // Used to clamp socialized loss so profitable users are not overcharged due to delays in liquidity.
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorPrice;
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorTimestamp;

    /**
     * @dev Set or clear under-liquidation control flag for a user's position
     */
    function setUnderLiquidation(
        address user,
        bytes32 marketId,
        bool state
    ) external onlyRole(ORDERBOOK_ROLE) {
        bool prev = isUnderLiquidationPosition[user][marketId];
        isUnderLiquidationPosition[user][marketId] = state;
        if (state) {
            // Capture anchor once when entering liquidation control
            if (!prev && liquidationAnchorPrice[user][marketId] == 0) {
                uint256 anchor = getMarkPrice(marketId);
                if (anchor == 0) {
                    anchor = marketMarkPrices[marketId];
                }
                liquidationAnchorPrice[user][marketId] = anchor;
                liquidationAnchorTimestamp[user][marketId] = block.timestamp;
            }
        } else {
            // Clearing liquidation control: clear anchor and recompute displayed liq price
            liquidationAnchorPrice[user][marketId] = 0;
            liquidationAnchorTimestamp[user][marketId] = 0;
            // Optionally restore liquidation price on clear
            _recomputeAndStoreLiquidationPrice(user, marketId);
        }
    }
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets;
    address[] public allOrderBooks;
    mapping(bytes32 => uint256) public marketMarkPrices;
    // Bad debt per market when winners cannot fully cover a shortfall (USDC, 6 decimals)
    mapping(bytes32 => uint256) public marketBadDebt;
    // ===== Dynamic Maintenance Margin (MMR) Parameters =====
    // BASE_MMR_BPS (default 10%) + PENALTY_MMR_BPS (default 10%) + f(fill_ratio) capped by MAX_MMR_BPS (default 50%)
    uint256 public baseMmrBps = 1000;           // 10% buffer
    uint256 public penaltyMmrBps = 1000;        // +10% penalty ⇒ total 20%
    uint256 public maxMmrBps = 2000;            // Cap at 20%
    // Linear scaling slopes (disabled for fixed 20%)
    uint256 public scalingSlopeBps = 0;         // 0% scaling
    uint256 public priceGapSlopeBps = 0;        // 0% price-gap sensitivity
    // Liquidity sampling depth (kept for API compat, unused with scaling=0)
    uint256 public mmrLiquidityDepthLevels = 1; // minimal depth
    
    // ============ ADL Gas & Debug Controls ============
    // Limit number of profitable positions considered (top-K) and processed per tx
    uint256 public adlMaxCandidates = 50;       // Max candidates to sort/evaluate
    uint256 public adlMaxPositionsPerTx = 10;   // Max positions reduced per ADL execution
    bool public adlDebug = false;               // Guard for verbose debug events
    
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
    event MarginUnreserved(address indexed user, bytes32 orderId, uint256 amount);
    event MarketAuthorized(bytes32 indexed marketId, address indexed orderBook);
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
    event LiquidatorRewardPaid(address indexed liquidator, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount, uint256 liquidatorCollateral);
    event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
    
    // Enhanced liquidation events
    event AvailableCollateralConfiscated(address indexed user, uint256 amount, uint256 remainingAvailable);
    event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral);
    event AdlConfigUpdated(uint256 maxCandidates, uint256 maxPositionsPerTx, bool debugEnabled);
    // Haircut-specific transparency events
    event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
    event BadDebtOffset(bytes32 indexed marketId, uint256 amount, uint256 remainingBadDebt);
    // Debug: Detailed liquidation eligibility check
    event DebugIsLiquidatable(
        address indexed user,
        bytes32 indexed marketId,
        int256 positionSize,
        uint256 markPrice,
        uint256 trigger,
        uint256 oneTick,
        uint256 notional6,
        int256 equity6,
        uint256 maintenance6,
        bool usedFallback,
        bool result
    );
    
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

        // Enforce 6-decimal collateral token to match vault accounting units
        // All collateral, margin, and penalties are tracked in 6 decimals (USDC precision)
        uint8 decs;
        try IERC20Metadata(_collateralToken).decimals() returns (uint8 d) {
            decs = d;
        } catch {
            revert("Collateral token must implement decimals()");
        }
        require(decs == 6, "Collateral must be 6 decimals");
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
        
        // Use unified available collateral including realized PnL
        uint256 available = getAvailableCollateral(msg.sender);
        require(available >= amount, "!available");

        // Determine how much to withdraw from realized PnL (6 decimals) vs deposited collateral
        int256 realizedPnL18 = userRealizedPnL[msg.sender];
        uint256 realizedPnL6 = realizedPnL18 > 0 ? uint256(realizedPnL18 / int256(DECIMAL_SCALE)) : 0;
        uint256 fromPnL = amount <= realizedPnL6 ? amount : realizedPnL6;
        uint256 fromDeposit = amount - fromPnL;

        // Apply withdrawal against realized PnL first (reduce realized PnL balance)
        if (fromPnL > 0) {
            // Convert back to 18 decimals to adjust realized PnL mapping
            userRealizedPnL[msg.sender] -= int256(fromPnL * DECIMAL_SCALE);
        }

        // Withdraw the remainder from deposited collateral
        if (fromDeposit > 0) {
            require(userCollateral[msg.sender] >= fromDeposit, "!balance");
            userCollateral[msg.sender] -= fromDeposit;
            totalCollateralDeposited -= fromDeposit;
        }

        // Transfer total amount out
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
        
        // Realize any per-position haircut tied to this trade against realized PnL from the closed units
        if (result.haircutToConfiscate6 > 0) {
            // Available realized profit to offset haircut (convert realized PnL 18d -> 6d)
            uint256 realizedProfit6 = 0;
            if (result.realizedPnL > 0) {
                realizedProfit6 = uint256(result.realizedPnL) / DECIMAL_SCALE;
            }
            uint256 appliedFromProfit6 = result.haircutToConfiscate6 <= realizedProfit6 ? result.haircutToConfiscate6 : realizedProfit6;
            if (appliedFromProfit6 > 0) {
                // Reduce realized profit credited to the user
                int256 applied18 = int256(appliedFromProfit6) * int256(DECIMAL_SCALE);
                // Clamp: do not underflow below zero
                if (result.realizedPnL > 0 && applied18 <= result.realizedPnL) {
                    result.realizedPnL = result.realizedPnL - applied18;
                } else if (result.realizedPnL > 0) {
                    result.realizedPnL = 0;
                }
                // Decrement the cumulative UI ledger
                uint256 ledger = userSocializedLoss[user];
                if (ledger > 0) {
                    userSocializedLoss[user] = appliedFromProfit6 >= ledger ? 0 : (ledger - appliedFromProfit6);
                }
                emit HaircutApplied(user, marketId, appliedFromProfit6, userCollateral[user]);
            }
            // Any remainder beyond realized profit becomes bad debt tied to this liquidation of units
            uint256 remainderHaircut6 = result.haircutToConfiscate6 - appliedFromProfit6;
            if (remainderHaircut6 > 0) {
                marketBadDebt[marketId] += remainderHaircut6;
                emit BadDebtRecorded(marketId, remainderHaircut6, user);
            }
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

        // Recompute and store fixed liquidation price for this position
        _recomputeAndStoreLiquidationPrice(user, marketId);
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
        bytes memory data = abi.encodeWithSelector(this.updatePositionWithLiquidation.selector, user, marketId, sizeDelta, executionPrice, liquidator);
        _delegateLiq(data);
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
        // Include realized PnL (18d -> 6d) in available margin
        {
            // Guard against double-counting realized losses:
            // - If user has no open positions, do not add negative realized PnL
            // - If any position is currently under liquidation control, negative realized PnL
            //   has already been reflected via collateral seizure; do not add it again.
            bool hasOpenPositions = userPositions[user].length > 0;
            bool anyUnderLiquidation = false;
            if (hasOpenPositions) {
                for (uint256 i = 0; i < userPositions[user].length; i++) {
                    if (isUnderLiquidationPosition[user][userPositions[user][i].marketId]) {
                        anyUnderLiquidation = true;
                        break;
                    }
                }
            }
            int256 realizedPnLAdj = realizedPnL;
            if (!hasOpenPositions && realizedPnLAdj < 0) {
                realizedPnLAdj = 0;
            }
            if (anyUnderLiquidation && realizedPnLAdj < 0) {
                realizedPnLAdj = 0;
            }
            int256 realizedPnL6 = realizedPnLAdj / int256(DECIMAL_SCALE);
            int256 baseWithRealized = int256(totalCollateral) + realizedPnL6;
            uint256 availableBeforeReserved = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;
            availableMargin = availableBeforeReserved > totalMarginCommitted
                ? (availableBeforeReserved - totalMarginCommitted)
                : 0;

            // Subtract outstanding socialized loss accrued on open positions (6 decimals)
            if (availableMargin > 0) {
                uint256 outstandingHaircut6 = 0;
                for (uint256 i = 0; i < userPositions[user].length; i++) {
                    outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
                }
                if (outstandingHaircut6 > 0) {
                    availableMargin = availableMargin > outstandingHaircut6
                        ? (availableMargin - outstandingHaircut6)
                        : 0;
                }
            }
        }
        
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
        
        // Align with unified summary: avoid double-counting negative realized PnL
        // during liquidation partial closes (collateral already seized).
        int256 realizedAdj = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedAdj < 0) {
            realizedAdj = 0;
        } else if (realizedAdj < 0) {
            bool anyUnderLiquidation = false;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                if (isUnderLiquidationPosition[user][userPositions[user][i].marketId]) {
                    anyUnderLiquidation = true;
                    break;
                }
            }
            if (anyUnderLiquidation) {
                realizedAdj = 0;
            }
        }

        VaultAnalytics.MarginSummary memory summary = VaultAnalytics.getMarginSummary(
            userCollateral[user],
            realizedAdj,
            positions,
            userPendingOrders[user],
            markPrices
        );

        // Subtract outstanding per-position socialized haircuts from availableCollateral
        if (summary.availableCollateral > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                summary.availableCollateral = summary.availableCollateral > outstandingHaircut6
                    ? (summary.availableCollateral - outstandingHaircut6)
                    : 0;
            }
        }

        return summary;
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
        
        // Add realized PnL converted to 6 decimals (PnL is tracked in 18 decimals)
        int256 realizedPnL18 = userRealizedPnL[user];
        // Guard: if no open positions and realizedPnL is negative, do not add it to available collateral
        if (userPositions[user].length == 0 && realizedPnL18 < 0) {
            realizedPnL18 = 0;
        }
        int256 realizedPnL6 = realizedPnL18 / int256(DECIMAL_SCALE);
        int256 baseWithRealized = int256(baseAvailable) + realizedPnL6;
        uint256 availableWithRealized = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;

        // Subtract outstanding per-position socialized loss (6 decimals)
        if (availableWithRealized > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i = 0; i < userPositions[user].length; i++) {
                outstandingHaircut6 += userPositions[user][i].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                availableWithRealized = availableWithRealized > outstandingHaircut6
                    ? (availableWithRealized - outstandingHaircut6)
                    : 0;
            }
        }

        // Subtract margin reserved for pending orders
        uint256 reserved = 0;
        VaultAnalytics.PendingOrder[] storage pending = userPendingOrders[user];
        for (uint256 i = 0; i < pending.length; i++) {
            reserved += pending[i].marginReserved;
        }
        return availableWithRealized > reserved ? availableWithRealized - reserved : 0;
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

    /**
     * @dev Payout equity for a specific market position: posted_margin + PnL - socialized_loss (all 6 decimals)
     *      This is strictly for payout/accounting views; liquidation/MMR math remains unchanged.
     */
    function getPositionPayoutEquity(
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
                // Equity for payout: posted margin + PnL - accrued haircut
                equity6 = int256(positions[i].marginLocked) + pnl6 - int256(positions[i].socializedLossAccrued6);
                return (equity6, notional6, true);
            }
        }
        return (0, 0, false);
    }

    /**
     * @dev Sum payout equity across all open positions for a user.
     *      Returns (equity6Total, notional6Total).
     */
    function getUserPayoutEquityTotal(address user) external view returns (int256 equity6Total, uint256 notional6Total) {
        PositionManager.Position[] storage positions = userPositions[user];
        int256 total = 0;
        uint256 totalNotional = 0;
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].size != 0) {
                uint256 markPrice = getMarkPrice(positions[i].marketId);
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                totalNotional += (absSize * markPrice) / (10**18);

                int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                total += int256(positions[i].marginLocked) + pnl6 - int256(positions[i].socializedLossAccrued6);
            }
        }
        return (total, totalNotional);
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
        require(amount > 0, "!amount");

        // Prefer consuming realized PnL (6 decimals) first, then deposited collateral
        int256 realizedPnL18 = userRealizedPnL[user];
        uint256 realizedPnL6 = realizedPnL18 > 0 ? uint256(realizedPnL18 / int256(DECIMAL_SCALE)) : 0;
        uint256 fromPnL = amount <= realizedPnL6 ? amount : realizedPnL6;
        uint256 fromDeposit = amount - fromPnL;

        if (fromPnL > 0) {
            userRealizedPnL[user] -= int256(fromPnL * DECIMAL_SCALE);
        }

        if (fromDeposit > 0) {
            require(userCollateral[user] >= fromDeposit, "!balance");
            userCollateral[user] -= fromDeposit;
        }

        userCollateral[recipient] += amount;
    }

    function transferCollateral(address from, address to, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(userCollateral[from] >= amount, "!balance");
        userCollateral[from] -= amount;
        userCollateral[to] += amount;
    }

    // Pay a liquidation maker reward from OrderBook's credited balance and emit event for offchain visibility.
    function payMakerLiquidationReward(
        address liquidatedUser,
        bytes32 marketId,
        address maker,
        uint256 amount
    ) external onlyRole(ORDERBOOK_ROLE) {
        require(maker != address(0) && amount > 0, "invalid");
        address ob = marketToOrderBook[marketId];
        require(ob != address(0) && ob == msg.sender, "unauthorized ob");
        require(userCollateral[ob] >= amount, "insufficient ob balance");
        userCollateral[ob] -= amount;
        userCollateral[maker] += amount;
        emit MakerLiquidationRewardPaid(maker, liquidatedUser, marketId, amount);
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
                // Relax guard: allow release below accrued haircut. Haircut is realized from payout streams, not enforced by margin floor.
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
                // Do not allow marginLocked below accrued haircut at any time (top-up only increases)
                positionFound = true;
                emit MarginLocked(user, marketId, amount, userPositions[user][i].marginLocked);
                break;
            }
        }
        require(positionFound, "No position found for market");
        totalMarginLocked += amount;

        // Recompute fixed liquidation trigger after top-up
        _recomputeAndStoreLiquidationPrice(user, marketId);
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

    // ============ ADL Configuration ============
    function setAdlConfig(
        uint256 maxCandidates,
        uint256 maxPositionsPerTx,
        bool debugEnabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(maxCandidates > 0 && maxCandidates <= 500, "CoreVault: invalid maxCandidates");
        require(maxPositionsPerTx > 0 && maxPositionsPerTx <= 100, "CoreVault: invalid maxPositionsPerTx");
        adlMaxCandidates = maxCandidates;
        adlMaxPositionsPerTx = maxPositionsPerTx;
        adlDebug = debugEnabled;
        emit AdlConfigUpdated(maxCandidates, maxPositionsPerTx, debugEnabled);
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
    ) external returns (bool) {
        bytes memory data = abi.encodeWithSelector(this.isLiquidatable.selector, user, marketId, markPrice);
        bytes memory ret = _delegateLiq(data);
        return abi.decode(ret, (bool));
    }

    /**
     * @dev Debug helper to emit a DebugIsLiquidatable event using current stored data.
     *      Restricted to ORDERBOOK_ROLE to avoid arbitrary spam.
     */
    function debugEmitIsLiquidatable(address user, bytes32 marketId, uint256 markPrice) external onlyRole(ORDERBOOK_ROLE) {
        bytes memory data = abi.encodeWithSelector(this.debugEmitIsLiquidatable.selector, user, marketId, markPrice);
        _delegateLiq(data);
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
                // If under liquidation, hide the liquidation price (display 0)
                if (isUnderLiquidationPosition[user][marketId]) {
                    return (0, true);
                }
                return (positions[i].liquidationPrice, true);
            }
        }
        return (0, false);
    }

    // Recompute fixed liquidation trigger for a user's position in a market
    function _recomputeAndStoreLiquidationPrice(address user, bytes32 marketId) internal {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                // Approximate fixed trigger using current equity-per-unit snapshot
                uint256 mark = getMarkPrice(marketId);
                if (mark == 0) { mark = positions[i].entryPrice; }
                // Keep mark calculations for completeness, but avoid unused vars
                // and do not use equity in short-liq formula to keep mark-independence.
                // int256 priceDiff = int256(mark) - int256(positions[i].entryPrice);
                // int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                // int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                if (absSize == 0) { positions[i].liquidationPrice = 0; return; }
                if (positions[i].size > 0) {
                    // Policy: Long positions display a liquidation price of 0
                    positions[i].liquidationPrice = 0;
                } else {
                    // Short trigger (mark-independent, 1:1 with original):
                    // P_liq = (entryPrice + marginPerUnit) * 10000 / (10000 + MMR)
                    // where marginPerUnit = (marginLocked * 1e18) / |Q|   → 6 decimals
                    uint256 marginPerUnit6 = Math.mulDiv(positions[i].marginLocked, 1e18, absSize);
                    uint256 numerator = positions[i].entryPrice + marginPerUnit6;
                    uint256 denomBps = 10000 + mmrBps;
                    positions[i].liquidationPrice = Math.mulDiv(numerator, 10000, denomBps);
                }
                return;
            }
        }
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
        // Fixed MMR: base + penalty, no scaling/gap
        marketId; positionSize; // silence warnings
        uint256 mmr = baseMmrBps + penaltyMmrBps; // 20%
        if (mmr > maxMmrBps) mmr = maxMmrBps;     // cap 20%
        return (mmr, 0, 0);
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
        try IOBPricingFacet(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels) returns (
            uint256[] memory /*bidPrices*/,
            uint256[] memory bidAmounts,
            uint256[] memory /*askPrices*/,
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
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        bytes memory data = abi.encodeWithSelector(this.liquidateShort.selector, user, marketId, liquidator, executionPrice);
        _delegateLiq(data);
    }

    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        bytes memory data = abi.encodeWithSelector(this.liquidateLong.selector, user, marketId, liquidator, executionPrice);
        _delegateLiq(data);
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
        bytes memory data = abi.encodeWithSelector(this.confiscateAvailableCollateralForGapLoss.selector, user, gapLossAmount);
        _delegateLiq(data);
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
        bytes memory data = abi.encodeWithSelector(this.socializeLoss.selector, marketId, lossAmount, liquidatedUser);
        _delegateLiq(data);
    }
    
    /**
     * @dev Internal function to socialize losses via Administrative Position Closure (ADL) system
     * @param marketId Market where the loss occurred
     * @param lossAmount Amount to socialize across users
     * @param liquidatedUser The user who was liquidated (for event tracking)
     */
    // removed: _socializeLoss (delegated to LiquidationManager)
    
    /**
     * @dev Get all users who have positions in a specific market
     * @param marketId Market ID to check
     * @return users Array of user addresses with positions in the market
     */
    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        // Gas-optimized: create temp array sized to allKnownUsers, then trim
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
        
        // Trim to count
        address[] memory usersWithPositions = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            usersWithPositions[i] = tempUsers[i];
        }
        
        return usersWithPositions;
    }

    /**
     * @dev Public view: return all users who currently have non-zero positions in the given market.
     *      This is used by liquidation scanners to build a comprehensive candidate set.
     */
    function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory) {
        return _getUsersWithPositionsInMarket(marketId);
    }
    
    // ============ Administrative Position Closure Implementation ============
    
    /**
     * @dev Find all profitable positions in a market for ADL system
     * @param marketId Market ID to search
     * @param excludeUser User to exclude (the liquidated user)
     * @return Array of profitable positions sorted by profit score
     */
    // removed: _findProfitablePositions (delegated to LiquidationManager)
    
    /**
     * @dev Calculate unrealized PnL for a position at current mark price
     * @param position Position to calculate PnL for
     * @param markPrice Current mark price
     * @return Unrealized PnL in USDC (6 decimals)
     */
    // removed: _calculateUnrealizedPnL (delegated to LiquidationManager)
    
    /**
     * @dev Sort profitable positions by profit score (highest first) using insertion sort
     * @param positions Array of positions to sort (modified in-place)
     */
    // removed: _sortProfitablePositionsByScore

    /**
     * @dev Select approximate top-K by profitScore using a single pass thresholding approach.
     *      This avoids sorting the entire array when many candidates are present.
     */
    // removed: _selectTopKByProfitScore
    
    /**
     * @dev Execute administrative position closure to realize profits for loss coverage
     * @param user User whose position will be reduced
     * @param marketId Market ID
     * @param currentPositionSize Current position size
     * @param entryPrice Current entry price
     * @param targetProfit Amount of profit to realize
     * @return PositionClosureResult with success status and details
     */
    // removed: _executeAdministrativePositionClosure

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
