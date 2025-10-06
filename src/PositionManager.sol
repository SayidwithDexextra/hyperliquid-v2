// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PositionManager
 * @dev Position management library - ALL position logic extracted from CentralizedVault
 * @notice Major bytecode reduction by moving position operations to library
 */
library PositionManager {
    
    // ============ Constants ============
    uint256 public constant TICK_PRECISION = 1e6;
    uint256 public constant DECIMAL_SCALE = 1e12;
    
    // ============ Events ============
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 oldPrice, uint256 newPrice);
    event MarginAdjusted(address indexed user, bytes32 indexed marketId, uint256 oldMargin, uint256 newMargin, string reason);
    event PositionNettingExecuted(address indexed user, bytes32 indexed marketId, int256 sizeDelta, uint256 executionPrice, int256 realizedPnL);

    // ============ Structs ============
    struct Position {
        bytes32 marketId;
        int256 size;
        uint256 entryPrice;
        uint256 marginLocked;
        uint256 socializedLossAccrued6; // USDC (6 decimals) haircut accrued against this position's payout
        uint256 haircutUnits18; // Units (18 decimals) tagged at socialization time
        uint256 liquidationPrice; // Fixed trigger price (6 decimals)
    }

    struct NettingResult {
        bool positionExists;
        int256 oldSize;
        int256 newSize;
        uint256 oldEntryPrice;
        uint256 newEntryPrice;
        uint256 oldMargin;
        uint256 newMargin;
        int256 realizedPnL;
        uint256 marginToRelease;
        uint256 marginToLock;
        bool positionClosed;
        uint256 haircutToConfiscate6; // Portion of position-level haircut realized by this trade (USDC 6d)
    }

    /**
     * @dev Execute position netting with detailed calculations
     */
    function executePositionNetting(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        uint256 requiredMargin
    ) external returns (NettingResult memory result) {
        // Find existing position
        uint256 positionIndex;
        bool found = false;
        
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                positionIndex = i;
                found = true;
                break;
            }
        }
        
        result.positionExists = found;
        
        if (found) {
            Position storage position = positions[positionIndex];
            result.oldSize = position.size;
            result.oldEntryPrice = position.entryPrice;
            result.oldMargin = position.marginLocked;
            uint256 oldHaircut6 = position.socializedLossAccrued6;
            uint256 oldHaircutUnits18 = position.haircutUnits18;
            
            // Calculate new position
            result.newSize = position.size + sizeDelta;

            // Calculate realized P&L ONLY for the portion that actually closes
            if ((position.size > 0 && sizeDelta < 0) || (position.size < 0 && sizeDelta > 0)) {
                // Closing direction: compute closed quantity as min(|delta|, |position|)
                uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                uint256 closedAbs = absDelta > posAbs ? posAbs : absDelta;

                // Closing size SIGNED the same as the original position (not the trade delta)
                int256 closingSizeSigned = position.size > 0 ? int256(closedAbs) : -int256(closedAbs);

                // Standard P&L calculation in 18 decimals: (P_exec - P_entry) * Q / TICK_PRECISION
                int256 priceDiff = int256(executionPrice) - int256(position.entryPrice);
                result.realizedPnL = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
            }

            // Calculate new entry price
            if (result.newSize == 0) {
                result.newEntryPrice = 0;
                result.positionClosed = true;
                result.marginToRelease = position.marginLocked;
                // Entire haircut for this position is realized now
                result.haircutToConfiscate6 = oldHaircut6;
                
                // Remove position
                if (positionIndex < positions.length - 1) {
                    positions[positionIndex] = positions[positions.length - 1];
                }
                positions.pop();
                
            } else {
                // Position continues - determine correct entry price behavior
                bool sameDirection = (position.size > 0 && sizeDelta > 0) || (position.size < 0 && sizeDelta < 0);

                if (sameDirection) {
                    // CRITICAL OVERFLOW FIX: Use fixed precision arithmetic with extreme scaling
                    unchecked {
                        // Get absolute sizes
                        uint256 existingSize = uint256(position.size >= 0 ? position.size : -position.size);
                        uint256 newSize = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta);
                        
                        // Scale down to whole units (from 18 decimals to 0)
                        uint256 wholeExistingSize = existingSize / 1e18;
                        uint256 wholeNewSize = newSize / 1e18;
                        
                        // Ensure minimum values for tiny amounts
                        if (wholeExistingSize == 0) wholeExistingSize = 1;
                        if (wholeNewSize == 0) wholeNewSize = 1;
                        
                        // Calculate weighted average price (cannot overflow)
                        uint256 existingNotional = wholeExistingSize * position.entryPrice;
                        uint256 newNotional = wholeNewSize * executionPrice;
                        uint256 totalNotional = existingNotional + newNotional;
                        uint256 totalSize = wholeExistingSize + wholeNewSize;
                        
                        // Calculate new entry price
                        result.newEntryPrice = totalSize > 0 ? (totalNotional / totalSize) : position.entryPrice;
                    }
                } else {
                    // Opposite direction: either partial close or flip
                    uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                    uint256 posAbs = uint256(position.size > 0 ? position.size : -position.size);
                    if (absDelta < posAbs) {
                    // Partial close only: keep original entry price for the remaining position
                    result.newEntryPrice = position.entryPrice;
                    // Realize haircut only on the originally socialized units, not on newly added units
                    uint256 unitsToRelease18 = oldHaircutUnits18 == 0 ? 0 : (absDelta > oldHaircutUnits18 ? oldHaircutUnits18 : absDelta);
                    uint256 haircutClosed6 = (oldHaircut6 == 0 || oldHaircutUnits18 == 0) ? 0 : (oldHaircut6 * unitsToRelease18) / oldHaircutUnits18;
                    if (haircutClosed6 > 0) {
                        if (haircutClosed6 > position.socializedLossAccrued6) {
                            haircutClosed6 = position.socializedLossAccrued6;
                        }
                        position.socializedLossAccrued6 = position.socializedLossAccrued6 - haircutClosed6;
                        // Reduce the tagged units by the portion actually closed
                        if (unitsToRelease18 > 0) {
                            position.haircutUnits18 = position.haircutUnits18 - unitsToRelease18;
                        }
                        result.haircutToConfiscate6 = haircutClosed6;
                    }
                    } else {
                        // Flip: entire old position closed and new opened at execution price
                        result.newEntryPrice = executionPrice;
                        // Entire haircut is realized due to full close of old leg
                        result.haircutToConfiscate6 = oldHaircut6;
                        // Reset haircut on the new leg (implicitly zero since entry below)
                    }
                }
                
                // Update position
                position.size = result.newSize;
                position.entryPrice = result.newEntryPrice;
                
                // Standard margin update: do not bind to haircut floor; haircut is realized from payouts
                uint256 oldMarginLocal = position.marginLocked;
                if (requiredMargin > oldMarginLocal) {
                    result.marginToLock = requiredMargin - oldMarginLocal;
                    result.marginToRelease = 0;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else if (requiredMargin < oldMarginLocal) {
                    result.marginToLock = 0;
                    result.marginToRelease = oldMarginLocal - requiredMargin;
                    position.marginLocked = requiredMargin;
                    result.newMargin = requiredMargin;
                } else {
                    result.marginToLock = 0;
                    result.marginToRelease = 0;
                    result.newMargin = oldMarginLocal;
                }
            }
            
        } else {
            // New position
            result.newSize = sizeDelta;
            result.newEntryPrice = executionPrice;
            result.newMargin = requiredMargin;
            result.marginToLock = requiredMargin;
            
            positions.push(Position({
                marketId: marketId,
                size: sizeDelta,
                entryPrice: executionPrice,
                marginLocked: requiredMargin,
                socializedLossAccrued6: 0,
                haircutUnits18: 0,
                liquidationPrice: 0
            }));
        }
        
        // Note: Margin is now tracked exclusively in Position struct
        // No separate marginByMarket mapping needed - single source of truth
    }

    /**
     * @dev Recalculate position margin based on new requirements
     */
    function recalculatePositionMargin(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        uint256 newRequiredMargin
    ) external returns (uint256 oldMargin, uint256 marginDelta, bool isIncrease) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                Position storage position = positions[i];
                oldMargin = position.marginLocked;
                
                if (newRequiredMargin > oldMargin) {
                    marginDelta = newRequiredMargin - oldMargin;
                    isIncrease = true;
                } else {
                    marginDelta = oldMargin - newRequiredMargin;
                    isIncrease = false;
                }
                
                position.marginLocked = newRequiredMargin;
                // Margin now tracked exclusively in Position struct
                
                return (oldMargin, marginDelta, isIncrease);
            }
        }
        
        revert("Position not found");
    }

    /**
     * @dev Update position entry price and size
     */
    function updatePosition(
        Position[] storage positions,
        address /*user*/,
        bytes32 marketId,
        int256 newSize,
        uint256 newEntryPrice,
        uint256 newMargin
    ) external returns (int256 oldSize, uint256 oldEntryPrice) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                Position storage position = positions[i];
                oldSize = position.size;
                oldEntryPrice = position.entryPrice;
                
                if (newSize == 0) {
                    // Close position
                    if (i < positions.length - 1) {
                        positions[i] = positions[positions.length - 1];
                    }
                    positions.pop();
                    // Margin tracking removed from position - no separate mapping needed
                } else {
                    // Update position
                    position.size = newSize;
                    position.entryPrice = newEntryPrice;
                    position.marginLocked = newMargin;
                    // Margin now tracked exclusively in Position struct
                }
                
                return (oldSize, oldEntryPrice);
            }
        }
        
        // Create new position if not found
        if (newSize != 0) {
            positions.push(Position({
                marketId: marketId,
                size: newSize,
                entryPrice: newEntryPrice,
                marginLocked: newMargin,
                socializedLossAccrued6: 0,
                haircutUnits18: 0,
                liquidationPrice: 0
            }));
            // Margin now tracked exclusively in Position struct
        }
        
        return (0, 0);
    }

    /**
     * @dev Remove market ID from user's market list
     */
    function removeMarketIdFromUser(
        bytes32[] storage userMarketIds,
        bytes32 marketId
    ) external {
        for (uint256 j = 0; j < userMarketIds.length; j++) {
            if (userMarketIds[j] == marketId) {
                if (j < userMarketIds.length - 1) {
                    userMarketIds[j] = userMarketIds[userMarketIds.length - 1];
                }
                userMarketIds.pop();
                break;
            }
        }
    }

    /**
     * @dev Add market ID to user's market list (if not already present)
     */
    function addMarketIdToUser(
        bytes32[] storage userMarketIds,
        bytes32 marketId
    ) external {
        // Check if market ID already exists
        for (uint256 i = 0; i < userMarketIds.length; i++) {
            if (userMarketIds[i] == marketId) {
                return; // Already exists
            }
        }
        userMarketIds.push(marketId);
    }

    /**
     * @dev Calculate detailed position netting preview
     */
    function calculateDetailedPositionNetting(
        Position memory existingPosition,
        int256 sizeDelta,
        uint256 executionPrice
    ) external pure returns (
        int256 newSize,
        uint256 newEntryPrice,
        uint256 newMarginRequired,
        int256 realizedPnL,
        bool positionWillClose
    ) {
        newSize = existingPosition.size + sizeDelta;
        positionWillClose = (newSize == 0);
        newMarginRequired = 0;
        
        if (positionWillClose) {
            newEntryPrice = 0;
            newMarginRequired = 0;
            
            // Calculate realized P&L for full close using original signed size
            int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
            realizedPnL = (priceDiff * existingPosition.size) / int256(TICK_PRECISION);
        } else {
            // Calculate weighted entry price for same-direction adds, otherwise flip
            bool sameDirection = (existingPosition.size > 0 && sizeDelta > 0) ||
                                 (existingPosition.size < 0 && sizeDelta < 0);

            if (sameDirection && existingPosition.size != 0) {
                // Compute weighted average entry with minimal intermediates
                uint256 existingAbs = uint256(existingPosition.size >= 0 ? existingPosition.size : -existingPosition.size);
                uint256 deltaAbs = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta);
                uint256 totalAbs = uint256(newSize >= 0 ? newSize : -newSize);
                uint256 totalNotional = existingAbs * existingPosition.entryPrice + deltaAbs * executionPrice;
                newEntryPrice = totalNotional / totalAbs;
            } else {
                // Opposite direction: flip price to execution and realize PnL on old size
                newEntryPrice = executionPrice;
                int256 priceDiffFlip = int256(executionPrice) - int256(existingPosition.entryPrice);
                realizedPnL = (priceDiffFlip * existingPosition.size) / int256(TICK_PRECISION);
            }

            // If this trade closes part of the position (opposite direction), realize proportional PnL
            if ((existingPosition.size > 0 && sizeDelta < 0) || (existingPosition.size < 0 && sizeDelta > 0)) {
                uint256 closedAbs;
                {
                    uint256 absDelta = uint256(sizeDelta > 0 ? sizeDelta : -sizeDelta);
                    uint256 posAbs = uint256(existingPosition.size > 0 ? existingPosition.size : -existingPosition.size);
                    closedAbs = absDelta > posAbs ? posAbs : absDelta;
                }
                int256 closingSizeSigned = existingPosition.size > 0 ? int256(closedAbs) : -int256(closedAbs);
                int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
                int256 realizedPartial = (priceDiff * closingSizeSigned) / int256(TICK_PRECISION);
                realizedPnL += realizedPartial;
            }
        }
    }

    /**
     * @dev Get position count for user
     */
    function getPositionCount(Position[] storage positions) external view returns (uint256) {
        return positions.length;
    }

    /**
     * @dev Check if user has position in specific market
     */
    function hasPositionInMarket(
        Position[] storage positions,
        bytes32 marketId
    ) external view returns (bool) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return true;
            }
        }
        return false;
    }
}
