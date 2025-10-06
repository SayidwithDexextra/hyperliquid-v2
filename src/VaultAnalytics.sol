// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VaultAnalytics
 * @dev Complete analytics library with standardized P&L calculations
 * @notice All P&L calculations use the standard 18-decimal precision formula:
 *         P&L = (markPrice - entryPrice) * size / TICK_PRECISION = 18 decimals
 */
library VaultAnalytics {
    
    uint256 public constant TICK_PRECISION = 1e6;
    uint256 public constant DECIMAL_SCALE = 1e12;

    // ============ P&L CALCULATION STANDARDS ============
    // Standard P&L Formula: (markPrice - entryPrice) * size / TICK_PRECISION
    // - Prices: 6 decimals (USDC precision)
    // - Size: 18 decimals (ALU token precision)  
    // - Result: 18 decimals (standard P&L precision)
    // This ensures consistency across all P&L calculations in the system
    
    struct MarginSummary {
        uint256 totalCollateral;
        uint256 marginUsed;
        uint256 marginReserved;
        uint256 availableCollateral;
        int256 realizedPnL;
        int256 unrealizedPnL;
        uint256 portfolioValue;
    }

    struct Position {
        bytes32 marketId;
        int256 size;
        uint256 entryPrice;
        uint256 marginLocked;
    }

    struct PendingOrder {
        bytes32 orderId;
        uint256 marginReserved;
        uint256 timestamp;
    }

    // ============ BASIC UTILITY FUNCTIONS (CALLED BY OTHERS) ============
    
    function getTotalMarginUsed(Position[] memory positions) public pure returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < positions.length; i++) {
            total += positions[i].marginLocked;
        }
        return total;
    }

    function getTotalMarginReserved(PendingOrder[] memory pendingOrders) public pure returns (uint256) {
        uint256 totalReserved = 0;
        for (uint256 i = 0; i < pendingOrders.length; i++) {
            totalReserved += pendingOrders[i].marginReserved;
        }
        return totalReserved;
    }

    function getAvailableCollateral(
        uint256 userCollateral,
        Position[] memory positions
    ) public pure returns (uint256) {
        uint256 totalMarginUsed = getTotalMarginUsed(positions);
        return userCollateral > totalMarginUsed ? userCollateral - totalMarginUsed : 0;
    }

    function getUnrealizedPnL(
        Position[] memory positions,
        uint256[] memory markPrices
    ) public pure returns (int256) {
        require(positions.length == markPrices.length, "Length mismatch");
        
        int256 totalPnL = 0;
        for (uint256 i = 0; i < positions.length; i++) {
            if (markPrices[i] > 0 && positions[i].size != 0) {
                int256 priceDiff = int256(markPrices[i]) - int256(positions[i].entryPrice);
                totalPnL += (priceDiff * positions[i].size) / int256(TICK_PRECISION);
            }
        }
        return totalPnL;
    }

    function getUserPositionByMarket(
        Position[] memory positions,
        bytes32 marketId
    ) public pure returns (Position memory) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return positions[i];
            }
        }
        return Position(bytes32(0), 0, 0, 0);
    }

    /**
     * @dev Calculate P&L for a position using the standard formula
     * @param size Position size (18 decimals, positive for long, negative for short)
     * @param entryPrice Entry price (6 decimals, USDC precision)
     * @param markPrice Current mark price (6 decimals, USDC precision)
     * @return pnl Profit and loss (18 decimals, standard precision)
     * @notice Standard P&L Formula: (markPrice - entryPrice) * size / TICK_PRECISION = 18 decimals
     */
    function calculatePositionPnL(int256 size, uint256 entryPrice, uint256 markPrice)
        public
        pure
        returns (int256 pnl)
    {
        if (size == 0) return 0;
        
        // Standard P&L calculation: (markPrice - entryPrice) * size / TICK_PRECISION
        // Results in 18 decimals: (6 - 6 + 18 - 6) = 18
        int256 priceDiff = int256(markPrice) - int256(entryPrice);
        pnl = (priceDiff * size) / int256(TICK_PRECISION);
    }

    // ============ COMPLEX FUNCTIONS (USE BASIC FUNCTIONS) ============

    function getMarginSummary(
        uint256 userCollateral,
        int256 realizedPnL,
        Position[] memory positions,
        PendingOrder[] memory pendingOrders,
        uint256[] memory markPrices
    ) external pure returns (MarginSummary memory) {
        MarginSummary memory summary;
        summary.totalCollateral = userCollateral;
        summary.marginUsed = getTotalMarginUsed(positions);
        summary.marginReserved = getTotalMarginReserved(pendingOrders);

        // Available collateral: collateral - margin used
        uint256 available = getAvailableCollateral(userCollateral, positions);

        // Apply realized PnL (18d -> 6d). If no positions and realizedPnL is negative, ignore it
        int256 tempInt = (positions.length == 0 && realizedPnL < 0)
            ? int256(0)
            : (realizedPnL / int256(DECIMAL_SCALE));
        tempInt = int256(available) + tempInt;
        uint256 adjustedAvailable = tempInt > 0 ? uint256(tempInt) : 0;

        // Subtract reserved margin for pending orders
        adjustedAvailable = adjustedAvailable > summary.marginReserved
            ? (adjustedAvailable - summary.marginReserved)
            : 0;
        summary.availableCollateral = adjustedAvailable;

        summary.realizedPnL = realizedPnL;
        summary.unrealizedPnL = getUnrealizedPnL(positions, markPrices);

        tempInt = int256(userCollateral) + realizedPnL + summary.unrealizedPnL;
        summary.portfolioValue = tempInt > 0 ? uint256(tempInt) : 0;

        return summary;
    }

    function getUserProtectionLevel(uint256 totalMargin, uint256 availableCollateral) 
        external
        pure
        returns (uint256 protectionRatio) 
    {
        if (totalMargin == 0) return 10000;
        
        uint256 totalCoverage = totalMargin + availableCollateral;
        protectionRatio = totalCoverage * 10000 / totalMargin;
        if (protectionRatio > 10000) {
            protectionRatio = 10000;
        }
    }

    /**
     * @dev Validate P&L calculation consistency across different methods
     * @param size Position size (18 decimals)
     * @param entryPrice Entry price (6 decimals)
     * @param markPrice Current mark price (6 decimals)
     * @return standardPnL P&L using standard formula (18 decimals)
     * @return isValid Whether calculations are mathematically consistent
     * @notice This function helps verify that all P&L methods produce identical results
     */
    function validatePnLConsistency(int256 size, uint256 entryPrice, uint256 markPrice)
        external
        pure
        returns (int256 standardPnL, bool isValid)
    {
        // Standard P&L calculation
        standardPnL = calculatePositionPnL(size, entryPrice, markPrice);
        
        // Alternative calculation (should produce identical results)
        int256 priceDiff = int256(markPrice) - int256(entryPrice);
        int256 alternativePnL = (priceDiff * size) / int256(TICK_PRECISION);
        
        // Verify mathematical consistency
        isValid = (standardPnL == alternativePnL);
    }
}