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
    }

    /**
     * @dev Execute position netting with detailed calculations
     */
    function executePositionNetting(
        Position[] storage positions,
        address user,
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
            
            // Calculate new position
            result.newSize = position.size + sizeDelta;
            
            // Calculate realized P&L for closing portion
            if ((position.size > 0 && sizeDelta < 0) || (position.size < 0 && sizeDelta > 0)) {
                int256 closingSize = sizeDelta > 0 ? 
                    (sizeDelta > -position.size ? -position.size : sizeDelta) :
                    (sizeDelta < -position.size ? -position.size : sizeDelta);
                
                int256 priceDiff = int256(executionPrice) - int256(position.entryPrice);
                result.realizedPnL = (priceDiff * closingSize) / int256(TICK_PRECISION);
            }
            
            // Calculate new entry price
            if (result.newSize == 0) {
                result.newEntryPrice = 0;
                result.positionClosed = true;
                result.marginToRelease = position.marginLocked;
                
                // Remove position
                if (positionIndex < positions.length - 1) {
                    positions[positionIndex] = positions[positions.length - 1];
                }
                positions.pop();
                
            } else {
                // Position continues - calculate weighted entry price
                bool sameDirection = (position.size > 0 && sizeDelta > 0) || (position.size < 0 && sizeDelta < 0);
                
                if (sameDirection) {
                    // Weighted average
                    uint256 existingNotional = uint256(position.size >= 0 ? position.size : -position.size) * position.entryPrice;
                    uint256 newNotional = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta) * executionPrice;
                    uint256 totalNotional = existingNotional + newNotional;
                    uint256 totalSize = uint256(result.newSize >= 0 ? result.newSize : -result.newSize);
                    result.newEntryPrice = totalNotional / totalSize;
                } else {
                    result.newEntryPrice = executionPrice;
                }
                
                // Update position
                position.size = result.newSize;
                position.entryPrice = result.newEntryPrice;
                
                // Adjust margin
                if (requiredMargin > position.marginLocked) {
                    result.marginToLock = requiredMargin - position.marginLocked;
                } else {
                    result.marginToRelease = position.marginLocked - requiredMargin;
                }
                
                position.marginLocked = requiredMargin;
                result.newMargin = requiredMargin;
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
                marginLocked: requiredMargin
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
        address user,
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
        address user,
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
                marginLocked: newMargin
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
        
        if (positionWillClose) {
            newEntryPrice = 0;
            newMarginRequired = 0;
            
            // Calculate realized P&L for full close
            int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
            realizedPnL = (priceDiff * existingPosition.size) / int256(TICK_PRECISION);
        } else {
            // Calculate weighted entry price
            bool sameDirection = (existingPosition.size > 0 && sizeDelta > 0) || 
                                (existingPosition.size < 0 && sizeDelta < 0);
            
            if (sameDirection && existingPosition.size != 0) {
                uint256 existingNotional = uint256(existingPosition.size >= 0 ? existingPosition.size : -existingPosition.size) * existingPosition.entryPrice;
                uint256 newNotional = uint256(sizeDelta >= 0 ? sizeDelta : -sizeDelta) * executionPrice;
                uint256 totalNotional = existingNotional + newNotional;
                uint256 totalSize = uint256(newSize >= 0 ? newSize : -newSize);
                newEntryPrice = totalNotional / totalSize;
                
                // Proportional realized P&L for partial close
                if ((existingPosition.size > 0 && sizeDelta < 0) || (existingPosition.size < 0 && sizeDelta > 0)) {
                    int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
                    realizedPnL = (priceDiff * sizeDelta) / int256(TICK_PRECISION);
                }
            } else {
                newEntryPrice = executionPrice;
                
                // Full close of existing + new opposite direction
                int256 priceDiff = int256(executionPrice) - int256(existingPosition.entryPrice);
                realizedPnL = (priceDiff * existingPosition.size) / int256(TICK_PRECISION);
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
