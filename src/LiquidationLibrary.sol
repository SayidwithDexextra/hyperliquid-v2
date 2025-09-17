// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LiquidationLibrary
 * @dev Library for handling complete liquidation logic
 * @notice Extracted from CentralizedVault to reduce contract size
 */
library LiquidationLibrary {
    
    // ============ Constants ============
    uint256 public constant DECIMAL_SCALE = 1e12;  // Scale for ALU (18 decimals) to USDC (6 decimals)
    uint256 public constant TICK_PRECISION = 1e6;   // Price precision (6 decimals)
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500; // 5% penalty

    // ============ Events ============
    event AvailableCollateralUsed(address indexed user, bytes32 indexed marketId, uint256 amountUsed, uint256 remainingCollateral);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 amount, address indexed user);
    event LiquidationBreakdown(address indexed user, bytes32 indexed marketId, uint256 expectedLoss, uint256 coveredFromMargin, uint256 coveredFromAvailable, uint256 socializedAmount, uint256 liquidationPrice);
    event EnhancedSocializedLoss(bytes32 indexed marketId, uint256 socializedAmount, address indexed user, uint256 preLiquidationCollateral, uint256 coverageRatio);
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 oldPrice, uint256 newPrice);

    // ============ Structs ============
    struct LossCoverageResult {
        uint256 totalUserLoss;
        uint256 socializedLoss;
        uint256 marginUsed;
        uint256 availableCollateralUsed;
    }

    struct Position {
        bytes32 marketId;
        int256 size;
        uint256 entryPrice;
        uint256 marginLocked;
    }

    struct LiquidatedPosition {
        bytes32 marketId;
        int256 size;
        uint256 entryPrice;
        uint256 liquidationPrice;
        uint256 marginLocked;
        uint256 marginLost;
        uint256 timestamp;
        address liquidator;
    }

    struct LiquidationResult {
        bool found;
        uint256 positionIndex;
        int256 oldSize;
        uint256 entryPrice;
        uint256 markPrice;
        uint256 locked;
        uint256 tradingLoss;
        uint256 penalty;
        uint256 totalExpectedLoss;
        LossCoverageResult coverage;
        uint256 liquidatorReward;
        uint256 coverageRatio;
        LiquidatedPosition liquidationRecord;
    }

    /**
     * @dev Calculate three-tier loss coverage for liquidation
     * @param expectedLoss Total expected loss from liquidation
     * @param lockedMarginForPosition Margin locked for this specific position
     * @param currentAvailableCollateral User's available collateral
     * @return result LossCoverageResult struct with breakdown
     */
    function calculateLossCoverage(
        uint256 expectedLoss,
        uint256 lockedMarginForPosition,
        uint256 currentAvailableCollateral
    )
        external
        pure
        returns (LossCoverageResult memory result)
    {
        result.totalUserLoss = 0;
        result.socializedLoss = 0;
        result.marginUsed = 0;
        result.availableCollateralUsed = 0;
        
        uint256 remainingLoss = expectedLoss;

        // Tier 1: Use locked margin for the position
        if (remainingLoss > lockedMarginForPosition) {
            result.marginUsed = lockedMarginForPosition;
            remainingLoss -= lockedMarginForPosition;
        } else {
            result.marginUsed = remainingLoss;
            remainingLoss = 0;
        }
        result.totalUserLoss += result.marginUsed;

        // Tier 2: Use available collateral (plus the margin that will be released from this position)
        if (remainingLoss > 0) {
            uint256 totalAvailable = currentAvailableCollateral + lockedMarginForPosition;
            uint256 availableToUse = totalAvailable > result.marginUsed ? totalAvailable - result.marginUsed : 0;
            
            if (availableToUse > 0) {
                if (remainingLoss > availableToUse) {
                    result.availableCollateralUsed = availableToUse;
                    remainingLoss -= availableToUse;
                } else {
                    result.availableCollateralUsed = remainingLoss;
                    remainingLoss = 0;
                }
                result.totalUserLoss += result.availableCollateralUsed;
            }
        }

        // Tier 3: Socialize remaining loss
        if (remainingLoss > 0) {
            result.socializedLoss = remainingLoss;
        }
    }

    /**
     * @dev Calculate trading loss for a position
     * @param entryPrice Entry price of the position
     * @param currentPrice Current mark price
     * @param positionSize Position size (negative for short)
     * @return tradingLoss Loss amount in USDC (6 decimals)
     */
    function calculateTradingLoss(
        uint256 entryPrice,
        uint256 currentPrice, 
        int256 positionSize
    )
        external
        pure
        returns (uint256 tradingLoss)
    {
        if (positionSize == 0) return 0;
        
        if (positionSize < 0) {
            // Short position: loss when price goes up
            if (currentPrice > entryPrice) {
                uint256 lossPerUnit = currentPrice - entryPrice;
                tradingLoss = (lossPerUnit * uint256(-positionSize)) / (DECIMAL_SCALE * TICK_PRECISION);
            }
        } else {
            // Long position: loss when price goes down  
            if (entryPrice > currentPrice) {
                uint256 lossPerUnit = entryPrice - currentPrice;
                tradingLoss = (lossPerUnit * uint256(positionSize)) / (DECIMAL_SCALE * TICK_PRECISION);
            }
        }
    }

    /**
     * @dev Calculate liquidation penalty
     * @param marginLocked Margin locked for the position
     * @return penalty Penalty amount in USDC (6 decimals)
     */
    function calculateLiquidationPenalty(uint256 marginLocked)
        external
        pure
        returns (uint256 penalty)
    {
        penalty = (marginLocked * LIQUIDATION_PENALTY_BPS) / 10000;
    }

    /**
     * @dev Get user's liquidation protection level
     * @param totalMargin Total margin used by user
     * @param availableCollateral Available collateral
     * @return protectionRatio Protection ratio (0-10000 = 0%-100%)
     */
    function getUserProtectionLevel(uint256 totalMargin, uint256 availableCollateral) 
        external
        pure
        returns (uint256 protectionRatio) 
    {
        if (totalMargin == 0) return 10000; // 100% protection if no positions
        
        uint256 totalCoverage = totalMargin + availableCollateral;
        
        // Return ratio of total coverage to position margin (capped at 100%)
        protectionRatio = totalCoverage * 10000 / totalMargin;
        if (protectionRatio > 10000) {
            protectionRatio = 10000; // Cap at 100%
        }
    }

    /**
     * @dev Execute short liquidation logic (all calculations)
     * @param user User address
     * @param marketId Market identifier
     * @param liquidator Liquidator address
     * @param markPrice Current mark price
     * @param availableCollateral User's available collateral
     * @param positions Array of user positions
     * @param marginForMarket User's margin for this specific market
     * @return result LiquidationResult with all calculated values
     */
    function executeShortLiquidation(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 markPrice,
        uint256 availableCollateral,
        Position[] memory positions,
        uint256 marginForMarket
    ) 
        external 
        view
        returns (LiquidationResult memory result)
    {
        result.found = false;
        
        // Find short position (negative size)
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size < 0) {
                result.found = true;
                result.positionIndex = i;
                result.oldSize = positions[i].size;
                result.entryPrice = positions[i].entryPrice;
                result.markPrice = markPrice;
                result.locked = marginForMarket;
                
                // Calculate trading loss for short: loss when price goes up
                result.tradingLoss = 0;
                if (markPrice > result.entryPrice) {
                    uint256 lossPerUnit = markPrice - result.entryPrice;
                    result.tradingLoss = (lossPerUnit * uint256(-result.oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                
                // Apply liquidation penalty
                result.penalty = (result.locked * LIQUIDATION_PENALTY_BPS) / 10000;
                result.totalExpectedLoss = result.tradingLoss + result.penalty;
                
                // Calculate three-tier loss coverage (inlined)
                result.coverage.totalUserLoss = 0;
                result.coverage.socializedLoss = 0;
                result.coverage.marginUsed = 0;
                result.coverage.availableCollateralUsed = 0;
                
                uint256 remainingLoss = result.totalExpectedLoss;
                
                // Tier 1: Use locked margin
                if (remainingLoss > result.locked) {
                    result.coverage.marginUsed = result.locked;
                    remainingLoss -= result.locked;
                } else {
                    result.coverage.marginUsed = remainingLoss;
                    remainingLoss = 0;
                }
                result.coverage.totalUserLoss += result.coverage.marginUsed;
                
                // Tier 2: Use available collateral
                if (remainingLoss > 0) {
                    uint256 totalAvailable = availableCollateral + result.locked;
                    uint256 availableToUse = totalAvailable > result.coverage.marginUsed ? 
                        totalAvailable - result.coverage.marginUsed : 0;
                    
                    if (availableToUse > 0) {
                        if (remainingLoss > availableToUse) {
                            result.coverage.availableCollateralUsed = availableToUse;
                            remainingLoss -= availableToUse;
                        } else {
                            result.coverage.availableCollateralUsed = remainingLoss;
                            remainingLoss = 0;
                        }
                        result.coverage.totalUserLoss += result.coverage.availableCollateralUsed;
                    }
                }
                
                // Tier 3: Socialize remaining loss
                if (remainingLoss > 0) {
                    result.coverage.socializedLoss = remainingLoss;
                }
                
                // Calculate liquidator reward (penalty portion, up to total user loss)
                result.liquidatorReward = result.penalty > result.coverage.totalUserLoss ? 
                    result.coverage.totalUserLoss : result.penalty;
                
                // Calculate coverage ratio for analytics
                result.coverageRatio = result.totalExpectedLoss > 0 ? 
                    (result.coverage.totalUserLoss * 10000) / result.totalExpectedLoss : 10000;
                
                // Create liquidation record
                result.liquidationRecord = LiquidatedPosition({
                    marketId: marketId,
                    size: result.oldSize,
                    entryPrice: result.entryPrice,
                    liquidationPrice: markPrice,
                    marginLocked: result.locked,
                    marginLost: result.coverage.totalUserLoss,
                    timestamp: block.timestamp,
                    liquidator: liquidator
                });
                
                break;
            }
        }
    }

    /**
     * @dev Execute long liquidation logic (all calculations)
     * @param user User address
     * @param marketId Market identifier
     * @param liquidator Liquidator address
     * @param markPrice Current mark price
     * @param availableCollateral User's available collateral
     * @param positions Array of user positions
     * @param marginForMarket User's margin for this specific market
     * @return result LiquidationResult with all calculated values
     */
    function executeLongLiquidation(
        address user,
        bytes32 marketId,
        address liquidator,
        uint256 markPrice,
        uint256 availableCollateral,
        Position[] memory positions,
        uint256 marginForMarket
    ) 
        external 
        view
        returns (LiquidationResult memory result)
    {
        result.found = false;
        
        // Find long position (positive size)
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size > 0) {
                result.found = true;
                result.positionIndex = i;
                result.oldSize = positions[i].size;
                result.entryPrice = positions[i].entryPrice;
                result.markPrice = markPrice;
                result.locked = marginForMarket;
                
                // Calculate trading loss for long: loss when price goes down
                result.tradingLoss = 0;
                if (result.entryPrice > markPrice) {
                    uint256 lossPerUnit = result.entryPrice - markPrice;
                    result.tradingLoss = (lossPerUnit * uint256(result.oldSize)) / (DECIMAL_SCALE * TICK_PRECISION);
                }
                
                // Apply liquidation penalty
                result.penalty = (result.locked * LIQUIDATION_PENALTY_BPS) / 10000;
                result.totalExpectedLoss = result.tradingLoss + result.penalty;
                
                // Calculate three-tier loss coverage (inlined)
                result.coverage.totalUserLoss = 0;
                result.coverage.socializedLoss = 0;
                result.coverage.marginUsed = 0;
                result.coverage.availableCollateralUsed = 0;
                
                uint256 remainingLoss = result.totalExpectedLoss;
                
                // Tier 1: Use locked margin
                if (remainingLoss > result.locked) {
                    result.coverage.marginUsed = result.locked;
                    remainingLoss -= result.locked;
                } else {
                    result.coverage.marginUsed = remainingLoss;
                    remainingLoss = 0;
                }
                result.coverage.totalUserLoss += result.coverage.marginUsed;
                
                // Tier 2: Use available collateral
                if (remainingLoss > 0) {
                    uint256 totalAvailable = availableCollateral + result.locked;
                    uint256 availableToUse = totalAvailable > result.coverage.marginUsed ? 
                        totalAvailable - result.coverage.marginUsed : 0;
                    
                    if (availableToUse > 0) {
                        if (remainingLoss > availableToUse) {
                            result.coverage.availableCollateralUsed = availableToUse;
                            remainingLoss -= availableToUse;
                        } else {
                            result.coverage.availableCollateralUsed = remainingLoss;
                            remainingLoss = 0;
                        }
                        result.coverage.totalUserLoss += result.coverage.availableCollateralUsed;
                    }
                }
                
                // Tier 3: Socialize remaining loss
                if (remainingLoss > 0) {
                    result.coverage.socializedLoss = remainingLoss;
                }
                
                // Calculate liquidator reward (penalty portion, up to total user loss)
                result.liquidatorReward = result.penalty > result.coverage.totalUserLoss ? 
                    result.coverage.totalUserLoss : result.penalty;
                
                // Calculate coverage ratio for analytics
                result.coverageRatio = result.totalExpectedLoss > 0 ? 
                    (result.coverage.totalUserLoss * 10000) / result.totalExpectedLoss : 10000;
                
                // Create liquidation record
                result.liquidationRecord = LiquidatedPosition({
                    marketId: marketId,
                    size: result.oldSize,
                    entryPrice: result.entryPrice,
                    liquidationPrice: markPrice,
                    marginLocked: result.locked,
                    marginLost: result.coverage.totalUserLoss,
                    timestamp: block.timestamp,
                    liquidator: liquidator
                });
                
                break;
            }
        }
    }
}
