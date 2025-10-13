// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";
import "./diamond/interfaces/IOBPricingFacet.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

// Removed legacy IOrderBook; use IOBPricingFacet for depth

contract LiquidationManager is AccessControl, ReentrancyGuard, Pausable {
    

    // Constants copied from CoreVault for liquidation math context
    uint256 public constant LIQUIDATION_PENALTY_BPS = 1000; // 10%
    uint256 public constant DECIMAL_SCALE = 1e12; // 10^(ALU_DECIMALS - USDC_DECIMALS)
    uint256 public constant TICK_PRECISION = 1e6; // Price ticks in USDC precision (6 decimals)

    // Roles to mirror CoreVault expectations
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    

    // Storage alignment with CoreVault (must match order exactly for delegatecall)
    address public liquidationManager; // alignment slot
    IERC20 public immutable collateralToken;

    mapping(address => uint256) public userCollateral;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => PositionManager.Position[]) public userPositions;
    mapping(address => VaultAnalytics.PendingOrder[]) public userPendingOrders;
    mapping(address => bytes32[]) public userMarketIds;
    mapping(address => uint256) public userSocializedLoss;
    address[] public allKnownUsers;
    mapping(address => bool) public isKnownUser;

    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => mapping(bytes32 => bool)) public isUnderLiquidationPosition;
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorPrice;
    mapping(address => mapping(bytes32 => uint256)) public liquidationAnchorTimestamp;
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets;
    address[] public allOrderBooks;
    mapping(bytes32 => uint256) public marketMarkPrices;
    mapping(bytes32 => uint256) public marketBadDebt;

    uint256 public baseMmrBps = 1000;
    uint256 public penaltyMmrBps = 1000;
    uint256 public maxMmrBps = 2000;
    uint256 public scalingSlopeBps = 0;
    uint256 public priceGapSlopeBps = 0;
    uint256 public mmrLiquidityDepthLevels = 1;

    uint256 public adlMaxCandidates = 50;
    uint256 public adlMaxPositionsPerTx = 10;
    bool public adlDebug = false;

    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;

    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
    event LiquidatorRewardPaid(address indexed liquidator, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount, uint256 liquidatorCollateral);
    event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
    event AvailableCollateralConfiscated(address indexed user, uint256 amount, uint256 remainingAvailable);
    event UserLossSocialized(address indexed user, uint256 lossAmount, uint256 remainingCollateral);
    event AdlConfigUpdated(uint256 maxCandidates, uint256 maxPositionsPerTx, bool debugEnabled);
    event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter);
    event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
    event BadDebtOffset(bytes32 indexed marketId, uint256 amount, uint256 remainingBadDebt);
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
    event SocializationStarted(bytes32 indexed marketId, uint256 totalLossAmount, address indexed liquidatedUser, uint256 timestamp);
    event ProfitablePositionFound(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 entryPrice, uint256 markPrice, uint256 unrealizedPnL, uint256 profitScore);
    event AdministrativePositionClosure(address indexed user, bytes32 indexed marketId, uint256 sizeBeforeReduction, uint256 sizeAfterReduction, uint256 realizedProfit, uint256 newEntryPrice);
    event SocializationCompleted(bytes32 indexed marketId, uint256 totalLossCovered, uint256 remainingLoss, uint256 positionsAffected, address indexed liquidatedUser);
    event SocializationFailed(bytes32 indexed marketId, uint256 lossAmount, string reason, address indexed liquidatedUser);
    event DebugProfitCalculation(address indexed user, bytes32 indexed marketId, uint256 entryPrice, uint256 markPrice, int256 positionSize, int256 unrealizedPnL, uint256 profitScore);
    event DebugPositionReduction(address indexed user, bytes32 indexed marketId, uint256 originalSize, uint256 reductionAmount, uint256 newSize, uint256 realizedPnL);
    event DebugSocializationState(bytes32 indexed marketId, uint256 remainingLoss, uint256 totalProfitableUsers, uint256 processedUsers);

    struct ProfitablePosition {
        address user;
        int256 positionSize;
        uint256 entryPrice;
        uint256 unrealizedPnL;
        uint256 profitScore;
        bool isLong;
    }

    struct PositionClosureResult {
        bool success;
        uint256 realizedProfit;
        uint256 newPositionSize;
        uint256 newEntryPrice;
        string failureReason;
    }

    constructor(address _collateralToken, address _admin) {
        collateralToken = IERC20(_collateralToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        uint8 decs;
        try IERC20Metadata(_collateralToken).decimals() returns (uint8 d) { decs = d; } catch { revert("Collateral token must implement decimals()"); }
        require(decs == 6, "Collateral must be 6 decimals");
    }

    function setUnderLiquidation(
        address user,
        bytes32 marketId,
        bool state
    ) external onlyRole(ORDERBOOK_ROLE) {
        bool prev = isUnderLiquidationPosition[user][marketId];
        isUnderLiquidationPosition[user][marketId] = state;
        if (state) {
            if (!prev && liquidationAnchorPrice[user][marketId] == 0) {
                uint256 anchor = getMarkPrice(marketId);
                if (anchor == 0) { anchor = marketMarkPrices[marketId]; }
                liquidationAnchorPrice[user][marketId] = anchor;
                liquidationAnchorTimestamp[user][marketId] = block.timestamp;
            }
        } else {
            liquidationAnchorPrice[user][marketId] = 0;
            liquidationAnchorTimestamp[user][marketId] = 0;
            _recomputeAndStoreLiquidationPrice(user, marketId);
        }
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        return marketMarkPrices[marketId];
    }

    function isLiquidatable(
        address user,
        bytes32 marketId,
        uint256 markPrice
    ) external returns (bool) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                if (isUnderLiquidationPosition[user][marketId]) { return true; }
                uint256 trigger = positions[i].liquidationPrice;
                if (trigger == 0) {
                    uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                    if (markPrice == 0 || absSize == 0) { return false; }
                    uint256 notional6 = (absSize * markPrice) / (10**18);
                    int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                    int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                    int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                    int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                    (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                    uint256 maintenance6 = (notional6 * mmrBps) / 10000;
                    bool resFallback = equity6 <= (int256(maintenance6) + int256(1));
                    return resFallback;
                }
                uint256 oneTick = 1;
                if (positions[i].size > 0) {
                    bool res = markPrice <= (trigger + oneTick);
                    return res;
                } else {
                    bool res2 = (markPrice + oneTick) >= trigger;
                    return res2;
                }
            }
        }
        return false;
    }

    function debugEmitIsLiquidatable(address user, bytes32 marketId, uint256 markPrice) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                uint256 trigger = positions[i].liquidationPrice;
                uint256 oneTick = 1;
                bool usedFallback = false;
                uint256 notional6 = 0;
                int256 equity6 = 0;
                uint256 maintenance6 = 0;
                bool result;
                if (trigger == 0) {
                    usedFallback = true;
                    uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                    if (markPrice == 0 || absSize == 0) {
                        emit DebugIsLiquidatable(user, marketId, positions[i].size, markPrice, 0, oneTick, 0, 0, 0, true, false);
                        return;
                    }
                    notional6 = (absSize * markPrice) / (10**18);
                    int256 priceDiff = int256(markPrice) - int256(positions[i].entryPrice);
                    int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                    int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                    equity6 = int256(positions[i].marginLocked) + pnl6;
                    (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                    maintenance6 = (notional6 * mmrBps) / 10000;
                    result = equity6 <= int256(maintenance6);
                } else if (positions[i].size > 0) {
                    result = markPrice <= (trigger + oneTick);
                } else {
                    result = (markPrice + oneTick) >= trigger;
                }
                emit DebugIsLiquidatable(
                    user,
                    marketId,
                    positions[i].size,
                    markPrice,
                    trigger,
                    oneTick,
                    notional6,
                    equity6,
                    maintenance6,
                    usedFallback,
                    result
                );
                return;
            }
        }
        emit DebugIsLiquidatable(user, marketId, 0, markPrice, 0, 1, 0, 0, 0, false, false);
    }

    function getLiquidationPrice(
        address user,
        bytes32 marketId
    ) external view returns (uint256 liquidationPrice, bool hasPosition) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                hasPosition = true;
                if (isUnderLiquidationPosition[user][marketId]) { return (0, true); }
                return (positions[i].liquidationPrice, true);
            }
        }
        return (0, false);
    }

    function _recomputeAndStoreLiquidationPrice(address user, bytes32 marketId) internal {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                (uint256 mmrBps, ) = _computeEffectiveMMRBps(user, marketId, positions[i].size);
                uint256 mark = getMarkPrice(marketId);
                if (mark == 0) { mark = positions[i].entryPrice; }
                int256 priceDiff = int256(mark) - int256(positions[i].entryPrice);
                int256 pnl18 = (priceDiff * positions[i].size) / int256(TICK_PRECISION);
                int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                int256 equity6 = int256(positions[i].marginLocked) + pnl6;
                uint256 absSize = uint256(positions[i].size >= 0 ? positions[i].size : -positions[i].size);
                if (absSize == 0) { positions[i].liquidationPrice = 0; return; }
                int256 eOverQ6 = (equity6 * int256(1e18)) / int256(absSize);
                if (positions[i].size > 0) {
                    int256 numeratorSigned = int256(mark) - eOverQ6;
                    uint256 denomBps = 10000 - mmrBps;
                    uint256 numerator = numeratorSigned > 0 ? uint256(numeratorSigned) : 0;
                    positions[i].liquidationPrice = denomBps == 0 ? 0 : Math.mulDiv(numerator, 10000, denomBps);
                } else {
                    int256 numeratorSigned = int256(mark) + eOverQ6;
                    uint256 denomBps = 10000 + mmrBps;
                    uint256 numerator = numeratorSigned > 0 ? uint256(numeratorSigned) : 0;
                    positions[i].liquidationPrice = Math.mulDiv(numerator, 10000, denomBps);
                }
                return;
            }
        }
    }

    function liquidateShort(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size < 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 settlePrice = executionPrice > 0 ? executionPrice : markPrice;

                uint256 tradingLoss = 0;
                if (settlePrice > entryPrice) {
                    uint256 lossPerUnit = settlePrice - entryPrice;
                    tradingLoss = (lossPerUnit * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
            
                uint256 absSizeMark = uint256(-oldSize);
                uint256 notional6 = (absSizeMark * settlePrice) / (10**18);
                uint256 penalty = (notional6 * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLoss = tradingLoss + penalty;
            
                uint256 seizableFromLocked = actualLoss > locked ? locked : actualLoss;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLoss > seized ? (tradingLoss - seized) : 0;
                if (uncoveredLoss > 0) {
                    uint256 anchor = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading = seized > 0 ? (tradingLoss > seized ? seized : tradingLoss) : 0;
                    uint256 anchorTradingLoss = tradingLoss;
                    if (anchor > 0) {
                        uint256 effPrice = settlePrice > anchor ? settlePrice : anchor;
                        if (effPrice < entryPrice) {
                            uint256 lossPerUnitA = entryPrice - effPrice;
                            anchorTradingLoss = (lossPerUnitA * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                        } else {
                            anchorTradingLoss = 0;
                        }
                    }
                    uint256 allowedUncovered = anchorTradingLoss > seizedAppliedToTrading ? (anchorTradingLoss - seizedAppliedToTrading) : 0;
                    if (allowedUncovered < uncoveredLoss) {
                        uint256 excess = uncoveredLoss - allowedUncovered;
                        marketBadDebt[marketId] += excess;
                        emit BadDebtRecorded(marketId, excess, user);
                        uncoveredLoss = allowedUncovered;
                    }
                }
                if (uncoveredLoss > 0) {
                    uint256 anchor2 = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading2 = seized > 0 ? (tradingLoss > seized ? seized : tradingLoss) : 0;
                    uint256 anchorTradingLoss2 = tradingLoss;
                    if (anchor2 > 0) {
                        uint256 effPrice2 = settlePrice < anchor2 ? settlePrice : anchor2;
                        if (effPrice2 > entryPrice) {
                            uint256 lossPerUnitA2 = effPrice2 - entryPrice;
                            anchorTradingLoss2 = (lossPerUnitA2 * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                        } else {
                            anchorTradingLoss2 = 0;
                        }
                    }
                    uint256 allowedUncovered2 = anchorTradingLoss2 > seizedAppliedToTrading2 ? (anchorTradingLoss2 - seizedAppliedToTrading2) : 0;
                    if (allowedUncovered2 < uncoveredLoss) {
                        uint256 excess2 = uncoveredLoss - allowedUncovered2;
                        marketBadDebt[marketId] += excess2;
                        emit BadDebtRecorded(marketId, excess2, user);
                        uncoveredLoss = allowedUncovered2;
                    }
                }
            
                if (seized > 0) {
                    userCollateral[user] -= seized;
                    uint256 seizedForTradingLoss = tradingLoss > seized ? seized : tradingLoss;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penalty > seizedRemainder ? seizedRemainder : penalty;
                    address ob2 = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob2 != address(0)) {
                        userCollateral[ob2] += makerRewardPool;
                    }
                }

                int256 realizedPnL = 0;
                {
                    int256 priceDiff = int256(settlePrice) - int256(entryPrice);
                    realizedPnL = (priceDiff * oldSize) / int256(TICK_PRECISION);
                }

                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                _removeMarketIdFromUser(user, marketId);
                liquidationAnchorPrice[user][marketId] = 0;
                liquidationAnchorTimestamp[user][marketId] = 0;

                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }
                if (uncoveredLoss > 0) { _socializeLoss(marketId, uncoveredLoss, user); }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                return;
            }
        }
    }

    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 executionPrice
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size > 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = positions[i].marginLocked;
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);
                uint256 settlePrice = executionPrice > 0 ? executionPrice : markPrice;

                uint256 tradingLoss = 0;
                if (settlePrice < entryPrice) {
                    uint256 lossPerUnit = entryPrice - settlePrice;
                    tradingLoss = (lossPerUnit * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
            
                uint256 absSizeMark = uint256(oldSize);
                uint256 notional6 = (absSizeMark * settlePrice) / (10**18);
                uint256 penalty = (notional6 * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLoss = tradingLoss + penalty;
            
                uint256 seizableFromLocked = actualLoss > locked ? locked : actualLoss;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLoss > seized ? (tradingLoss - seized) : 0;
            
                if (seized > 0) {
                    userCollateral[user] -= seized;
                    uint256 seizedForTradingLoss = tradingLoss > seized ? seized : tradingLoss;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penalty > seizedRemainder ? seizedRemainder : penalty;
                    address ob3 = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob3 != address(0)) {
                        userCollateral[ob3] += makerRewardPool;
                    }
                }

                int256 realizedPnL = 0;
                {
                    int256 priceDiff = int256(settlePrice) - int256(entryPrice);
                    realizedPnL = (priceDiff * oldSize) / int256(TICK_PRECISION);
                }

                if (locked <= totalMarginLocked) { totalMarginLocked -= locked; }
                if (i < positions.length - 1) { positions[i] = positions[positions.length - 1]; }
                positions.pop();

                _removeMarketIdFromUser(user, marketId);
                // Notify OrderBook removed to avoid external calls here; OB syncs via events/trade flow
                
                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }
                if (uncoveredLoss > 0) { _socializeLoss(marketId, uncoveredLoss, user); }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                return;
            }
        }
    }

    // Mirror CoreVault partial liquidation handler for external callers retaining try/catch semantics
    function updatePositionWithLiquidation(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                int256 oldSize = positions[i].size;
                bool closesExposure = (oldSize > 0 && sizeDelta < 0) || (oldSize < 0 && sizeDelta > 0);
                if (!closesExposure) {
                    int256 candidateNewSize = oldSize + sizeDelta;
                    uint256 basisForMargin = executionPrice;
                    bool sameDirection = (oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0);
                    if (!sameDirection && oldSize != 0) {
                        basisForMargin = positions[i].entryPrice;
                    }
                    uint256 requiredForCandidate = _calculateExecutionMargin(candidateNewSize, basisForMargin);
                    PositionManager.NettingResult memory nr = PositionManager.executePositionNetting(
                        positions,
                        user,
                        marketId,
                        sizeDelta,
                        executionPrice,
                        requiredForCandidate
                    );
                    if (nr.marginToLock > 0) totalMarginLocked += nr.marginToLock;
                    if (nr.marginToRelease > 0) totalMarginLocked -= nr.marginToRelease;
                    if (nr.realizedPnL != 0) userRealizedPnL[user] += nr.realizedPnL;
                    return;
                }

                uint256 absOld = uint256(oldSize > 0 ? oldSize : -oldSize);
                uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                uint256 closeAbs = absDelta > absOld ? absOld : absDelta;

                int256 newSize = oldSize + sizeDelta;
                if ((oldSize > 0 && newSize < 0) || (oldSize < 0 && newSize > 0)) { newSize = 0; }

                uint256 entryPrice = positions[i].entryPrice;
                uint256 tradingLossClosed = 0;
                if (oldSize > 0 && executionPrice < entryPrice) {
                    uint256 lossPerUnit = entryPrice - executionPrice;
                    tradingLossClosed = (lossPerUnit * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                } else if (oldSize < 0 && executionPrice > entryPrice) {
                    uint256 lossPerUnit2 = executionPrice - entryPrice;
                    tradingLossClosed = (lossPerUnit2 * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                uint256 notional6Closed = (closeAbs * executionPrice) / (10**18);
                uint256 penaltyClosed = (notional6Closed * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 actualLossClosed = tradingLossClosed + penaltyClosed;

                uint256 oldLocked = positions[i].marginLocked;
                uint256 basisPriceForMargin = executionPrice;
                if (closesExposure && newSize != 0) { basisPriceForMargin = entryPrice; }
                uint256 newRequiredMargin = _calculateExecutionMargin(newSize, basisPriceForMargin);
                uint256 confiscatable = oldLocked > newRequiredMargin ? (oldLocked - newRequiredMargin) : 0;
                uint256 collateralAvailable_ = userCollateral[user];
                uint256 seizableFromLocked = actualLossClosed > confiscatable ? confiscatable : actualLossClosed;
                uint256 seized = seizableFromLocked > collateralAvailable_ ? collateralAvailable_ : seizableFromLocked;
                uint256 uncoveredLoss = tradingLossClosed > seized ? (tradingLossClosed - seized) : 0;

                if (seized > 0) {
                    userCollateral[user] -= seized;
                    uint256 seizedForTradingLoss = tradingLossClosed > seized ? seized : tradingLossClosed;
                    uint256 seizedRemainder = seized - seizedForTradingLoss;
                    uint256 makerRewardPool = penaltyClosed > seizedRemainder ? seizedRemainder : penaltyClosed;
                    address ob = marketToOrderBook[marketId];
                    if (makerRewardPool > 0 && ob != address(0)) { userCollateral[ob] += makerRewardPool; }
                    emit MarginConfiscated(user, oldLocked, seized, penaltyClosed, liquidator);
                }

                positions[i].size = newSize;
                if (newSize == 0) {
                    if (i < positions.length - 1) { positions[i] = positions[positions.length - 1]; }
                    positions.pop();
                    if (oldLocked <= totalMarginLocked) { totalMarginLocked -= oldLocked; }
                    _removeMarketIdFromUser(user, marketId);
                    isUnderLiquidationPosition[user][marketId] = false;
                    liquidationAnchorPrice[user][marketId] = 0;
                    liquidationAnchorTimestamp[user][marketId] = 0;
                } else {
                    isUnderLiquidationPosition[user][marketId] = true;
                    positions[i].liquidationPrice = 0;
                }

                if (newSize != 0) {
                    uint256 newLocked = newRequiredMargin;
                    uint256 lockedReduction = oldLocked > newLocked ? (oldLocked - newLocked) : 0;
                    positions[i].marginLocked = newLocked;
                    if (lockedReduction > 0 && lockedReduction <= totalMarginLocked) { totalMarginLocked -= lockedReduction; }
                }

                int256 realizedPnL = 0;
                if (closeAbs > 0) {
                    int256 priceDiff = int256(executionPrice) - int256(entryPrice);
                    int256 closingSizeSigned = oldSize > 0 ? int256(closeAbs) : -int256(closeAbs);
                    realizedPnL = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
                }
                if (realizedPnL != 0) { userRealizedPnL[user] += realizedPnL; }

                if (uncoveredLoss > 0) {
                    uint256 anchor = liquidationAnchorPrice[user][marketId];
                    uint256 seizedAppliedToTrading = seized > 0 ? (tradingLossClosed > seized ? seized : tradingLossClosed) : 0;
                    uint256 allowedUncovered = uncoveredLoss;
                    if (anchor > 0) {
                        uint256 anchorTradingLossClosed = 0;
                        if (oldSize > 0) {
                            uint256 effPrice = executionPrice > anchor ? executionPrice : anchor;
                            if (effPrice < entryPrice) {
                                uint256 lossPerUnitA = entryPrice - effPrice;
                                anchorTradingLossClosed = (lossPerUnitA * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                            }
                        } else if (oldSize < 0) {
                            uint256 effPrice2 = executionPrice < anchor ? executionPrice : anchor;
                            if (effPrice2 > entryPrice) {
                                uint256 lossPerUnitB = effPrice2 - entryPrice;
                                anchorTradingLossClosed = (lossPerUnitB * closeAbs) / (DECIMAL_SCALE * TICK_PRECISION);
                            }
                        }
                        if (anchorTradingLossClosed <= seizedAppliedToTrading) {
                            allowedUncovered = 0;
                        } else {
                            allowedUncovered = anchorTradingLossClosed - seizedAppliedToTrading;
                            if (allowedUncovered > uncoveredLoss) { allowedUncovered = uncoveredLoss; }
                        }
                    }
                    if (allowedUncovered > 0) { _socializeLoss(marketId, allowedUncovered, user); }
                    uint256 excess = uncoveredLoss > allowedUncovered ? (uncoveredLoss - allowedUncovered) : 0;
                    if (excess > 0) { marketBadDebt[marketId] += excess; emit BadDebtRecorded(marketId, excess, user); }
                }

                emit LiquidationExecuted(user, marketId, liquidator, seized, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, newSize, entryPrice, newSize == 0 ? 0 : positions[i].marginLocked);
                return;
            }
        }
        revert("No position found for liquidation");
    }

    function _calculateExecutionMargin(int256 amount, uint256 executionPrice) internal pure returns (uint256) {
        uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
        uint256 notionalValue = (absAmount * executionPrice) / (10**18);
        uint256 marginBps = amount >= 0 ? 10000 : 15000;
        return (notionalValue * marginBps) / 10000;
    }

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

    function confiscateAvailableCollateralForGapLoss(
        address user, 
        uint256 gapLossAmount
    ) external onlyRole(ORDERBOOK_ROLE) {
        require(gapLossAmount > 0, "Gap loss amount must be positive");
        uint256 availableCollateral = getAvailableCollateral(user);
        require(availableCollateral >= gapLossAmount, "Insufficient available collateral for gap coverage");
        userCollateral[user] -= gapLossAmount;
        emit AvailableCollateralConfiscated(user, gapLossAmount, availableCollateral - gapLossAmount);
    }

    function socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) external onlyRole(ORDERBOOK_ROLE) {
        _socializeLoss(marketId, lossAmount, liquidatedUser);
    }

    function _socializeLoss(
        bytes32 marketId,
        uint256 lossAmount,
        address liquidatedUser
    ) internal {
        require(lossAmount > 0, "Loss amount must be positive");
        if (adlDebug) { emit SocializationStarted(marketId, lossAmount, liquidatedUser, block.timestamp); }
        ProfitablePosition[] memory profitablePositions = _findProfitablePositions(marketId, liquidatedUser);
        if (profitablePositions.length == 0) {
            marketBadDebt[marketId] += lossAmount;
            emit SocializationFailed(marketId, lossAmount, "No profitable positions found", liquidatedUser);
            emit BadDebtRecorded(marketId, lossAmount, liquidatedUser);
            emit SocializedLossApplied(marketId, 0, liquidatedUser);
            return;
        }
        if (profitablePositions.length > adlMaxCandidates) {
            ProfitablePosition[] memory topK = _selectTopKByProfitScore(profitablePositions, adlMaxCandidates);
            profitablePositions = topK;
        }
        uint256 markPrice = getMarkPrice(marketId);
        if (markPrice == 0) {
            marketBadDebt[marketId] += lossAmount;
            emit SocializationFailed(marketId, lossAmount, "Zero mark price", liquidatedUser);
            emit BadDebtRecorded(marketId, lossAmount, liquidatedUser);
            emit SocializedLossApplied(marketId, 0, liquidatedUser);
            return;
        }
        uint256 n = profitablePositions.length;
        uint256[] memory notionals6 = new uint256[](n);
        uint256 totalNotional6 = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 absSize = uint256(profitablePositions[i].positionSize >= 0 ? profitablePositions[i].positionSize : -profitablePositions[i].positionSize);
            uint256 notional6 = (absSize * markPrice) / 1e18;
            notionals6[i] = notional6;
            totalNotional6 += notional6;
        }
        if (totalNotional6 == 0) {
            marketBadDebt[marketId] += lossAmount;
            emit SocializationFailed(marketId, lossAmount, "Zero total notional", liquidatedUser);
            emit BadDebtRecorded(marketId, lossAmount, liquidatedUser);
            emit SocializedLossApplied(marketId, 0, liquidatedUser);
            return;
        }
        uint256[] memory targetAssign = new uint256[](n);
        for (uint256 i2 = 0; i2 < n; i2++) { targetAssign[i2] = (lossAmount * notionals6[i2]) / totalNotional6; }
        uint256 allocated = 0;
        uint256[] memory remainingCap = new uint256[](n);
        for (uint256 i3 = 0; i3 < n; i3++) {
            address u = profitablePositions[i3].user;
            PositionManager.Position[] storage positions2 = userPositions[u];
            for (uint256 j = 0; j < positions2.length; j++) {
                if (positions2[j].marketId == marketId && positions2[j].size != 0) {
                    uint256 absSize2 = uint256(positions2[j].size >= 0 ? positions2[j].size : -positions2[j].size);
                    uint256 notional62 = (absSize2 * markPrice) / 1e18;
                    int256 pnl18 = (int256(markPrice) - int256(positions2[j].entryPrice)) * positions2[j].size / int256(TICK_PRECISION);
                    int256 pnl6 = pnl18 / int256(DECIMAL_SCALE);
                    int256 equity6 = int256(positions2[j].marginLocked) + pnl6;
                    (uint256 mmrBps, ) = _computeEffectiveMMRBps(u, marketId, positions2[j].size);
                    uint256 maintenance6 = (notional62 * mmrBps) / 10000;
                    uint256 cap6 = 0;
                    if (equity6 > int256(maintenance6)) {
                        uint256 excess = uint256(equity6 - int256(maintenance6));
                        cap6 = excess;
                    }
                    uint256 assign = targetAssign[i3] <= cap6 ? targetAssign[i3] : cap6;
                    if (assign > 0) {
                        positions2[j].socializedLossAccrued6 += assign;
                        uint256 absSizeUnits18 = absSize2;
                        if (markPrice > 0) {
                            uint256 unitsTagged18 = (assign * (10**18)) / markPrice;
                            uint256 currentTagged18 = positions2[j].haircutUnits18;
                            uint256 untaggedCapacity18 = absSizeUnits18 > currentTagged18 ? (absSizeUnits18 - currentTagged18) : 0;
                            if (unitsTagged18 > untaggedCapacity18) { unitsTagged18 = untaggedCapacity18; }
                            if (unitsTagged18 > 0) { positions2[j].haircutUnits18 = currentTagged18 + unitsTagged18; }
                        }
                        userSocializedLoss[u] += assign;
                        allocated += assign;
                        emit HaircutApplied(u, marketId, assign, userCollateral[u]);
                    }
                    remainingCap[i3] = cap6 > assign ? (cap6 - assign) : 0;
                    break;
                }
            }
        }
        uint256 remaining = lossAmount > allocated ? (lossAmount - allocated) : 0;
        if (remaining > 0) {
            for (uint256 i4 = 0; i4 < n && remaining > 0; i4++) {
                if (remainingCap[i4] == 0) continue;
                address u2 = profitablePositions[i4].user;
                PositionManager.Position[] storage positions3 = userPositions[u2];
                for (uint256 j2 = 0; j2 < positions3.length && remaining > 0; j2++) {
                    if (positions3[j2].marketId == marketId && positions3[j2].size != 0) {
                        uint256 addl = remaining <= remainingCap[i4] ? remaining : remainingCap[i4];
                        if (addl > 0) {
                            positions3[j2].socializedLossAccrued6 += addl;
                            uint256 absSizeUnits18b = uint256(positions3[j2].size >= 0 ? positions3[j2].size : -positions3[j2].size);
                            if (markPrice > 0) {
                                uint256 unitsTagged18b = (addl * (10**18)) / markPrice;
                                uint256 currentTagged18b = positions3[j2].haircutUnits18;
                                uint256 untaggedCapacity18b = absSizeUnits18b > currentTagged18b ? (absSizeUnits18b - currentTagged18b) : 0;
                                if (unitsTagged18b > untaggedCapacity18b) { unitsTagged18b = untaggedCapacity18b; }
                                if (unitsTagged18b > 0) { positions3[j2].haircutUnits18 = currentTagged18b + unitsTagged18b; }
                            }
                            userSocializedLoss[u2] += addl;
                            remaining -= addl;
                            allocated += addl;
                            emit HaircutApplied(u2, marketId, addl, userCollateral[u2]);
                        }
                        break;
                    }
                }
            }
        }
        if (remaining > 0) {
            marketBadDebt[marketId] += remaining;
            emit BadDebtRecorded(marketId, remaining, liquidatedUser);
            emit SocializationFailed(marketId, remaining, "Insufficient winner capacity for haircut", liquidatedUser);
        }
        if (adlDebug) { emit SocializationCompleted(marketId, allocated, remaining, n, liquidatedUser); }
        emit SocializedLossApplied(marketId, allocated, liquidatedUser);
    }

    function _getUsersWithPositionsInMarket(bytes32 marketId) internal view returns (address[] memory) {
        address[] memory tempUsers = new address[](allKnownUsers.length);
        uint256 count = 0;
        for (uint256 i = 0; i < allKnownUsers.length; i++) {
            address user = allKnownUsers[i];
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    tempUsers[count] = user;
                    count++;
                    break;
                }
            }
        }
        address[] memory usersWithPositions = new address[](count);
        for (uint256 k = 0; k < count; k++) { usersWithPositions[k] = tempUsers[k]; }
        return usersWithPositions;
    }

    function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory) {
        return _getUsersWithPositionsInMarket(marketId);
    }

    function _findProfitablePositions(
        bytes32 marketId, 
        address excludeUser
    ) internal returns (ProfitablePosition[] memory) {
        address[] memory usersWithPositions = _getUsersWithPositionsInMarket(marketId);
        uint256 markPrice = getMarkPrice(marketId);
        uint256 profitableCount = 0;
        for (uint256 i = 0; i < usersWithPositions.length; i++) {
            address user = usersWithPositions[i];
            if (user == excludeUser) continue;
            PositionManager.Position[] storage positions = userPositions[user];
            for (uint256 j = 0; j < positions.length; j++) {
                if (positions[j].marketId == marketId && positions[j].size != 0) {
                    int256 unrealizedPnL = _calculateUnrealizedPnL(positions[j], markPrice);
                    if (unrealizedPnL > 0) { profitableCount++; }
                    break;
                }
            }
        }
        if (profitableCount == 0) { return new ProfitablePosition[](0); }
        uint256 cap = profitableCount > adlMaxCandidates ? adlMaxCandidates : profitableCount;
        ProfitablePosition[] memory profitablePositions = new ProfitablePosition[](cap);
        uint256 index = 0;
        for (uint256 i2 = 0; i2 < usersWithPositions.length; i2++) {
            address user2 = usersWithPositions[i2];
            if (user2 == excludeUser) continue;
            PositionManager.Position[] storage positions2b = userPositions[user2];
            for (uint256 j2 = 0; j2 < positions2b.length; j2++) {
                if (positions2b[j2].marketId == marketId && positions2b[j2].size != 0) {
                    PositionManager.Position storage pos = positions2b[j2];
                    int256 unrealizedPnL2 = _calculateUnrealizedPnL(pos, markPrice);
                    if (unrealizedPnL2 > 0) {
                        uint256 absSize = uint256(pos.size >= 0 ? pos.size : -pos.size);
                        uint256 profitScore = uint256(unrealizedPnL2) * absSize / 1e18;
                        profitablePositions[index] = ProfitablePosition({
                            user: user2,
                            positionSize: pos.size,
                            entryPrice: pos.entryPrice,
                            unrealizedPnL: uint256(unrealizedPnL2),
                            profitScore: profitScore,
                            isLong: pos.size > 0
                        });
                        if (adlDebug) {
                            emit ProfitablePositionFound(user2, marketId, pos.size, pos.entryPrice, markPrice, uint256(unrealizedPnL2), profitScore);
                            emit DebugProfitCalculation(user2, marketId, pos.entryPrice, markPrice, pos.size, unrealizedPnL2, profitScore);
                        }
                        index++;
                        if (index == cap) { return profitablePositions; }
                    }
                    break;
                }
            }
        }
        return profitablePositions;
    }

    function _calculateUnrealizedPnL(
        PositionManager.Position storage position,
        uint256 markPrice
    ) internal view returns (int256) {
        if (position.size == 0 || markPrice == 0 || position.entryPrice == 0) { return 0; }
        int256 priceDiff = int256(markPrice) - int256(position.entryPrice);
        return (priceDiff * position.size) / int256(TICK_PRECISION);
    }

    function _sortProfitablePositionsByScore(ProfitablePosition[] memory positions) internal pure {
        if (positions.length <= 1) return;
        for (uint256 i = 1; i < positions.length; i++) {
            ProfitablePosition memory key = positions[i];
            uint256 j = i;
            while (j > 0 && positions[j - 1].profitScore < key.profitScore) {
                positions[j] = positions[j - 1];
                j--;
            }
            positions[j] = key;
        }
    }

    function _selectTopKByProfitScore(
        ProfitablePosition[] memory positions,
        uint256 k
    ) internal pure returns (ProfitablePosition[] memory) {
        if (positions.length <= k) { return positions; }
        uint256 sampleStride = positions.length / (k == 0 ? 1 : k);
        if (sampleStride == 0) sampleStride = 1;
        uint256 approxThreshold = 0;
        for (uint256 i = 0; i < positions.length; i += sampleStride) {
            if (positions[i].profitScore > approxThreshold) { approxThreshold = positions[i].profitScore; }
        }
        ProfitablePosition[] memory result = new ProfitablePosition[](k);
        uint256 count = 0;
        for (uint256 i2 = 0; i2 < positions.length && count < k; i2++) {
            if (positions[i2].profitScore >= approxThreshold) { result[count] = positions[i2]; count++; }
        }
        if (count < k) {
            for (uint256 i3 = 0; i3 < positions.length && count < k; i3++) {
                bool exists = false;
                for (uint256 j = 0; j < count; j++) {
                    if (positions[i3].user == result[j].user && positions[i3].positionSize == result[j].positionSize && positions[i3].entryPrice == result[j].entryPrice) { exists = true; break; }
                }
                if (!exists) { result[count] = positions[i3]; count++; }
            }
        }
        return result;
    }

    function _computeEffectiveMMRMetrics(
        address /*user*/,
        bytes32 marketId,
        int256 positionSize
    ) internal view returns (uint256 mmrBps, uint256 fillRatio1e18, uint256 gapRatio1e18) {
        marketId; positionSize;
        uint256 mmr = baseMmrBps + penaltyMmrBps;
        if (mmr > maxMmrBps) mmr = maxMmrBps;
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
        try IOBPricingFacet(obAddr).getOrderBookDepth(mmrLiquidityDepthLevels) returns (
            uint256[] memory /*bidPrices*/,
            uint256[] memory bidAmounts,
            uint256[] memory /*askPrices*/,
            uint256[] memory askAmounts
        ) {
            uint256 sumBids;
            for (uint256 i = 0; i < bidAmounts.length; i++) { sumBids += bidAmounts[i]; }
            uint256 sumAsks;
            for (uint256 j = 0; j < askAmounts.length; j++) { sumAsks += askAmounts[j]; }
            liquidity18 = sumBids > sumAsks ? sumBids : sumAsks;
            return liquidity18;
        } catch { return 0; }
    }

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

    function getAvailableCollateral(address user) public view returns (uint256) {
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        uint256 baseAvailable = VaultAnalytics.getAvailableCollateral(userCollateral[user], positions);
        int256 realizedPnL18 = userRealizedPnL[user];
        if (userPositions[user].length == 0 && realizedPnL18 < 0) { realizedPnL18 = 0; }
        int256 realizedPnL6 = realizedPnL18 / int256(DECIMAL_SCALE);
        int256 baseWithRealized = int256(baseAvailable) + realizedPnL6;
        uint256 availableWithRealized = baseWithRealized > 0 ? uint256(baseWithRealized) : 0;
        if (availableWithRealized > 0) {
            uint256 outstandingHaircut6 = 0;
            for (uint256 i2 = 0; i2 < userPositions[user].length; i2++) {
                outstandingHaircut6 += userPositions[user][i2].socializedLossAccrued6;
            }
            if (outstandingHaircut6 > 0) {
                availableWithRealized = availableWithRealized > outstandingHaircut6 ? (availableWithRealized - outstandingHaircut6) : 0;
            }
        }
        return availableWithRealized;
    }

    function _removeMarketIdFromUser(address user, bytes32 marketId) internal {
        bytes32[] storage marketIds = userMarketIds[user];
        for (uint256 j = 0; j < marketIds.length; j++) {
            if (marketIds[j] == marketId) {
                if (j < marketIds.length - 1) { marketIds[j] = marketIds[marketIds.length - 1]; }
                marketIds.pop();
                break;
            }
        }
    }
}


