// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LiquidationLibrary.sol";
import "./VaultAnalytics.sol";

// Interface for CoreVault
interface ICoreVault {
    function userCollateral(address user) external view returns (uint256);
    function userPositions(address user, uint256 index) external view returns (bytes32 marketId, int256 size, uint256 entryPrice, uint256 marginLocked);
    function userMarginByMarket(address user, bytes32 marketId) external view returns (uint256);
    function getAvailableCollateral(address user) external view returns (uint256);
    function getMarkPrice(bytes32 marketId) external view returns (uint256);
    function getUserPositionCount(address user) external view returns (uint256);
    function marketToOrderBook(bytes32 marketId) external view returns (address);
    function updateUserCollateral(address user, uint256 newCollateral) external;
    function updateUserMargin(address user, bytes32 marketId, uint256 newMargin) external;
    function clearUserPosition(address user, bytes32 marketId) external;
}

// Interface for OrderBook
interface IOrderBook {
    function clearUserPosition(address user) external;
}

/**
 * @title LiquidationHandler
 * @dev Dedicated liquidation contract - handles all liquidation logic
 * @notice Separated from CoreVault to reduce contract sizes
 */
contract LiquidationHandler is AccessControl, ReentrancyGuard {
    
    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");

    // ============ State Variables ============
    ICoreVault public immutable coreVault;
    
    // Liquidation history
    mapping(address => LiquidationLibrary.LiquidatedPosition[]) public userLiquidatedPositions;

    // ============ Events ============
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event AvailableCollateralUsed(address indexed user, bytes32 indexed marketId, uint256 amountUsed, uint256 remainingCollateral);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 amount, address indexed user);
    event LiquidationBreakdown(address indexed user, bytes32 indexed marketId, uint256 expectedLoss, uint256 coveredFromMargin, uint256 coveredFromAvailable, uint256 socializedAmount, uint256 liquidationPrice);
    event EnhancedSocializedLoss(bytes32 indexed marketId, uint256 socializedAmount, address indexed user, uint256 preLiquidationCollateral, uint256 coverageRatio);

    // ============ Constructor ============
    constructor(address _coreVault, address _admin) {
        coreVault = ICoreVault(_coreVault);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Liquidation Functions ============
    
    /**
     * @dev Liquidate short position using library
     */
    function liquidateShort(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        require(user != liquidator, "!self");
        
        // Get user positions from CoreVault
        uint256 positionCount = coreVault.getUserPositionCount(user);
        LiquidationLibrary.Position[] memory positions = new LiquidationLibrary.Position[](positionCount);
        
        for (uint256 i = 0; i < positionCount; i++) {
            (bytes32 pMarketId, int256 size, uint256 entryPrice, uint256 marginLocked) = coreVault.userPositions(user, i);
            positions[i] = LiquidationLibrary.Position({
                marketId: pMarketId,
                size: size,
                entryPrice: entryPrice,
                marginLocked: marginLocked
            });
        }
        
        // Execute liquidation logic in library
        LiquidationLibrary.LiquidationResult memory result = LiquidationLibrary.executeShortLiquidation(
            user,
            marketId,
            liquidator,
            coreVault.getMarkPrice(marketId),
            coreVault.getAvailableCollateral(user),
            positions,
            coreVault.userMarginByMarket(user, marketId)
        );
        
        require(result.found, "!short");
        
        // Apply liquidation result
        _applyLiquidationResult(user, marketId, liquidator, result);
    }

    /**
     * @dev Liquidate long position using library
     */
    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        require(user != liquidator, "!self");
        
        // Get user positions from CoreVault
        uint256 positionCount = coreVault.getUserPositionCount(user);
        LiquidationLibrary.Position[] memory positions = new LiquidationLibrary.Position[](positionCount);
        
        for (uint256 i = 0; i < positionCount; i++) {
            (bytes32 pMarketId, int256 size, uint256 entryPrice, uint256 marginLocked) = coreVault.userPositions(user, i);
            positions[i] = LiquidationLibrary.Position({
                marketId: pMarketId,
                size: size,
                entryPrice: entryPrice,
                marginLocked: marginLocked
            });
        }
        
        // Execute liquidation logic in library
        LiquidationLibrary.LiquidationResult memory result = LiquidationLibrary.executeLongLiquidation(
            user,
            marketId,
            liquidator,
            coreVault.getMarkPrice(marketId),
            coreVault.getAvailableCollateral(user),
            positions,
            coreVault.userMarginByMarket(user, marketId)
        );
        
        require(result.found, "!long");
        
        // Apply liquidation result
        _applyLiquidationResult(user, marketId, liquidator, result);
    }

    /**
     * @dev Apply liquidation results (internal)
     */
    function _applyLiquidationResult(
        address user,
        bytes32 marketId,
        address liquidator,
        LiquidationLibrary.LiquidationResult memory result
    ) internal {
        // Store liquidation history
        userLiquidatedPositions[user].push(result.liquidationRecord);
        
        // Emit comprehensive events
        emit LiquidationBreakdown(
            user,
            marketId,
            result.totalExpectedLoss,
            result.coverage.marginUsed,
            result.coverage.availableCollateralUsed,
            result.coverage.socializedLoss,
            result.markPrice
        );
        
        if (result.coverage.availableCollateralUsed > 0) {
            emit AvailableCollateralUsed(
                user,
                marketId,
                result.coverage.availableCollateralUsed,
                coreVault.userCollateral(user) - result.coverage.totalUserLoss
            );
        }
        
        if (result.coverage.socializedLoss > 0) {
            emit EnhancedSocializedLoss(
                marketId,
                result.coverage.socializedLoss,
                user,
                coreVault.userCollateral(user) + result.coverage.totalUserLoss,
                result.coverageRatio
            );
            
            emit SocializedLossApplied(marketId, result.coverage.socializedLoss, user);
        }
        
        // Clear position in OrderBook
        address orderBookAddr = coreVault.marketToOrderBook(marketId);
        if (orderBookAddr != address(0)) {
            try IOrderBook(orderBookAddr).clearUserPosition(user) {
                // Position cleared successfully
            } catch {
                // Failed to clear - continue (don't revert liquidation)
            }
        }
        
        emit LiquidationExecuted(user, marketId, liquidator, result.coverage.totalUserLoss, coreVault.userCollateral(user));
    }

    // ============ Liquidation History View Functions ============
    
    function getUserLiquidatedPositions(address user) 
        external 
        view 
        returns (LiquidationLibrary.LiquidatedPosition[] memory) 
    {
        return userLiquidatedPositions[user];
    }

    function getUserLiquidatedPositionsCount(address user) 
        external 
        view 
        returns (uint256) 
    {
        return userLiquidatedPositions[user].length;
    }

    function getUserLiquidatedPosition(address user, uint256 index) 
        external 
        view 
        returns (LiquidationLibrary.LiquidatedPosition memory) 
    {
        require(index < userLiquidatedPositions[user].length, "!index");
        return userLiquidatedPositions[user][index];
    }

    // ============ Liquidation Analytics ============
    
    function isPositionLiquidatable(
        address user,
        bytes32 marketId,
        uint256 markPrice
    ) external view returns (bool liquidatable, uint256 healthRatio) {
        // Get position details
        uint256 marginLocked = coreVault.userMarginByMarket(user, marketId);
        if (marginLocked == 0) return (false, 10000); // No position
        
        // Get user positions to find the specific one
        uint256 positionCount = coreVault.getUserPositionCount(user);
        for (uint256 i = 0; i < positionCount; i++) {
            (bytes32 pMarketId, int256 size, uint256 entryPrice,) = coreVault.userPositions(user, i);
            
            if (pMarketId == marketId && size != 0) {
                // Calculate P&L
                int256 unrealizedPnL = VaultAnalytics.calculatePositionPnL(size, entryPrice, markPrice);
                
                // Calculate effective margin (margin - losses)
                int256 effectiveMargin = int256(marginLocked) + unrealizedPnL;
                
                // Check if liquidation threshold reached (assume 10% maintenance margin)
                uint256 maintenanceMargin = marginLocked / 10; // 10% of initial margin
                
                if (effectiveMargin <= int256(maintenanceMargin)) {
                    liquidatable = true;
                    healthRatio = effectiveMargin > 0 ? (uint256(effectiveMargin) * 10000) / marginLocked : 0;
                } else {
                    liquidatable = false;
                    healthRatio = (uint256(effectiveMargin) * 10000) / marginLocked;
                }
                
                return (liquidatable, healthRatio);
            }
        }
        
        return (false, 10000); // Position not found
    }

    /**
     * @dev Get user's protection level using library
     */
    function getUserProtectionLevel(address user) external view returns (uint256 protectionRatio) {
        uint256 totalMargin = 0;
        uint256 positionCount = coreVault.getUserPositionCount(user);
        
        for (uint256 i = 0; i < positionCount; i++) {
            (,,,uint256 marginLocked) = coreVault.userPositions(user, i);
            totalMargin += marginLocked;
        }
        
        uint256 availableCollateral = coreVault.getAvailableCollateral(user);
        
        return VaultAnalytics.getUserProtectionLevel(totalMargin, availableCollateral);
    }
}
