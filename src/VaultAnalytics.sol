// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VaultAnalytics
 * @dev Complete analytics library with proper function ordering
 */
library VaultAnalytics {
    
    uint256 public constant TICK_PRECISION = 1e6;
    uint256 public constant DECIMAL_SCALE = 1e12;
    
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

    function calculatePositionPnL(int256 size, uint256 entryPrice, uint256 markPrice)
        public
        pure
        returns (int256 pnl)
    {
        if (size == 0) return 0;
        
        if (size > 0) {
            if (markPrice > entryPrice) {
                uint256 profitPerUnit = markPrice - entryPrice;
                pnl = int256((profitPerUnit * uint256(size)) / (DECIMAL_SCALE * TICK_PRECISION));
            } else {
                uint256 lossPerUnit = entryPrice - markPrice;
                pnl = -int256((lossPerUnit * uint256(size)) / (DECIMAL_SCALE * TICK_PRECISION));
            }
        } else {
            if (entryPrice > markPrice) {
                uint256 profitPerUnit = entryPrice - markPrice;
                pnl = int256((profitPerUnit * uint256(-size)) / (DECIMAL_SCALE * TICK_PRECISION));
            } else {
                uint256 lossPerUnit = markPrice - entryPrice;
                pnl = -int256((lossPerUnit * uint256(-size)) / (DECIMAL_SCALE * TICK_PRECISION));
            }
        }
    }

    // ============ COMPLEX FUNCTIONS (USE BASIC FUNCTIONS) ============

    function getMarginSummary(
        uint256 userCollateral,
        int256 realizedPnL,
        Position[] memory positions,
        PendingOrder[] memory pendingOrders,
        uint256[] memory markPrices
    ) external pure returns (MarginSummary memory) {
        uint256 marginUsed = getTotalMarginUsed(positions);
        uint256 marginReserved = getTotalMarginReserved(pendingOrders);
        uint256 availableCollateral = getAvailableCollateral(userCollateral, positions);
        int256 unrealizedPnL = getUnrealizedPnL(positions, markPrices);
        
        // Calculate portfolio value inline
        int256 portfolioValue = int256(userCollateral) + realizedPnL + unrealizedPnL;
        
        return MarginSummary({
            totalCollateral: userCollateral,
            marginUsed: marginUsed,
            marginReserved: marginReserved,
            availableCollateral: availableCollateral,
            realizedPnL: realizedPnL,
            unrealizedPnL: unrealizedPnL,
            portfolioValue: portfolioValue > 0 ? uint256(portfolioValue) : 0
        });
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
}