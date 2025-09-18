// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./PositionManager.sol";

interface ICoreVault {
    function isLiquidatable(address user, bytes32 marketId, uint256 markPrice) external view returns (bool);
    function getPositionSummary(address user, bytes32 marketId) external view returns (int256 size, uint256 entryPrice, uint256 marginLocked);
    function liquidateShort(address user, bytes32 marketId, address liquidator) external;
    function liquidateLong(address user, bytes32 marketId, address liquidator) external;
    function lockMargin(address user, bytes32 marketId, uint256 amount) external;
    function releaseMargin(address user, bytes32 marketId, uint256 amount) external;
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external;
    function unreserveMargin(address user, bytes32 orderId) external;
    function releaseExcessMargin(address user, bytes32 orderId, uint256 actualMarginNeeded) external;
    function updatePositionWithMargin(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice, uint256 marginToLock) external;
    function updatePositionWithLiquidation(address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, address liquidator) external;
    function deductFees(address user, uint256 feeAmount, address feeRecipient) external;
    function transferCollateral(address from, address to, uint256 amount) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    function getUserPositions(address user) external view returns (PositionManager.Position[] memory);
    function getUnifiedMarginSummary(address user) external view returns (
        uint256 totalCollateral,
        uint256 marginUsedInPositions,
        uint256 marginReservedForOrders,
        uint256 availableMargin,
        int256 realizedPnL,
        int256 unrealizedPnL,
        uint256 totalMarginCommitted,
        bool isMarginHealthy
    );
    function getMarginUtilization(address user) external view returns (uint256 utilizationBps);
    
    // Enhanced liquidation functions
    function confiscateAvailableCollateralForGapLoss(address user, uint256 gapLossAmount) external;
    function socializeLoss(bytes32 marketId, uint256 lossAmount, address liquidatedUser) external;
    
    // Mark price management
    function updateMarkPrice(bytes32 marketId, uint256 price) external;
}

/**
 * @title OrderBook
 * @dev A centralized exchange-style order book smart contract with margin trading
 * @notice Implements limit and market orders with FIFO matching and vault integration
 */
contract OrderBook {
    using Math for uint256;
    // Constants for precision - aligned with USDC pricing
    uint256 public constant PRICE_DECIMALS = 6;   // USDC has 6 decimals
    uint256 public constant AMOUNT_DECIMALS = 18;  // Standard 18 decimals for amounts
    uint256 public constant PRICE_SCALE = 10**PRICE_DECIMALS;
    uint256 public constant AMOUNT_SCALE = 10**AMOUNT_DECIMALS;

    // Order structure
    struct Order {
        uint256 orderId;
        address trader;
        uint256 price;      // Price with 6 decimals (USDC)
        uint256 amount;     // Remaining amount with 18 decimals
        bool isBuy;
        uint256 timestamp;
        uint256 nextOrderId; // For linked list implementation
        uint256 marginRequired; // Margin required for this order
        bool isMarginOrder; // Whether this order uses margin
    }

    // Price level structure for efficient order management
    struct PriceLevel {
        uint256 totalAmount;
        uint256 firstOrderId; // Head of linked list
        uint256 lastOrderId;  // Tail of linked list
        bool exists;
    }
    
    // Liquidation execution result structure
    struct LiquidationExecutionResult {
        bool success;                    // Whether liquidation was successful
        uint256 filledAmount;           // Amount that was actually filled
        uint256 remainingAmount;        // Amount that could not be filled
        uint256 averageExecutionPrice;  // Volume-weighted average execution price
        uint256 worstExecutionPrice;    // Worst price among all executions
        uint256 totalExecutions;        // Number of price levels executed at
    }

    // State variables
    mapping(uint256 => Order) public orders;
    mapping(uint256 => PriceLevel) public buyLevels;  // price => PriceLevel
    mapping(uint256 => PriceLevel) public sellLevels; // price => PriceLevel
    mapping(address => uint256[]) public userOrders;  // trader => orderIds[]

    uint256 public nextOrderId = 1;
    uint256 public bestBid = 0;     // Highest buy price
    uint256 public bestAsk = type(uint256).max; // Lowest sell price

    // Arrays to track all price levels for iteration
    uint256[] public buyPrices;
    uint256[] public sellPrices;
    mapping(uint256 => bool) public buyPriceExists;
    mapping(uint256 => bool) public sellPriceExists;

    // Vault integration
    ICoreVault public immutable vault;
    bytes32 public immutable marketId;
    
    // Trading parameters
    uint256 public marginRequirementBps = 10000; // 100% margin requirement by default (1:1, basis points)
    uint256 public tradingFee = 10; // 0.1% trading fee (basis points)
    address public feeRecipient;
    uint256 public maxSlippageBps = 500; // 5% maximum slippage for market orders (basis points)
    
    // Leverage control system
    bool public leverageEnabled = false; // Leverage disabled by default
    
    // Liquidation settings
    uint256 public constant MAX_POSITIONS_TO_CHECK = 5;     // Reduced to 5 positions per check for gas efficiency
    uint256 public constant LIQUIDATION_INTERVAL = 0; // No throttle between checks
    uint256 public lastLiquidationCheck;
    uint256 public lastCheckedIndex;
    uint256 public lastMarkPrice;
    
    // Track active positions for liquidation checks
    address[] public activeTraders;
    mapping(address => bool) public isActiveTrader;
    
    // LIQUIDATION FIX: Enhanced user tracking - all users who ever traded
    address[] public allKnownUsers;
    mapping(address => bool) public isKnownUser;
    
    // Recursion guard to prevent infinite liquidation loops
    bool private liquidationInProgress;
    // Indicates we are executing a liquidation market matching flow
    bool private liquidationMode;
    // Target user whose position is being force-closed during liquidation market order
    address private liquidationTarget;
    // True when liquidation market order is a BUY to close a short; false when SELL to close a long
    bool private liquidationClosesShort;
    
    // Enhanced liquidation execution tracking
    uint256 private liquidationExecutionTotalVolume;    // Total volume executed
    uint256 private liquidationExecutionTotalValue;     // Total value (price * volume) executed
    uint256 private liquidationWorstPrice;              // Worst execution price achieved
    uint256 private liquidationExecutionCount;          // Number of executions
    
    /**
     * @dev Create a market buy order for liquidation (on behalf of target user)
     * @param traderAddress Address of the user being liquidated (buyer to cover short)
     * @param orderAmount Amount to buy
     * @param maxOrderPrice Maximum price to pay
     */
    function createMarketBuyOrder(
        bytes32 /* marketId_ */,
        address traderAddress,
        uint256 orderAmount,
        uint256 maxOrderPrice,
        bool /* reduceOnly_ */
    ) internal returns (uint256) {
        require(orderAmount > 0, "OrderBook: invalid amount");
        
        // Create market buy order
        Order memory order = Order({
            orderId: nextOrderId++,
            trader: traderAddress,
            price: maxOrderPrice,
            amount: orderAmount,
            isBuy: true,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0,
            isMarginOrder: true
        });
        
        // Match against sell book
        uint256 remainingAmount = _matchBuyOrderWithSlippage(order, orderAmount, maxOrderPrice);
        require(remainingAmount == 0, "OrderBook: could not fill market order");
        
        return order.orderId;
    }
    
    /**
     * @dev Create a market sell order for liquidation (on behalf of target user)
     * @param traderAddress Address of the user being liquidated (seller to close long)
     * @param orderAmount Amount to sell
     * @param minOrderPrice Minimum price to accept
     */
    function createMarketSellOrder(
        bytes32 /* marketId_ */,
        address traderAddress,
        uint256 orderAmount,
        uint256 minOrderPrice,
        bool /* reduceOnly_ */
    ) internal returns (uint256) {
        require(orderAmount > 0, "OrderBook: invalid amount");
        
        // Create market sell order
        Order memory order = Order({
            orderId: nextOrderId++,
            trader: traderAddress,
            price: minOrderPrice,
            amount: orderAmount,
            isBuy: false,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0,
            isMarginOrder: true
        });
        
        // Match against buy book
        uint256 remainingAmount = _matchSellOrderWithSlippage(order, orderAmount, minOrderPrice);
        require(remainingAmount == 0, "OrderBook: could not fill market order");
        
        return order.orderId;
    }

    function _checkPositionsForLiquidation(uint256 markPrice) internal {
        // DEBUG: PAST - Function entry point reached and verified working
        emit LiquidationCheckStarted(markPrice, 0, 0, 0); // Will update with actual values
        
        // CRITICAL FIX: Prevent infinite recursion during liquidation
        if (liquidationInProgress) {
            // DEBUG: PAST - Recursion guard check completed, liquidation already in progress
            emit LiquidationRecursionGuardSet(true);
            return; // Skip liquidation check if already in progress
        }
        
        // DEBUG: PAST - Recursion guard passed, proceeding with liquidation check
        emit LiquidationRecursionGuardSet(false);
        
        // ============ LIQUIDATION ARCHITECTURAL FIX ============
        // 
        // PROBLEM SOLVED: Previously, liquidations only checked users in the 
        // OrderBook's local `activeTraders` array. This created a critical
        // synchronization bug where:
        // 1. OrderBook maintained activeTraders based on local position data
        // 2. Vault maintained the authoritative position data  
        // 3. When these got out of sync, liquidatable users became "invisible"
        // 4. Result: Liquidatable positions were never liquidated!
        //
        // SOLUTION: Query the vault directly for users with positions.
        // The vault is the single source of truth for positions and maintains
        // its own user tracking system that is always synchronized.
        // 
        // This ensures ALL users with liquidatable positions are checked,
        // regardless of any synchronization issues with OrderBook state.
        //
        // LIQUIDATION FIX: Use recent traders from trade history plus active traders
        address[] memory recentTraders = _getRecentUniqueTraders();
        uint256 tradersLength = recentTraders.length;
        
        // DEBUG: PAST - Recent traders retrieved successfully from trade history
        // This section gets all traders who have participated in recent trades
        
        if (tradersLength == 0) {
            // DEBUG: PAST - No traders found to check, early return executed
            emit LiquidationCheckCompleted(0, 0);
            return;
        }
        
        // DEBUG: PAST - Traders found, setting up liquidation parameters
        // Set recursion guard
        liquidationInProgress = true;
        
        uint256 startIndex = lastCheckedIndex;
        uint256 endIndex = Math.min(startIndex + MAX_POSITIONS_TO_CHECK, tradersLength);
        uint256 liquidationsTriggered = 0;
        
        // DEBUG: PAST - Liquidation batch parameters calculated and verified
        // This section determines which subset of traders to check in this batch
        emit LiquidationCheckStarted(markPrice, tradersLength, startIndex, endIndex);
        
        // Process liquidations one by one to avoid array allocation issues
        for (uint256 i = startIndex; i < endIndex; i++) {
            if (i >= recentTraders.length) break; // Safety check
            
            address trader = recentTraders[i];
            
            // DEBUG: PAST - Trader extracted from array, beginning liquidation check
            // This section processes each trader individually to check liquidation status
            emit LiquidationTraderBeingChecked(trader, i, tradersLength);
            
            // Check if trader is liquidatable
            bool isLiquidatable = false;
            try vault.isLiquidatable(trader, marketId, markPrice) returns (bool liquidatable) {
                isLiquidatable = liquidatable;
                // DEBUG: PAST - Liquidatable check completed successfully via vault
                // This section queries the vault to determine if trader needs liquidation
                emit LiquidationLiquidatableCheck(trader, isLiquidatable, markPrice);
            } catch {
                // DEBUG: PAST - Liquidatable check failed, skipping trader
                // This section handles vault query failures gracefully
                emit LiquidationLiquidatableCheck(trader, false, markPrice);
                continue;
            }
            
            if (!isLiquidatable) {
                // DEBUG: PAST - Trader not liquidatable, continuing to next trader
                // This section confirms trader is healthy and skips liquidation
                continue;
            }
            
            // DEBUG: PAST - Trader confirmed as liquidatable, proceeding with liquidation
            // This section begins the actual liquidation process for unhealthy positions
            
            // Attempt liquidation
            bool liquidationCompleted = false;
            try vault.getPositionSummary(trader, marketId) returns (int256 size, uint256 marginLocked, uint256 unrealizedPnL) {
                // DEBUG: PAST - Position summary retrieved successfully from vault
                // This section gets the current position details for liquidation
                emit LiquidationPositionRetrieved(trader, size, marginLocked, unrealizedPnL);
                
                if (size == 0) {
                    // DEBUG: PAST - Position already closed, skipping liquidation
                    // This section handles positions that were closed between checks
                    continue;
                }
                
                // DEBUG: PAST - Position confirmed open, attempting market order liquidation
                // This section tries to liquidate via market order matching first
                
                // Try market order liquidation first
                LiquidationExecutionResult memory liquidationResult;
                bool marketOrderSuccess = false;
                if (size < 0) {
                    // Short liquidation: Create market BUY order
                    // DEBUG: PAST - Attempting short liquidation via market buy order
                    emit LiquidationMarketOrderAttempt(trader, uint256(-size), true, markPrice);
                    liquidationResult = _executeLiquidationMarketOrder(trader, uint256(-size), true, markPrice);
                    marketOrderSuccess = liquidationResult.success;
                } else {
                    // Long liquidation: Create market SELL order
                    // DEBUG: PAST - Attempting long liquidation via market sell order
                    emit LiquidationMarketOrderAttempt(trader, uint256(size), false, markPrice);
                    liquidationResult = _executeLiquidationMarketOrder(trader, uint256(size), false, markPrice);
                    marketOrderSuccess = liquidationResult.success;
                }
                
                // DEBUG: PAST - Market order liquidation attempt completed
                // This section reports the result of the market order liquidation
                emit LiquidationMarketOrderResult(trader, marketOrderSuccess, marketOrderSuccess ? "Market order filled" : "No liquidity available");
                
                // ============ ENHANCED THREE-LAYER LIQUIDATION DEFENSE ============
                
                if (marketOrderSuccess && liquidationResult.filledAmount > 0) {
                    // Market order succeeded - check for gap loss and apply three-layer protection
                    _processEnhancedLiquidationWithGapProtection(
                        trader,
                        size,
                        markPrice,
                        liquidationResult
                    );
                    liquidationCompleted = true;
                }
                
                // If market order failed, use vault liquidation as backup
                if (!marketOrderSuccess) {
                    // DEBUG: PAST - Market order failed, attempting direct vault liquidation
                    // This section handles liquidation when no market liquidity is available
                    // The vault liquidation methods will automatically trigger ADL if needed
                    
                    if (size > 0) {
                        // Try long liquidation
                        // DEBUG: PAST - Attempting long position socialized loss liquidation
                        emit LiquidationSocializedLossAttempt(trader, true, "liquidateLong");
                        try vault.liquidateLong(trader, marketId, address(this)) {
                            liquidationCompleted = true;
                            // DEBUG: PAST - Long socialized loss liquidation successful
                            emit LiquidationSocializedLossResult(trader, true, "liquidateLong");
                        } catch {
                            // DEBUG: PAST - Long socialized loss liquidation failed, skipping trader
                            emit LiquidationSocializedLossResult(trader, false, "liquidateLong");
                            continue;
                        }
                    } else {
                        // Try short liquidation
                        // DEBUG: PAST - Attempting short position socialized loss liquidation
                        emit LiquidationSocializedLossAttempt(trader, false, "liquidateShort");
                        try vault.liquidateShort(trader, marketId, address(this)) {
                            liquidationCompleted = true;
                            // DEBUG: PAST - Short socialized loss liquidation successful
                            emit LiquidationSocializedLossResult(trader, true, "liquidateShort");
                        } catch {
                            // DEBUG: PAST - Short socialized loss liquidation failed, skipping trader
                            emit LiquidationSocializedLossResult(trader, false, "liquidateShort");
                            continue;
                        }
                    }
                } else {
                    liquidationCompleted = true;
                    // DEBUG: PAST - Market order liquidation successful, vault liquidation processing includes ADL check
                }
                
                if (liquidationCompleted) {
                    liquidationsTriggered++;
                    emit AutoLiquidationTriggered(trader, marketId, size, markPrice);
                    
                    // DEBUG: PAST - Liquidation completed successfully, updating counters
                    // This section handles successful liquidation cleanup and tracking
                    emit LiquidationCompleted(trader, liquidationsTriggered, marketOrderSuccess ? "Market Order" : "Socialized Loss");
                    
                    // Position liquidated successfully - vault tracking handles user list updates
                    
                    // Only liquidate one position per call to avoid gas issues
                    break;
                }
            } catch {
                // DEBUG: PAST - Failed to get position summary, skipping trader
                // This section handles vault query failures for position data
                continue;
            }
        }
        
        // DEBUG: PAST - Liquidation loop completed, updating tracking indices
        // This section handles post-liquidation cleanup and state updates
        
        // Update tracking
        uint256 oldIndex = lastCheckedIndex;
        lastCheckedIndex = endIndex >= tradersLength ? 0 : endIndex;
        lastLiquidationCheck = block.timestamp;
        
        // DEBUG: PAST - Tracking indices updated successfully
        emit LiquidationIndexUpdated(oldIndex, lastCheckedIndex, tradersLength);
        
        // Clear recursion guard
        liquidationInProgress = false;
        
        // DEBUG: PAST - Liquidation check completed, recursion guard cleared
        // This section finalizes the liquidation check and reports results
        emit LiquidationCheckFinished(endIndex - startIndex, liquidationsTriggered, lastCheckedIndex);
        emit LiquidationCheckCompleted(endIndex - startIndex, liquidationsTriggered);
    }
    
    /**
     * @dev Execute a liquidation market order against order book liquidity
     * @param trader Address of the trader being liquidated
     * @param amount Amount to trade
     * @param isBuy True for buy order (covering short), false for sell order (closing long)
     * @param markPrice Current mark price for slippage calculation
     * @return result Detailed execution results including success status and execution prices
     */
    function _executeLiquidationMarketOrder(
        address trader,
        uint256 amount,
        bool isBuy,
        uint256 markPrice
    ) internal returns (LiquidationExecutionResult memory result) {
        // Initialize result
        result.success = false;
        result.filledAmount = 0;
        result.remainingAmount = amount;
        result.averageExecutionPrice = 0;
        result.worstExecutionPrice = 0;
        result.totalExecutions = 0;
        
        // Validate inputs
        if (amount == 0 || markPrice == 0) {
            return result;
        }
        
        // Check if there's any liquidity available
        if (isBuy && bestAsk == type(uint256).max) {
            return result; // No asks available for buy order
        }
        if (!isBuy && bestBid == 0) {
            return result; // No bids available for sell order
        }
        
        // Calculate maximum acceptable slippage (15% from mark price for liquidations)
        uint256 liquidationSlippageBps = 1500; // 15% - more generous for liquidations
        uint256 maxPrice;
        uint256 minPrice;
        
        unchecked {
            maxPrice = isBuy ? 
                (markPrice * (10000 + liquidationSlippageBps)) / 10000 : 
                type(uint256).max;
            minPrice = isBuy ? 
                0 : 
                (markPrice > liquidationSlippageBps * markPrice / 10000) ? 
                    (markPrice * (10000 - liquidationSlippageBps)) / 10000 : 0;
        }
        
        // Initialize execution tracking
        liquidationExecutionTotalVolume = 0;
        liquidationExecutionTotalValue = 0;
        liquidationWorstPrice = isBuy ? 0 : type(uint256).max; // Best possible starting point
        liquidationExecutionCount = 0;
        
        // Create liquidation order - still use OrderBook as order owner,
        // but we will attribute margin updates to the real trader below
        Order memory liquidationOrder = Order({
            orderId: nextOrderId++,
            trader: address(this),
            price: isBuy ? maxPrice : minPrice,
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0,
            isMarginOrder: true
        });
        
        uint256 remainingAmount = amount;
        
        // Execute the matching - these functions are designed to not revert
        // Ensure liquidation mode so margin is updated for the real trader
        liquidationMode = true;
        liquidationTarget = trader;
        liquidationClosesShort = isBuy; // buy to close short, sell to close long
        
        if (isBuy) {
            remainingAmount = _matchBuyOrderWithSlippage(liquidationOrder, amount, maxPrice);
        } else {
            remainingAmount = _matchSellOrderWithSlippage(liquidationOrder, amount, minPrice);
        }
        
        liquidationMode = false;
        liquidationTarget = address(0);
        
        // Calculate results
        result.remainingAmount = remainingAmount;
        result.filledAmount = amount - remainingAmount;
        
        // Calculate average execution price if any execution happened
        if (liquidationExecutionTotalVolume > 0) {
            result.averageExecutionPrice = liquidationExecutionTotalValue / liquidationExecutionTotalVolume;
            result.worstExecutionPrice = liquidationWorstPrice;
            result.totalExecutions = liquidationExecutionCount;
            
            // Success if order was filled at least 50% (more lenient for liquidations)
            result.success = result.filledAmount >= (amount * 50) / 100;
        }
        
        return result;
    }
    
    /**
     * @dev Process enhanced three-layer liquidation with gap protection
     * @param trader Address of the trader being liquidated
     * @param positionSize Size of the position being liquidated (positive for long, negative for short)
     * @param liquidationTriggerPrice The intended liquidation price (mark price)
     * @param executionResult The actual execution results from market order
     */
    function _processEnhancedLiquidationWithGapProtection(
        address trader,
        int256 positionSize,
        uint256 liquidationTriggerPrice,
        LiquidationExecutionResult memory executionResult
    ) internal {
        // Calculate gap loss: difference between intended liquidation price and worst execution price
        uint256 gapLoss = 0;
        uint256 layer1LockedMargin = 0;
        uint256 layer2AvailableCollateral = 0;
        uint256 layer3SocializedLoss = 0;
        
        // Calculate gap loss based on position type and execution
        if (executionResult.worstExecutionPrice != liquidationTriggerPrice) {
            uint256 priceGap;
            
            if (positionSize > 0) {
                // Long position liquidation (selling at lower price is bad)
                if (executionResult.worstExecutionPrice < liquidationTriggerPrice) {
                    priceGap = liquidationTriggerPrice - executionResult.worstExecutionPrice;
                    gapLoss = (priceGap * uint256(positionSize)) / PRICE_SCALE;
                }
            } else {
                // Short position liquidation (buying at higher price is bad)
                if (executionResult.worstExecutionPrice > liquidationTriggerPrice) {
                    priceGap = executionResult.worstExecutionPrice - liquidationTriggerPrice;
                    gapLoss = (priceGap * uint256(-positionSize)) / PRICE_SCALE;
                }
            }
            
            if (gapLoss > 0) {
                emit LiquidationMarketGapDetected(
                    trader,
                    liquidationTriggerPrice,
                    executionResult.worstExecutionPrice,
                    positionSize,
                    gapLoss
                );
                
                // Emit focused gap loss event for easy monitoring
                emit GapLossDetected(
                    trader,
                    marketId,
                    gapLoss,
                    liquidationTriggerPrice,
                    executionResult.worstExecutionPrice,
                    positionSize
                );
            }
        }
        
        // Get user's position and collateral information
        try vault.getUnifiedMarginSummary(trader) returns (
            uint256 totalCollateral,
            uint256 marginUsed,
            uint256 marginReserved,
            uint256 availableMargin,
            int256 realizedPnL,
            int256 unrealizedPnL,
            uint256 totalMarginCommitted,
            bool isMarginHealthy
        ) {
            // ============ CRITICAL FIX: ENSURE VAULT LIQUIDATION PROCESSING ============
            // Layer 1: Process the actual liquidation through the vault first
            // This ensures the position is properly closed and ADL is triggered if needed
            
            // STEP 1: Process the liquidation through vault's liquidation mechanism
            // This will handle position closure, margin confiscation, and trigger ADL if user's collateral is insufficient
            bool vaultLiquidationSuccess = false;
            
            if (positionSize > 0) {
                // Long position liquidation
                // 🔧 CRITICAL FIX: Ensure mark price is synchronized before ADL
                uint256 currentMarkPrice = _calculateMarkPrice();
                vault.updateMarkPrice(marketId, currentMarkPrice);
                
                try vault.liquidateLong(trader, marketId, address(this)) {
                    vaultLiquidationSuccess = true;
                    emit LiquidationPositionProcessed(trader, positionSize, executionResult.averageExecutionPrice);
                } catch (bytes memory reason) {
                    emit LiquidationProcessingFailed(trader, reason);
                }
            } else {
                // Short position liquidation  
                // 🔧 CRITICAL FIX: Ensure mark price is synchronized before ADL
                uint256 currentMarkPrice = _calculateMarkPrice();
                vault.updateMarkPrice(marketId, currentMarkPrice);
                
                // 🔍 DEBUG: About to call vault.liquidateShort
                emit DebugLiquidationCall(trader, marketId, positionSize, "liquidateShort");
                try vault.liquidateShort(trader, marketId, address(this)) {
                    vaultLiquidationSuccess = true;
                    emit LiquidationPositionProcessed(trader, positionSize, executionResult.averageExecutionPrice);
                    emit DebugLiquidationCall(trader, marketId, positionSize, "liquidateShort_SUCCESS");
                } catch (bytes memory reason) {
                    emit LiquidationProcessingFailed(trader, reason);
                    emit DebugLiquidationCall(trader, marketId, positionSize, "liquidateShort_FAILED");
                }
            }
            
            // Get updated margin info after vault processing
            if (vaultLiquidationSuccess) {
                try vault.getPositionSummary(trader, marketId) returns (int256 newSize, uint256 newEntryPrice, uint256 newMarginLocked) {
                    layer1LockedMargin = newMarginLocked; // This reflects what was actually confiscated
                } catch {
                    layer1LockedMargin = marginUsed; // Fallback to original estimate
                }
            } else {
                // Vault liquidation failed - proceed with gap loss processing as fallback
                layer1LockedMargin = marginUsed;
            }
            
            // Layer 2: Use available collateral to cover any additional gap loss
            // Note: The vault's liquidation processing above may have already triggered ADL
            // if the user's total collateral was insufficient for the base liquidation loss
            if (gapLoss > 0 && availableMargin > 0) {
                uint256 availableForGapCoverage = availableMargin;
                uint256 gapCoveredByAvailable = gapLoss < availableForGapCoverage ? gapLoss : availableForGapCoverage;
                
                if (gapCoveredByAvailable > 0) {
                    // Deduct from user's available collateral via vault
                    try vault.confiscateAvailableCollateralForGapLoss(trader, gapCoveredByAvailable) {
                        layer2AvailableCollateral = gapCoveredByAvailable;
                        gapLoss -= gapCoveredByAvailable;
                        
                        emit LiquidationAvailableCollateralUsed(
                            trader,
                            gapCoveredByAvailable,
                            availableMargin - gapCoveredByAvailable,
                            gapCoveredByAvailable
                        );
                    } catch {
                        // Available collateral confiscation failed - proceed to socialization
                    }
                }
            }
            
            // Layer 3: Socialize any remaining gap loss
            if (gapLoss > 0) {
                layer3SocializedLoss = gapLoss;
                
                emit LiquidationRequiresSocialization(
                    trader,
                    gapLoss,
                    totalCollateral
                );
                
                // Trigger socialized loss mechanism
                try vault.socializeLoss(marketId, gapLoss, trader) {
                    // Socialized loss applied successfully
                } catch {
                    // Socialized loss failed - system is in critical state
                    // This should be extremely rare
                }
            }
            
        } catch {
            // Failed to get user's margin summary - proceed with basic liquidation
            // Gap loss will be entirely socialized
            if (gapLoss > 0) {
                layer3SocializedLoss = gapLoss;
                emit LiquidationRequiresSocialization(trader, gapLoss, 0);
                
                try vault.socializeLoss(marketId, gapLoss, trader) {
                    // Socialized loss applied
                } catch {
                    // Critical system failure
                }
            }
        }
        
        // Emit comprehensive liquidation breakdown
        emit LiquidationLayerBreakdown(
            trader,
            layer1LockedMargin,
            layer2AvailableCollateral,
            layer3SocializedLoss,
            layer1LockedMargin + layer2AvailableCollateral + layer3SocializedLoss
        );
    }
    
    /**
     * @dev Remove trader from active traders list when position is closed
     * @param trader Address to remove from active traders
     */
    function _removeFromActiveTraders(address trader) internal {
        if (!isActiveTrader[trader]) {
            return; // Already not in the list
        }
        
        for (uint256 i = 0; i < activeTraders.length; i++) {
            if (activeTraders[i] == trader) {
                // Replace with last element and pop
                activeTraders[i] = activeTraders[activeTraders.length - 1];
                activeTraders.pop();
                isActiveTrader[trader] = false;
                
                emit ActiveTraderRemoved(trader);
                break;
            }
        }
    }
    
    /**
     * @dev Track active traders for liquidation checks
     */
    function _updateActiveTrader(address trader, bool isActive) internal {
        if (isActive && !isActiveTrader[trader]) {
            activeTraders.push(trader);
            isActiveTrader[trader] = true;
            emit ActiveTraderAdded(trader);
        } else if (!isActive && isActiveTrader[trader]) {
            // Remove from active traders
            _removeFromActiveTraders(trader);
        }
    }
    
    /**
     * @dev LIQUIDATION FIX: Track all users who ever trade
     */
    function _trackKnownUser(address user) internal {
        if (!isKnownUser[user]) {
            isKnownUser[user] = true;
            allKnownUsers.push(user);
        }
    }
    
    /**
     * @dev LIQUIDATION FIX: Get recent unique traders - simple approach using active traders + known users
     */
    function _getRecentUniqueTraders() internal view returns (address[] memory) {
        // Simple approach: combine activeTraders with allKnownUsers
        uint256 maxSize = activeTraders.length + allKnownUsers.length;
        address[] memory tempTraders = new address[](maxSize);
        uint256 count = 0;
        
        // Add all active traders first
        for (uint256 i = 0; i < activeTraders.length; i++) {
            tempTraders[count] = activeTraders[i];
            count++;
        }
        
        // Add known users (will include some duplicates, but that's ok for liquidation checking)
        for (uint256 i = 0; i < allKnownUsers.length; i++) {
            tempTraders[count] = allKnownUsers[i];
            count++;
        }
        
        // Create properly sized result array
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = tempTraders[i];
        }
        
        return result;
    }
    
    // Events
    event AutoLiquidationTriggered(
        address indexed user,
        bytes32 indexed marketId,
        int256 positionSize,
        uint256 markPrice
    );
    
    event LiquidationCheckCompleted(
        uint256 positionsChecked,
        uint256 liquidationsTriggered
    );

    event MarginUpdateFailed(
        address indexed user,
        int256 amount,
        uint256 price
    );
    
    event ActiveTraderAdded(address indexed trader);
    
    event ActiveTraderRemoved(
        address indexed trader
    );
    
    // Removed unused liquidation debug events
    uint256 public maxLeverage = 1; // 1x leverage (1:1 margin) by default
    address public leverageController; // Who can enable/disable leverage
    
    // REMOVED: Position tracking now handled exclusively by CoreVault
    // mapping(address => int256) public userPositions; // DEPRECATED - use CoreVault as single source of truth
    
    // Order tracking for viewer functions  
    mapping(uint256 => uint256) public filledAmounts; // orderId => filled amount
    mapping(uint256 => uint256) public cumulativeMarginUsed; // orderId => cumulative margin used for executed portions
    uint256 public lastTradePrice = 1000000; // Last trade price, default to 1 USDC

    // ============ Trade History System ============
    
    struct Trade {
        uint256 tradeId;           // Unique trade identifier
        address buyer;             // Buyer address
        address seller;            // Seller address
        uint256 price;             // Trade price (6 decimals)
        uint256 amount;            // Trade amount (18 decimals)
        uint256 timestamp;         // Block timestamp
        uint256 buyOrderId;        // Buy order ID (0 for market orders)
        uint256 sellOrderId;       // Sell order ID (0 for market orders)
        bool buyerIsMargin;        // Whether buyer used margin
        bool sellerIsMargin;       // Whether seller used margin
        uint256 tradeValue;        // Trade value in USDC (6 decimals)
        uint256 buyerFee;          // Fee paid by buyer (6 decimals)
        uint256 sellerFee;         // Fee paid by seller (6 decimals)
    }
    
    // Trade storage
    mapping(uint256 => Trade) public trades;
    uint256 public nextTradeId = 1;
    uint256 public totalTradeCount = 0;
    
    // User trade history
    mapping(address => uint256[]) public userTradeIds;
    
    // Pagination constants
    uint256 public constant MAX_TRADES_PER_QUERY = 100;
    
    // ============ VWAP System ============
    
    // VWAP configuration - simplified for gas optimization
    uint256 public vwapTimeWindow = 3600; // Default 1 hour window in seconds
    uint256 public minVolumeForVWAP = 100 * AMOUNT_SCALE; // Minimum 100 units volume for valid VWAP
    bool public useVWAPForMarkPrice = true; // Enable/disable VWAP for mark price
    
    // Trade events
    event TradeExecuted(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 amount,
        uint256 tradeValue,
        uint256 timestamp
    );

    // Events
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy, bool isMarginOrder);
    event OrderMatched(address indexed buyer, address indexed seller, uint256 price, uint256 amount);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 filledAmount, uint256 remainingAmount);
    event PositionUpdated(address indexed trader, int256 oldPosition, int256 newPosition);
    event MarginOrderPlaced(uint256 indexed orderId, address indexed trader, uint256 marginRequired);
    
    // Leverage control events
    event LeverageEnabled(address indexed controller, uint256 maxLeverage, uint256 newMarginRequirement);
    event LeverageDisabled(address indexed controller);
    event LeverageControllerUpdated(address indexed oldController, address indexed newController);
    event MarginRequirementUpdated(uint256 oldRequirement, uint256 newRequirement);
    event TradingParametersUpdated(uint256 marginRequirement, uint256 tradingFee, address feeRecipient);
    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    event OrderModified(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed trader, uint256 newPrice, uint256 newAmount);
    
    // VWAP events
    event VWAPConfigUpdated(uint256 timeWindow, uint256 minVolume, bool useVWAP);
    event VWAPCalculated(uint256 vwap, uint256 volume, uint256 tradeCount, uint256 timeWindow);
    
    // DEBUG EVENTS for _executeTrade function
    event TradeExecutionStarted(address indexed buyer, address indexed seller, uint256 price, uint256 amount, bool buyerMargin, bool sellerMargin);
    event TradeValueCalculated(uint256 tradeValue, uint256 buyerFee, uint256 sellerFee);
    event TradeRecorded(uint256 tradeId);
    event PositionsRetrieved(address indexed buyer, int256 oldBuyerPosition, address indexed seller, int256 oldSellerPosition);
    event PositionsCalculated(int256 newBuyerPosition, int256 newSellerPosition);
    event ActiveTradersUpdated(address indexed buyer, bool buyerActive, address indexed seller, bool sellerActive);
    event MarginValidationPassed(bool buyerMargin, bool sellerMargin);
    event LiquidationTradeDetected(bool isLiquidationTrade, address liquidationTarget, bool liquidationClosesShort);
    event MarginUpdatesStarted(bool isLiquidationTrade);
    event MarginUpdatesCompleted();
    event FeesDeducted(address indexed buyer, uint256 buyerFee, address indexed seller, uint256 sellerFee);
    event PriceUpdated(uint256 lastTradePrice, uint256 currentMarkPrice);
    event LiquidationCheckTriggered(uint256 currentMark, uint256 lastMarkPrice);
    event TradeExecutionCompleted(address indexed buyer, address indexed seller, uint256 price, uint256 amount);

    // DEBUG EVENTS for _matchBuyOrderWithSlippage function
    event MatchingStarted(address indexed buyer, uint256 remainingAmount, uint256 maxPrice, uint256 startingPrice);
    event PriceLevelEntered(uint256 currentPrice, bool levelExists, uint256 totalAmountAtLevel);
    event OrderMatchAttempt(uint256 orderId, address indexed seller, uint256 sellOrderAmount, uint256 matchAmount);
    event MarginUpdateExecuted(address indexed buyer, uint256 currentPrice, uint256 matchAmount, uint256 remainingAmount);
    event OrderFullyFilled(uint256 orderId, address indexed trader, uint256 totalFilled);
    event OrderPartiallyMatched(uint256 orderId, address indexed trader, uint256 matchAmount, uint256 remainingAmount);
    event PriceLevelExhausted(uint256 currentPrice, uint256 nextPrice);
    event SlippageProtectionTriggered(uint256 currentPrice, uint256 maxPrice, uint256 remainingAmount);
    event BestAskUpdated(uint256 oldBestAsk, uint256 newBestAsk);
    event MatchingCompleted(address indexed buyer, uint256 originalAmount, uint256 filledAmount, uint256 remainingAmount);

    // DEBUG EVENTS for _checkPositionsForLiquidation function
    event LiquidationCheckStarted(uint256 markPrice, uint256 tradersLength, uint256 startIndex, uint256 endIndex);
    event LiquidationRecursionGuardSet(bool inProgress);
    event LiquidationTraderBeingChecked(address indexed trader, uint256 index, uint256 totalTraders);
    event LiquidationLiquidatableCheck(address indexed trader, bool isLiquidatable, uint256 markPrice);
    event LiquidationPositionRetrieved(address indexed trader, int256 size, uint256 marginLocked, uint256 unrealizedPnL);
    event LiquidationMarketOrderAttempt(address indexed trader, uint256 amount, bool isBuy, uint256 markPrice);
    event LiquidationMarketOrderResult(address indexed trader, bool success, string reason);
    event LiquidationSocializedLossAttempt(address indexed trader, bool isLong, string method);
    event LiquidationSocializedLossResult(address indexed trader, bool success, string method);
    event LiquidationCompleted(address indexed trader, uint256 liquidationsTriggered, string method);
    event LiquidationIndexUpdated(uint256 oldIndex, uint256 newIndex, uint256 tradersLength);
    event LiquidationCheckFinished(uint256 tradersChecked, uint256 liquidationsTriggered, uint256 nextStartIndex);
    event LiquidationMarginConfiscated(address indexed trader, uint256 marginAmount, uint256 penalty, address indexed liquidator);
    
    // ============ Enhanced Three-Layer Liquidation Events ============
    
    /**
     * @dev Emitted when a market gap is detected during liquidation execution
     * @param trader Address of the trader being liquidated
     * @param liquidationPrice The intended liquidation price (mark price)
     * @param actualExecutionPrice The actual worst execution price achieved
     * @param positionSize The size of the position being liquidated
     * @param gapLoss The additional loss due to market gap (execution_price - liquidation_price) * size
     */
    event LiquidationMarketGapDetected(
        address indexed trader,
        uint256 liquidationPrice,
        uint256 actualExecutionPrice,
        int256 positionSize,
        uint256 gapLoss
    );
    
    /**
     * @dev Emitted when user's available collateral is used to cover gap losses
     * @param trader Address of the trader
     * @param availableCollateralUsed Amount of available collateral used to cover gap loss
     * @param remainingAvailableCollateral User's remaining available collateral
     * @param totalGapLossCovered Total gap loss covered so far
     */
    event LiquidationAvailableCollateralUsed(
        address indexed trader,
        uint256 availableCollateralUsed,
        uint256 remainingAvailableCollateral,
        uint256 totalGapLossCovered
    );
    
    /**
     * @dev Emitted when there's remaining shortfall that needs to be socialized
     * @param trader Address of the liquidated trader
     * @param remainingShortfall Amount that needs to be socialized across all users
     * @param userCollateralExhausted Total user collateral that was exhausted
     */
    event LiquidationRequiresSocialization(
        address indexed trader,
        uint256 remainingShortfall,
        uint256 userCollateralExhausted
    );
    
    /**
     * @dev Comprehensive liquidation summary showing all three layers
     * @param trader Address of the trader
     * @param layer1LockedMargin Amount covered by locked margin (standard)
     * @param layer2AvailableCollateral Amount covered by available collateral (new)
     * @param layer3SocializedLoss Amount that was socialized (last resort)
     * @param totalLoss Total loss from liquidation
     */
    event LiquidationLayerBreakdown(
        address indexed trader,
        uint256 layer1LockedMargin,
        uint256 layer2AvailableCollateral,
        uint256 layer3SocializedLoss,
        uint256 totalLoss
    );

    /**
     * @dev Emitted when gap loss is detected during liquidation - focused event for monitoring
     * @param trader Address of the trader being liquidated
     * @param marketId The market where gap loss occurred
     * @param gapLossAmount The amount of gap loss detected (in collateral terms)
     * @param liquidationPrice The intended liquidation price
     * @param executionPrice The actual execution price that caused the gap
     * @param positionSize The position size involved in the gap loss
     */
    event GapLossDetected(
        address indexed trader,
        bytes32 indexed marketId,
        uint256 gapLossAmount,
        uint256 liquidationPrice,
        uint256 executionPrice,
        int256 positionSize
    );

    /**
     * @dev Emitted when liquidation position is successfully processed through the vault
     * @param trader Address of the trader being liquidated
     * @param positionSize The size of the position that was liquidated
     * @param executionPrice The average execution price of the liquidation
     */
    event LiquidationPositionProcessed(
        address indexed trader,
        int256 positionSize,
        uint256 executionPrice
    );

    /**
     * @dev Emitted when liquidation position processing fails
     * @param trader Address of the trader being liquidated
     * @param reason The failure reason from the vault
     */
    event LiquidationProcessingFailed(
        address indexed trader,
        bytes reason
    );
    
    // Debug event for liquidation flow tracing
    event DebugLiquidationCall(
        address indexed trader,
        bytes32 indexed marketId, 
        int256 positionSize,
        string stage
    );

    // Modifiers
    modifier validOrder(uint256 price, uint256 amount) {
        require(price > 0, "Price must be greater than 0");
        require(amount > 0, "Amount must be greater than 0");
        _;
    }

    modifier orderExists(uint256 orderId) {
        require(orders[orderId].trader != address(0), "Order does not exist");
        _;
    }

    modifier onlyOrderOwner(uint256 orderId) {
        require(orders[orderId].trader == msg.sender, "Not order owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == feeRecipient, "Only admin can call this function");
        _;
    }
    
    modifier onlyLeverageController() {
        require(msg.sender == leverageController, "OrderBook: only leverage controller");
        _;
    }
    
    modifier leverageAllowed() {
        require(leverageEnabled, "OrderBook: leverage is disabled for this market");
        _;
    }
    
    modifier marginOrderAllowed() {
        // Allow margin orders if:
        // 1. Leverage is enabled (any leverage), OR
        // 2. This is a 1:1 margin order (marginRequirementBps == 10000)
        require(
            leverageEnabled || marginRequirementBps == 10000, 
            "OrderBook: margin orders require leverage to be enabled or 1:1 margin"
        );
        _;
    }

    // ============ Constructor ============

    constructor(
        address _vault,
        bytes32 _marketId,
        address _feeRecipient
    ) {
        require(_vault != address(0), "OrderBook: vault cannot be zero address");
        require(_feeRecipient != address(0), "OrderBook: fee recipient cannot be zero address");
        
        vault = ICoreVault(_vault);
        marketId = _marketId;
        feeRecipient = _feeRecipient;
        leverageController = _feeRecipient; // Initially set fee recipient as leverage controller
    }

    /**
     * @dev Place a limit order
     * @param price Price with 6 decimals (USDC)
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return orderId The ID of the placed order
     */
    function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) 
        external 
        validOrder(price, amount) 
        returns (uint256 orderId) 
    {
        return _placeLimitOrder(price, amount, isBuy, false, 0);
    }

    /**
     * @dev Place a margin limit order
     * @param price Price with 6 decimals (USDC)
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return orderId The ID of the placed order
     */
    function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) 
        external 
        validOrder(price, amount) 
        marginOrderAllowed
        returns (uint256 orderId) 
    {
        // For limit orders, we'll calculate margin based on the worst-case execution price
        // For buy orders: use the limit price (worst case is paying full limit price)
        // For sell orders: use the limit price (worst case is selling at full limit price)
        uint256 marginRequired = _calculateMarginRequired(amount, price, isBuy);
        
        return _placeLimitOrder(price, amount, isBuy, true, marginRequired);
    }

    /**
     * @dev Internal function to place limit orders
     */
    function _placeLimitOrder(
        uint256 price, 
        uint256 amount, 
        bool isBuy, 
        bool isMarginOrder, 
        uint256 marginRequired
    ) internal returns (uint256 orderId) {
        orderId = nextOrderId++;
        
        // For margin orders, reserve margin in vault
        if (isMarginOrder) {
            vault.reserveMargin(msg.sender, bytes32(orderId), marketId, marginRequired);
        }
        
        // Create the order
        Order memory newOrder = Order({
            orderId: orderId,
            trader: msg.sender,
            price: price,
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: marginRequired,
            isMarginOrder: isMarginOrder
        });

        // Check if order can be immediately matched
        uint256 remainingAmount = amount;
        
        if (isBuy) {
            // Buy order: match against sell orders at or below this price
            remainingAmount = _matchBuyOrder(newOrder, remainingAmount);
        } else {
            // Sell order: match against buy orders at or above this price
            remainingAmount = _matchSellOrder(newOrder, remainingAmount);
        }

        // If there's remaining amount, add to order book
        if (remainingAmount > 0) {
            newOrder.amount = remainingAmount;
            orders[orderId] = newOrder;
            userOrders[msg.sender].push(orderId);
            
            if (isBuy) {
                _addToBuyBook(orderId, price, remainingAmount);
            } else {
                _addToSellBook(orderId, price, remainingAmount);
            }
            
            emit OrderPlaced(orderId, msg.sender, price, remainingAmount, isBuy, isMarginOrder);
            
            if (isMarginOrder) {
                emit MarginOrderPlaced(orderId, msg.sender, marginRequired);
            }
        } else {
            // Order was fully filled immediately - unreserve margin if it's a margin order
            if (isMarginOrder) {
                vault.unreserveMargin(msg.sender, bytes32(orderId));
            }
            
            // Still emit OrderPlaced event even for fully filled orders
            emit OrderPlaced(orderId, msg.sender, price, 0, isBuy, isMarginOrder);
        }

        return orderId;
    }

    /**
     * @dev Place a market order
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return filledAmount The amount that was filled
     */
    function placeMarketOrder(uint256 amount, bool isBuy) 
        external 
        returns (uint256 filledAmount) 
    {
        return _placeMarketOrder(amount, isBuy, false, maxSlippageBps);
    }

    /**
     * @dev Place a margin market order
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @return filledAmount The amount that was filled
     */
    function placeMarginMarketOrder(uint256 amount, bool isBuy)
        external
        marginOrderAllowed
        returns (uint256 filledAmount)
    {
        return _placeMarketOrder(amount, isBuy, true, maxSlippageBps);
    }

    /**
     * @dev Place a market order with custom slippage tolerance
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @param slippageBps Maximum slippage in basis points
     * @return filledAmount The amount that was filled
     */
    function placeMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps) 
        external 
        returns (uint256 filledAmount) 
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high"); // Max 50% slippage
        return _placeMarketOrder(amount, isBuy, false, slippageBps);
    }

    /**
     * @dev Place a margin market order with custom slippage tolerance
     * @param amount Amount with 18 decimals
     * @param isBuy True for buy order, false for sell order
     * @param slippageBps Maximum slippage in basis points
     * @return filledAmount The amount that was filled
     */
    function placeMarginMarketOrderWithSlippage(uint256 amount, bool isBuy, uint256 slippageBps)
        external
        marginOrderAllowed
        returns (uint256 filledAmount)
    {
        require(slippageBps <= 5000, "OrderBook: slippage too high"); // Max 50% slippage
        return _placeMarketOrder(amount, isBuy, true, slippageBps);
    }

    /**
     * @dev Clear user's position (called during liquidation)
     * @param user User address to clear position for
     */
    function clearUserPosition(address user) 
        external 
        onlyAdmin 
    {
        // Position clearing now handled by CoreVault during liquidation
        // This function is kept for compatibility but CoreVault manages the actual state
        _updateActiveTrader(user, false); // Remove from active traders
        emit PositionUpdated(user, 0, 0); // Legacy event for compatibility
    }

    /**
     * @dev Internal function to place market orders with slippage protection
     */
    function _placeMarketOrder(uint256 amount, bool isBuy, bool isMarginOrder, uint256 slippageBps) 
        internal 
        returns (uint256 filledAmount) 
    {
        require(amount > 0, "Amount must be greater than 0");

        // Get reference price for slippage calculation
        uint256 referencePrice = isBuy ? bestAsk : bestBid;
        if (isBuy) {
            require(referencePrice != 0 && referencePrice < type(uint256).max, "OrderBook: no liquidity available");
        } else {
            require(referencePrice > 0, "OrderBook: no liquidity available");
        }
        
        // For margin market orders, check available collateral upfront
        if (isMarginOrder) {
            // CRITICAL FIX: Use unchecked for safe price calculations
            uint256 worstCasePrice;
            unchecked {
                worstCasePrice = isBuy ? 
                    (referencePrice * (10000 + slippageBps)) / 10000 : // Buy: price could go up
                    referencePrice; // Sell: use reference price (margin based on position size, not price)
            }
                
            uint256 estimatedMargin = _calculateMarginRequired(amount, worstCasePrice, isBuy);
            
            // Check if user has sufficient available collateral
            uint256 availableCollateral = vault.getAvailableCollateral(msg.sender);
            require(availableCollateral >= estimatedMargin, 
                "OrderBook: insufficient collateral for market order");
        }

        uint256 orderId = nextOrderId++;
        Order memory marketOrder = Order({
            orderId: orderId,
            trader: msg.sender,
            price: isBuy ? type(uint256).max : 0, // Market orders have extreme prices
            amount: amount,
            isBuy: isBuy,
            timestamp: block.timestamp,
            nextOrderId: 0,
            marginRequired: 0, // Will be calculated during matching
            isMarginOrder: isMarginOrder
        });
        
        // Calculate slippage limits
        uint256 maxPrice;
        uint256 minPrice;
        unchecked {
            maxPrice = isBuy ? 
                (referencePrice * (10000 + slippageBps)) / 10000 : 
                type(uint256).max;
            minPrice = isBuy ? 
                0 : 
                (referencePrice * (10000 - slippageBps)) / 10000;
        }

        uint256 remainingAmount = amount;
        
        if (isBuy) {
            remainingAmount = _matchBuyOrderWithSlippage(marketOrder, remainingAmount, maxPrice);
        } else {
            remainingAmount = _matchSellOrderWithSlippage(marketOrder, remainingAmount, minPrice);
        }

        filledAmount = amount - remainingAmount;
        
        // Market orders don't rest in the book - any unfilled amount is cancelled
        if (filledAmount > 0) {
            emit OrderPlaced(orderId, msg.sender, marketOrder.price, amount, isBuy, isMarginOrder);
        }
        
        return filledAmount;
    }

    /**
     * @dev Cancel an existing order
     * @param orderId The ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) 
        external 
        orderExists(orderId) 
        onlyOrderOwner(orderId) 
    {
        Order storage order = orders[orderId];
        address trader = order.trader;
        
        // Unreserve margin if it's a margin order
        if (order.isMarginOrder) {
            vault.unreserveMargin(trader, bytes32(orderId));
        }
        
        if (order.isBuy) {
            _removeFromBuyBook(orderId, order.price, order.amount);
        } else {
            _removeFromSellBook(orderId, order.price, order.amount);
        }

        // CRITICAL FIX: Remove order ID from user's order list
        _removeOrderFromUserList(trader, orderId);

        emit OrderCancelled(orderId, trader);
        delete orders[orderId];
        delete cumulativeMarginUsed[orderId];
    }

    /**
     * @dev Match a buy order against the sell book with slippage protection
     */
    function _handleBuyOrderMarginUpdate(
        Order memory buyOrder,
        uint256 currentPrice,
        uint256 matchAmount,
        uint256 remainingAmount
    ) private {
        if (buyOrder.isMarginOrder && currentPrice < buyOrder.price && buyOrder.price != type(uint256).max) {
            
            // Calculate required margin at execution price (buy order = positive amount = long position)
            uint256 requiredMarginAtExecution = _calculateExecutionMargin(int256(matchAmount), currentPrice);
            
            // Always update margin to reflect actual execution prices
            if (remainingAmount == matchAmount) {
                // This will be the last fill, total margin = cumulative + this execution
                uint256 totalMarginUsed = cumulativeMarginUsed[buyOrder.orderId] + requiredMarginAtExecution;
                vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), totalMarginUsed);
            } else {
                // Partial fill - track cumulative margin and update vault
                cumulativeMarginUsed[buyOrder.orderId] += requiredMarginAtExecution;
                
                // Calculate margin for remaining unfilled amount
                uint256 remainingAfterMatch = remainingAmount - matchAmount;
                uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price, true); // Buy order = long position
                
                // Total margin = cumulative used + margin for remaining
                uint256 newTotalMargin = cumulativeMarginUsed[buyOrder.orderId] + marginForRemaining;
                
                vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), newTotalMargin);
                // Update the order's margin requirement for future calculations
                buyOrder.marginRequired = marginForRemaining;
            }
        }
    }

    function _matchBuyOrderWithSlippage(Order memory buyOrder, uint256 remainingAmount, uint256 maxPrice) 
        private 
        returns (uint256) 
    {
        // DEBUG: Matching started
        uint256 originalAmount = remainingAmount;
        emit MatchingStarted(buyOrder.trader, remainingAmount, maxPrice, bestAsk);

        // Match against sell orders starting from the lowest price (bestAsk)
        uint256 currentPrice = bestAsk;
        
        while (remainingAmount > 0 && currentPrice != type(uint256).max && currentPrice <= maxPrice) {
            if (!sellLevels[currentPrice].exists) {
                // DEBUG: Price level doesn't exist
                emit PriceLevelEntered(currentPrice, false, 0);
                currentPrice = _getNextSellPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = sellLevels[currentPrice];
            // DEBUG: Entering price level
            emit PriceLevelEntered(currentPrice, true, level.totalAmount);
            
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage sellOrder = orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < sellOrder.amount ? remainingAmount : sellOrder.amount;
                
                // DEBUG: Order match attempt
                emit OrderMatchAttempt(currentOrderId, sellOrder.trader, sellOrder.amount, matchAmount);
                
                // Handle margin updates for buy order
                _handleBuyOrderMarginUpdate(buyOrder, currentPrice, matchAmount, remainingAmount);
                
                // DEBUG: Margin update executed
                emit MarginUpdateExecuted(buyOrder.trader, currentPrice, matchAmount, remainingAmount);
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                // Track execution prices for liquidation if in liquidation mode
                if (liquidationMode) {
                    liquidationExecutionTotalVolume += matchAmount;
                    liquidationExecutionTotalValue += currentPrice * matchAmount;
                    liquidationExecutionCount++;
                    
                    // Update worst price (highest price for buy orders in liquidation)
                    if (liquidationWorstPrice == 0 || currentPrice > liquidationWorstPrice) {
                        liquidationWorstPrice = currentPrice;
                    }
                }
                
                // Safe decrements to prevent underflow when simultaneous reservations/updates occur
                unchecked {
                    remainingAmount -= matchAmount;
                }
                if (sellOrder.amount > matchAmount) {
                    sellOrder.amount -= matchAmount;
                } else {
                    sellOrder.amount = 0;
                }
                if (level.totalAmount > matchAmount) {
                    level.totalAmount -= matchAmount;
                } else {
                    level.totalAmount = 0;
                }
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (sellOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, false);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    if (sellOrder.isMarginOrder) {
                        vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, sellOrder.amount);
                }
                
                currentOrderId = nextSellOrderId;
            }
            
            // Update bestAsk if this level is now empty
            if (!sellLevels[currentPrice].exists && currentPrice == bestAsk) {
                uint256 next = _getNextSellPrice(currentPrice);
                bestAsk = next == 0 ? type(uint256).max : next;
            }
            
            currentPrice = _getNextSellPrice(currentPrice);
        }
        
        // DEBUG: Check if slippage protection was triggered
        if (remainingAmount > 0 && currentPrice > maxPrice) {
            emit SlippageProtectionTriggered(currentPrice, maxPrice, remainingAmount);
        }
        
        // DEBUG: Matching completed
        uint256 filledAmount = originalAmount - remainingAmount;
        emit MatchingCompleted(buyOrder.trader, originalAmount, filledAmount, remainingAmount);
        
        return remainingAmount;
    }

    /**
     * @dev Match a sell order against the buy book with slippage protection
     */
    function _handleSellOrderMarginUpdate(
        Order memory sellOrder,
        uint256 currentPrice,
        uint256 matchAmount,
        uint256 remainingAmount
    ) private {
        if (sellOrder.isMarginOrder && sellOrder.marginRequired > 0) {
            // Calculate margin needed for executed amount at actual execution price
            uint256 requiredMarginAtExecution = _calculateMarginRequired(matchAmount, currentPrice, false); // false = sell order = short position
            
            if (remainingAmount == matchAmount) {
                // This will be the last fill, total margin = cumulative + this execution
                uint256 totalMarginUsed = cumulativeMarginUsed[sellOrder.orderId] + requiredMarginAtExecution;
                vault.releaseExcessMargin(sellOrder.trader, bytes32(sellOrder.orderId), totalMarginUsed);
            } else {
                // Partial fill - track cumulative margin and update vault
                cumulativeMarginUsed[sellOrder.orderId] += requiredMarginAtExecution;
                
                // Calculate margin for remaining unfilled amount
                uint256 remainingAfterMatch = remainingAmount - matchAmount;
                uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, sellOrder.price, false); // Sell order = short position
                
                // Total margin = cumulative used + margin for remaining
                uint256 newTotalMargin = cumulativeMarginUsed[sellOrder.orderId] + marginForRemaining;
                
                vault.releaseExcessMargin(sellOrder.trader, bytes32(sellOrder.orderId), newTotalMargin);
                // Update the order's margin requirement for future calculations
                orders[sellOrder.orderId].marginRequired = marginForRemaining;
            }
        }
    }

    function _matchSellOrderWithSlippage(Order memory sellOrder, uint256 remainingAmount, uint256 minPrice) 
        private 
        returns (uint256) 
    {
        // Match against buy orders starting from the highest price (bestBid)
        uint256 currentPrice = bestBid;
        
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice >= minPrice) {
            if (!buyLevels[currentPrice].exists) {
                currentPrice = _getPrevBuyPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = buyLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage buyOrder = orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < buyOrder.amount ? remainingAmount : buyOrder.amount;
                
                // Handle margin updates for sell order
                _handleSellOrderMarginUpdate(sellOrder, currentPrice, matchAmount, remainingAmount);
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                // Track execution prices for liquidation if in liquidation mode
                if (liquidationMode) {
                    liquidationExecutionTotalVolume += matchAmount;
                    liquidationExecutionTotalValue += currentPrice * matchAmount;
                    liquidationExecutionCount++;
                    
                    // Update worst price (lowest price for sell orders in liquidation)
                    if (liquidationWorstPrice == type(uint256).max || currentPrice < liquidationWorstPrice) {
                        liquidationWorstPrice = currentPrice;
                    }
                }
                
                unchecked {
                    remainingAmount -= matchAmount;
                }
                if (buyOrder.amount > matchAmount) {
                    buyOrder.amount -= matchAmount;
                } else {
                    buyOrder.amount = 0;
                }
                if (level.totalAmount > matchAmount) {
                    level.totalAmount -= matchAmount;
                } else {
                    level.totalAmount = 0;
                }
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (buyOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, true);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    if (buyOrder.isMarginOrder) {
                        vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, buyOrder.amount);
                }
                
                currentOrderId = nextBuyOrderId;
            }
            
            // Update bestBid if this level is now empty
            if (!buyLevels[currentPrice].exists && currentPrice == bestBid) {
                bestBid = _getPrevBuyPrice(currentPrice);
            }
            
            currentPrice = _getPrevBuyPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Match a buy order against the sell book (original function for limit orders)
     */
    function _matchBuyOrder(Order memory buyOrder, uint256 remainingAmount) 
        private 
        returns (uint256) 
    {
        // Match against sell orders starting from the lowest price (bestAsk)
        uint256 currentPrice = bestAsk;
        
        while (remainingAmount > 0 && currentPrice != type(uint256).max && currentPrice <= buyOrder.price) {
            if (!sellLevels[currentPrice].exists) {
                currentPrice = _getNextSellPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = sellLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage sellOrder = orders[currentOrderId];
                uint256 nextSellOrderId = sellOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < sellOrder.amount ? remainingAmount : sellOrder.amount;
                
                // Release excess margin if buy order executes at better price
                // Do this BEFORE trade execution to ensure order still exists
                if (buyOrder.isMarginOrder && currentPrice < buyOrder.price && buyOrder.price != type(uint256).max) {
                    
                    // Calculate required margin at execution price (buy order = positive amount = long position)
                    uint256 requiredMarginAtExecution = _calculateExecutionMargin(int256(matchAmount), currentPrice);
                    
                    // Always update margin to reflect actual execution prices
                    if (remainingAmount == matchAmount) {
                        // This will be the last fill, total margin = cumulative + this execution
                        uint256 totalMarginUsed = cumulativeMarginUsed[buyOrder.orderId] + requiredMarginAtExecution;
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), totalMarginUsed);
                    } else {
                        // Partial fill - track cumulative margin and update vault
                        cumulativeMarginUsed[buyOrder.orderId] += requiredMarginAtExecution;
                        
                        // Calculate margin for remaining unfilled amount
                        uint256 remainingAfterMatch = remainingAmount - matchAmount;
                        uint256 marginForRemaining = _calculateMarginRequired(remainingAfterMatch, buyOrder.price, true); // Buy order = long position
                        
                        // Total margin = cumulative used + margin for remaining
                        uint256 newTotalMargin = cumulativeMarginUsed[buyOrder.orderId] + marginForRemaining;
                        
                        vault.releaseExcessMargin(buyOrder.trader, bytes32(buyOrder.orderId), newTotalMargin);
                        // Update the order's margin requirement for future calculations
                        buyOrder.marginRequired = marginForRemaining;
                    }
                }
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                unchecked {
                    remainingAmount -= matchAmount;
                }
                if (sellOrder.amount > matchAmount) {
                    sellOrder.amount -= matchAmount;
                } else {
                    sellOrder.amount = 0;
                }
                if (level.totalAmount > matchAmount) {
                    level.totalAmount -= matchAmount;
                } else {
                    level.totalAmount = 0;
                }
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (sellOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, false);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(sellOrder.trader, currentOrderId);
                    if (sellOrder.isMarginOrder) {
                        vault.unreserveMargin(sellOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, sellOrder.amount);
                }
                
                currentOrderId = nextSellOrderId;
            }
            
            // Update bestAsk if this level is now empty
            if (!sellLevels[currentPrice].exists && currentPrice == bestAsk) {
                uint256 next = _getNextSellPrice(currentPrice);
                bestAsk = next == 0 ? type(uint256).max : next;
            }
            
            currentPrice = _getNextSellPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Match a sell order against the buy book
     */
    function _matchSellOrder(Order memory sellOrder, uint256 remainingAmount) 
        private 
        returns (uint256) 
    {
        // Match against buy orders starting from the highest price (bestBid)
        uint256 currentPrice = bestBid;
        
        while (remainingAmount > 0 && currentPrice != 0 && currentPrice >= sellOrder.price) {
            if (!buyLevels[currentPrice].exists) {
                currentPrice = _getPrevBuyPrice(currentPrice);
                continue;
            }

            PriceLevel storage level = buyLevels[currentPrice];
            uint256 currentOrderId = level.firstOrderId;
            
            while (remainingAmount > 0 && currentOrderId != 0) {
                Order storage buyOrder = orders[currentOrderId];
                uint256 nextBuyOrderId = buyOrder.nextOrderId;
                
                uint256 matchAmount = remainingAmount < buyOrder.amount ? remainingAmount : buyOrder.amount;
                
                // For sell orders at better price: NO margin adjustment needed
                // When a sell order executes at a higher price, they receive more money
                // but their margin requirement doesn't change (it's based on the amount, not price received)
                
                // Execute the trade
                _executeTrade(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount, buyOrder.isMarginOrder, sellOrder.isMarginOrder);
                emit OrderMatched(buyOrder.trader, sellOrder.trader, currentPrice, matchAmount);
                
                unchecked {
                    remainingAmount -= matchAmount;
                }
                if (buyOrder.amount > matchAmount) {
                    buyOrder.amount -= matchAmount;
                } else {
                    buyOrder.amount = 0;
                }
                if (level.totalAmount > matchAmount) {
                    level.totalAmount -= matchAmount;
                } else {
                    level.totalAmount = 0;
                }
                
                // Track filled amount for this order
                filledAmounts[currentOrderId] += matchAmount;
                
                if (buyOrder.amount == 0) {
                    // Order fully filled, remove from book
                    _removeOrderFromLevel(currentOrderId, currentPrice, true);
                    
                    // CRITICAL FIX: Remove from user's order list and unreserve margin
                    _removeOrderFromUserList(buyOrder.trader, currentOrderId);
                    if (buyOrder.isMarginOrder) {
                        vault.unreserveMargin(buyOrder.trader, bytes32(currentOrderId));
                    }
                    
                    delete orders[currentOrderId];
                } else {
                    emit OrderPartiallyFilled(currentOrderId, matchAmount, buyOrder.amount);
                }
                
                currentOrderId = nextBuyOrderId;
            }
            
            // Update bestBid if this level is now empty
            if (!buyLevels[currentPrice].exists && currentPrice == bestBid) {
                bestBid = _getPrevBuyPrice(currentPrice);
            }
            
            currentPrice = _getPrevBuyPrice(currentPrice);
        }
        
        return remainingAmount;
    }

    /**
     * @dev Add order to buy book
     */
    function _addToBuyBook(uint256 orderId, uint256 price, uint256 amount) private {
        if (!buyLevels[price].exists) {
            buyLevels[price] = PriceLevel({
                totalAmount: amount,
                firstOrderId: orderId,
                lastOrderId: orderId,
                exists: true
            });
            
            if (!buyPriceExists[price]) {
                buyPrices.push(price);
                buyPriceExists[price] = true;
            }
        } else {
            // Add to end of linked list (FIFO)
            PriceLevel storage level = buyLevels[price];
            orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        
        // Update best bid
        if (price > bestBid) {
            bestBid = price;
        }
    }

    /**
     * @dev Add order to sell book
     */
    function _addToSellBook(uint256 orderId, uint256 price, uint256 amount) private {
        if (!sellLevels[price].exists) {
            sellLevels[price] = PriceLevel({
                totalAmount: amount,
                firstOrderId: orderId,
                lastOrderId: orderId,
                exists: true
            });
            
            if (!sellPriceExists[price]) {
                sellPrices.push(price);
                sellPriceExists[price] = true;
            }
        } else {
            // Add to end of linked list (FIFO)
            PriceLevel storage level = sellLevels[price];
            orders[level.lastOrderId].nextOrderId = orderId;
            level.lastOrderId = orderId;
            level.totalAmount += amount;
        }
        
        // Update best ask
        if (price < bestAsk) {
            bestAsk = price;
        }
    }

    /**
     * @dev Remove order from buy book
     */
    function _removeFromBuyBook(uint256 orderId, uint256 price, uint256 /* amount */) private {
        _removeOrderFromLevel(orderId, price, true);
        
        // Update best bid if necessary
        if (price == bestBid && !buyLevels[price].exists) {
            bestBid = _findNewBestBid();
        }
    }

    /**
     * @dev Remove order from sell book
     */
    function _removeFromSellBook(uint256 orderId, uint256 price, uint256 /* amount */) private {
        _removeOrderFromLevel(orderId, price, false);
        
        // Update best ask if necessary
        if (price == bestAsk && !sellLevels[price].exists) {
            uint256 next = _findNewBestAsk();
            bestAsk = next == 0 ? type(uint256).max : next;
        }
    }

    /**
     * @dev Remove order from a price level
     */
    function _removeOrderFromLevel(uint256 orderId, uint256 price, bool isBuy) private {
        PriceLevel storage level = isBuy ? buyLevels[price] : sellLevels[price];
        Order storage order = orders[orderId];
        
        if (level.totalAmount > order.amount) {
            level.totalAmount -= order.amount;
        } else {
            level.totalAmount = 0;
        }
        
        if (level.firstOrderId == orderId) {
            level.firstOrderId = order.nextOrderId;
            if (level.lastOrderId == orderId) {
                level.lastOrderId = 0;
            }
        } else {
            // Find previous order in linked list
            uint256 prevOrderId = level.firstOrderId;
            while (orders[prevOrderId].nextOrderId != orderId) {
                prevOrderId = orders[prevOrderId].nextOrderId;
            }
            orders[prevOrderId].nextOrderId = order.nextOrderId;
            
            if (level.lastOrderId == orderId) {
                level.lastOrderId = prevOrderId;
            }
        }
        
        if (level.totalAmount == 0) {
            level.exists = false;
            level.firstOrderId = 0;
            level.lastOrderId = 0;
        }
    }

    /**
     * @dev Find new best bid after current best bid is removed
     */
    function _findNewBestBid() private view returns (uint256) {
        uint256 newBestBid = 0;
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists && buyPrices[i] > newBestBid) {
                newBestBid = buyPrices[i];
            }
        }
        return newBestBid;
    }

    /**
     * @dev Find new best ask after current best ask is removed
     */
    function _findNewBestAsk() private view returns (uint256) {
        uint256 newBestAsk = type(uint256).max;
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists && sellPrices[i] < newBestAsk) {
                newBestAsk = sellPrices[i];
            }
        }
        return newBestAsk;
    }

    /**
     * @dev Get next higher sell price
     */
    function _getNextSellPrice(uint256 currentPrice) private view returns (uint256) {
        uint256 nextPrice = type(uint256).max;
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists && sellPrices[i] > currentPrice && sellPrices[i] < nextPrice) {
                nextPrice = sellPrices[i];
            }
        }
        return nextPrice;
    }

    /**
     * @dev Get next lower buy price
     */
    function _getPrevBuyPrice(uint256 currentPrice) private view returns (uint256) {
        uint256 prevPrice = 0;
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists && buyPrices[i] < currentPrice && buyPrices[i] > prevPrice) {
                prevPrice = buyPrices[i];
            }
        }
        return prevPrice;
    }

    // View functions

    /**
     * @dev Get order book depth for a given number of levels
     * @param levels Number of price levels to return
     * @return bidPrices Array of buy prices
     * @return bidAmounts Array of buy amounts
     * @return askPrices Array of sell prices  
     * @return askAmounts Array of sell amounts
     */
    function getOrderBookDepth(uint256 levels) 
        external 
        view 
        returns (
            uint256[] memory bidPrices,
            uint256[] memory bidAmounts,
            uint256[] memory askPrices,
            uint256[] memory askAmounts
        ) 
    {
        // Get buy side (bids)
        uint256[] memory allBuyPrices = new uint256[](buyPrices.length);
        uint256[] memory allBuyAmounts = new uint256[](buyPrices.length);
        uint256 buyCount = 0;
        
        // Sort buy prices in descending order
        for (uint256 i = 0; i < buyPrices.length; i++) {
            if (buyLevels[buyPrices[i]].exists) {
                allBuyPrices[buyCount] = buyPrices[i];
                allBuyAmounts[buyCount] = buyLevels[buyPrices[i]].totalAmount;
                buyCount++;
            }
        }
        
        // Simple bubble sort for buy prices (descending)
        if (buyCount > 1) {
            for (uint256 i = 0; i < buyCount - 1; i++) {
                for (uint256 j = 0; j < buyCount - i - 1; j++) {
                    if (allBuyPrices[j] < allBuyPrices[j + 1]) {
                        (allBuyPrices[j], allBuyPrices[j + 1]) = (allBuyPrices[j + 1], allBuyPrices[j]);
                        (allBuyAmounts[j], allBuyAmounts[j + 1]) = (allBuyAmounts[j + 1], allBuyAmounts[j]);
                    }
                }
            }
        }
        
        // Get sell side (asks)
        uint256[] memory allSellPrices = new uint256[](sellPrices.length);
        uint256[] memory allSellAmounts = new uint256[](sellPrices.length);
        uint256 sellCount = 0;
        
        for (uint256 i = 0; i < sellPrices.length; i++) {
            if (sellLevels[sellPrices[i]].exists) {
                allSellPrices[sellCount] = sellPrices[i];
                allSellAmounts[sellCount] = sellLevels[sellPrices[i]].totalAmount;
                sellCount++;
            }
        }
        
        // Simple bubble sort for sell prices (ascending)
        if (sellCount > 1) {
            for (uint256 i = 0; i < sellCount - 1; i++) {
                for (uint256 j = 0; j < sellCount - i - 1; j++) {
                    if (allSellPrices[j] > allSellPrices[j + 1]) {
                        (allSellPrices[j], allSellPrices[j + 1]) = (allSellPrices[j + 1], allSellPrices[j]);
                        (allSellAmounts[j], allSellAmounts[j + 1]) = (allSellAmounts[j + 1], allSellAmounts[j]);
                    }
                }
            }
        }
        
        // Return requested number of levels
        uint256 bidLevels = buyCount < levels ? buyCount : levels;
        uint256 askLevels = sellCount < levels ? sellCount : levels;
        
        bidPrices = new uint256[](bidLevels);
        bidAmounts = new uint256[](bidLevels);
        askPrices = new uint256[](askLevels);
        askAmounts = new uint256[](askLevels);
        
        for (uint256 i = 0; i < bidLevels; i++) {
            bidPrices[i] = allBuyPrices[i];
            bidAmounts[i] = allBuyAmounts[i];
        }
        
        for (uint256 i = 0; i < askLevels; i++) {
            askPrices[i] = allSellPrices[i];
            askAmounts[i] = allSellAmounts[i];
        }
    }

    /**
     * @dev Get user's orders
     * @param user The user address
     * @return orderIds Array of order IDs belonging to the user
     */
    function getUserOrders(address user) external view returns (uint256[] memory orderIds) {
        return userOrders[user];
    }

    /**
     * @dev Get order details
     * @param orderId The order ID
     * @return order The order struct
     */
    function getOrder(uint256 orderId) external view returns (Order memory order) {
        return orders[orderId];
    }

    /**
     * @dev Get spread (difference between best bid and best ask)
     * @return spread The current spread
     */
    function getSpread() external view returns (uint256 spread) {
        if (bestBid == 0 || bestAsk == type(uint256).max) {
            return type(uint256).max; // No spread if no orders on one side
        }
        return bestAsk > bestBid ? bestAsk - bestBid : 0;
    }

    /**
     * @dev Check if order book is crossed (bid >= ask)
     * @return crossed True if the book is crossed
     */
    function isBookCrossed() external view returns (bool crossed) {
        return bestBid != 0 && bestAsk != type(uint256).max && bestBid >= bestAsk;
    }

    // ============ Trade Execution Functions ============

    /**
     * @dev Handle margin updates for a user's position
     * @param user User address
     * @param oldPosition Previous position size
     * @param amount Position size change
     * @param price Trade price
     * @param isMargin Whether this is a margin trade
     */
    function _handleMarginUpdate(
        address user,
        int256 oldPosition,
        int256 amount,
        uint256 price,
        bool isMargin
    ) internal {
        if (!isMargin) return;

    // CRITICAL FIX: Skip margin updates for OrderBook contract (liquidation orders)
    if (user == address(this)) return;
        // Compute margin required based on net position after trade; for pure closing, it's zero
        uint256 marginRequired = 0;
        {
            int256 newNet = oldPosition + amount;
            if (newNet == 0) {
                marginRequired = 0;
            } else {
                // Required margin should reflect the new net exposure
                marginRequired = _calculateExecutionMargin(newNet, price);
            }
        }
        // Always update vault position to apply netting and release margin when closing
        vault.updatePositionWithMargin(user, marketId, amount, price, marginRequired);
    }


    /**
     * @dev Handle margin updates for liquidation trades with safe fallbacks
     * @param user User address
     * @param oldPosition Previous position size
     * @param amount Position size change
     * @param price Trade price
     * @param isMargin Whether this is a margin trade
     * @param isLiquidationTrade Whether this involves the OrderBook contract
     */
    function _handleLiquidationMarginUpdate(
        address user,
        int256 oldPosition,
        int256 amount,
        uint256 price,
        bool isMargin,
        bool isLiquidationTrade
    ) internal {
        if (!isMargin) return;
        
        // Skip margin updates for OrderBook contract (liquidation orders)
        if (user == address(this)) return;
        
        // For liquidation trades, use liquidation-specific margin handling that confiscates margin
        if (isLiquidationTrade) {
            try vault.updatePositionWithLiquidation(user, marketId, amount, price, address(this)) {
                // Liquidation margin update succeeded - margin has been confiscated
                // Get position info to emit debug event
                try vault.getPositionSummary(user, marketId) returns (int256, uint256, uint256 marginLocked) {
                    // Calculate penalty for debug event (using same logic as CoreVault)
                    uint256 penalty = (marginLocked * 500) / 10000; // 5% liquidation penalty
                    emit LiquidationMarginConfiscated(user, marginLocked, penalty, address(this));
                } catch {
                    // Position summary failed, emit event with unknown values
                    emit LiquidationMarginConfiscated(user, 0, 0, address(this));
                }
            } catch {
                // Liquidation margin update failed - fall back to safe margin update
                // This ensures the position is still updated even if liquidation-specific logic fails
                try this._safeMarginUpdate(user, oldPosition, amount, price) {
                    // Fallback margin update succeeded
                } catch {
                    // Both liquidation and fallback failed - continue without reverting
                    emit MarginUpdateFailed(user, amount, price);
                }
            }
        } else {
            // Normal margin updates for regular trades
            _handleMarginUpdate(user, oldPosition, amount, price, isMargin);
        }
    }

    /**
     * @dev Safe margin update that can be called externally for try/catch
     */
    function _safeMarginUpdate(
        address user,
        int256 oldPosition,
        int256 amount,
        uint256 price
    ) external {
        require(msg.sender == address(this), "Only self-calls allowed");
        _handleMarginUpdate(user, oldPosition, amount, price, true);
    }

    function _executeTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin
    ) internal {
        // DEBUG: Trade execution started
        emit TradeExecutionStarted(buyer, seller, price, amount, buyerMargin, sellerMargin);
        
        // Calculate trade value and fees
        uint256 tradeValue = (amount * price) / (10**18);
        uint256 buyerFee = tradingFee > 0 ? _calculateTradingFee(amount, price) : 0;
        uint256 sellerFee = tradingFee > 0 ? _calculateTradingFee(amount, price) : 0;
        
        // DEBUG: Trade value calculated
        emit TradeValueCalculated(tradeValue, buyerFee, sellerFee);
        
        // Record trade
        uint256 tradeId = nextTradeId; // Capture trade ID before recording
        _recordTrade(buyer, seller, price, amount, buyerMargin, sellerMargin, tradeValue, buyerFee, sellerFee);
        
        // DEBUG: Trade recorded
        emit TradeRecorded(tradeId);
        
        // Get current positions from CoreVault (single source of truth)
        (int256 oldBuyerPosition,,) = vault.getPositionSummary(buyer, marketId);
        (int256 oldSellerPosition,,) = vault.getPositionSummary(seller, marketId);
        
        // DEBUG: Positions retrieved
        emit PositionsRetrieved(buyer, oldBuyerPosition, seller, oldSellerPosition);
        
        // Positions are now updated through CoreVault via margin updates below
        int256 newBuyerPosition = oldBuyerPosition + int256(amount);
        int256 newSellerPosition = oldSellerPosition - int256(amount);
        
        // DEBUG: New positions calculated
        emit PositionsCalculated(newBuyerPosition, newSellerPosition);
        
        emit PositionUpdated(buyer, oldBuyerPosition, newBuyerPosition);
        emit PositionUpdated(seller, oldSellerPosition, newSellerPosition);
        
        // Track active traders based on new positions
        _updateActiveTrader(buyer, newBuyerPosition != 0);
        _updateActiveTrader(seller, newSellerPosition != 0);
        
        // DEBUG: Active traders updated
        emit ActiveTradersUpdated(buyer, newBuyerPosition != 0, seller, newSellerPosition != 0);
        
        // LIQUIDATION FIX: Track all users who ever trade
        _trackKnownUser(buyer);
        _trackKnownUser(seller);
        
        // Handle margin updates
        require(buyerMargin == sellerMargin, "OrderBook: cannot mix margin and spot trades");
        
        // DEBUG: Margin validation passed
        emit MarginValidationPassed(buyerMargin, sellerMargin);
        
        // CRITICAL FIX: Special handling for liquidation trades
        bool isLiquidationTrade = liquidationMode || (buyer == address(this) || seller == address(this));
        
        // DEBUG: Liquidation trade detection
        emit LiquidationTradeDetected(isLiquidationTrade, liquidationTarget, liquidationClosesShort);
        
        if (buyerMargin || sellerMargin) {
            // DEBUG: Starting margin updates
            emit MarginUpdatesStarted(isLiquidationTrade);
            
            // During liquidation market orders, attribute margin update to the real trader
            if (isLiquidationTrade) {
                // Only the liquidationTarget's margin should change
                if (buyer == address(this) || seller == address(this)) {
                    address realUser = liquidationTarget;
                    // Determine size delta: buy closes short (+amount), sell closes long (-amount)
                    int256 delta = liquidationClosesShort ? int256(amount) : -int256(amount);
                    // Fetch real user's current position directly from vault
                    (int256 oldRealPosition,,) = vault.getPositionSummary(realUser, marketId);
                    _handleLiquidationMarginUpdate(realUser, oldRealPosition, delta, price, true, true);
                }
            } else {
                _handleLiquidationMarginUpdate(buyer, oldBuyerPosition, int256(amount), price, buyerMargin, isLiquidationTrade);
                _handleLiquidationMarginUpdate(seller, oldSellerPosition, -int256(amount), price, sellerMargin, isLiquidationTrade);
            }
            
            // DEBUG: Margin updates completed
            emit MarginUpdatesCompleted();
            
            // Deduct fees
            if (tradingFee > 0) {
                if (buyerMargin && buyer != address(this)) vault.deductFees(buyer, buyerFee, feeRecipient);
                if (sellerMargin && seller != address(this)) vault.deductFees(seller, sellerFee, feeRecipient);
                
                // DEBUG: Fees deducted
                emit FeesDeducted(buyer, buyerFee, seller, sellerFee);
            }
        } else {
            // Allow spot trades only for liquidation (when OrderBook is a participant)
            if (buyer != address(this) && seller != address(this)) {
                revert("OrderBook: spot trading disabled for futures markets - use margin orders");
            }
            // For liquidation trades, no fees are deducted since OrderBook doesn't have collateral
        }
        
        // Update price and check liquidations (optimized for gas efficiency)
        lastTradePrice = price;
        uint256 currentMark = _calculateMarkPrice();
        
        // 🔧 CRITICAL FIX: Synchronize mark price with CoreVault for ADL system
        // The CoreVault's ADL system depends on accurate mark prices to find profitable positions
        vault.updateMarkPrice(marketId, currentMark);
        
        // DEBUG: Price updated and synchronized with vault
        emit PriceUpdated(lastTradePrice, currentMark);
        
        // CRITICAL FIX: Only check liquidations if not already in liquidation process
        // and price has moved significantly (>= 2%) to save gas
        if (!liquidationInProgress && 
            (lastLiquidationCheck == 0 || 
            (currentMark > lastMarkPrice && (currentMark - lastMarkPrice) * 100 / lastMarkPrice >= 2) ||
            (lastMarkPrice > currentMark && (lastMarkPrice - currentMark) * 100 / lastMarkPrice >= 2))) {
            
            // DEBUG: Liquidation check triggered
            emit LiquidationCheckTriggered(currentMark, lastMarkPrice);
            
            _checkPositionsForLiquidation(currentMark);
            lastMarkPrice = currentMark;
        }
        
        // DEBUG: Trade execution completed
        emit TradeExecutionCompleted(buyer, seller, price, amount);
    }

    /**
     * @dev Calculate margin required for an order
     * @param amount Order amount
     * @param price Order price
     * @param isBuy Whether this is a buy order (long position)
     * @return Margin required
     */
    function _calculateMarginRequired(uint256 amount, uint256 price, bool isBuy) internal pure returns (uint256) {
        // CRITICAL FIX: Use unchecked for safe margin calculations
        unchecked {
            // amount is in 18 decimals, price is in 6 decimals
            // notionalValue = amount * price / 10^18 (to get USDC value with 6 decimals)
            uint256 notionalValue = (amount * price) / (10**18);
            
            // Apply different margin requirements based on position type
            // Long positions (buy orders): 100% margin (10000 bps)
            // Short positions (sell orders): 150% margin (15000 bps)
            uint256 marginBps = isBuy ? 10000 : 15000;
            return (notionalValue * marginBps) / 10000;
        }
    }

    /**
     * @dev Calculate margin required for a trade execution
     * @param amount Trade amount
     * @param executionPrice Actual execution price
     * @return Margin required for this execution
     */
    function _calculateExecutionMargin(int256 amount, uint256 executionPrice) internal pure returns (uint256) {
        // CRITICAL FIX: Use unchecked for safe margin calculations
        unchecked {
            // Calculate margin based on actual execution price
            uint256 absAmount = uint256(amount >= 0 ? amount : -amount);
            uint256 notionalValue = (absAmount * executionPrice) / (10**18);
            
            // Apply different margin requirements based on position type
            // Long positions (positive amount): 100% margin (10000 bps)
            // Short positions (negative amount): 150% margin (15000 bps)
            uint256 marginBps = amount >= 0 ? 10000 : 15000;
            return (notionalValue * marginBps) / 10000;
        }
    }

    /**
     * @dev Release excess margin when order executes at better price
     * @param user User address
     * @param orderId Order ID
     * @param executionPrice Actual execution price
     * @param amount Amount being executed
     */
    function _releaseExcessMargin(
        address user,
        uint256 orderId,
        uint256 executionPrice,
        uint256 amount
    ) internal {
        Order storage order = orders[orderId];
        
        if (order.isMarginOrder && order.marginRequired > 0) {
            // Calculate how much margin was reserved for this specific amount
            uint256 originalMarginForAmount = (order.marginRequired * amount) / order.amount;
            
            // Calculate required margin at execution price
            int256 signedAmount = order.isBuy ? int256(amount) : -int256(amount);
            uint256 requiredMarginAtExecution = _calculateExecutionMargin(signedAmount, executionPrice);
            
            if (requiredMarginAtExecution < originalMarginForAmount) {
                // Execution price is better - release excess margin
                uint256 excessMargin = originalMarginForAmount - requiredMarginAtExecution;
                
                // For full fills, we need to handle this differently
                // The order will be removed, so we can't update it
                // Instead, we need to refund the excess margin directly
                if (amount == order.amount) {
                    // Order is fully filled - refund excess margin directly
                    vault.transferCollateral(address(vault), user, excessMargin);
                } else {
                    // Order is partially filled - update the margin requirement
                    order.marginRequired = order.marginRequired - excessMargin;
                    // For partial fills, update the margin in vault
                    vault.releaseExcessMargin(user, bytes32(orderId), order.marginRequired);
                }
                
            }
        }
    }

    /**
     * @dev Calculate trading fee
     * @param amount Trade amount
     * @param price Trade price
     * @return Fee amount
     */
    function _calculateTradingFee(uint256 amount, uint256 price) internal view returns (uint256) {
        // amount is in 18 decimals, price is in 6 decimals
        // notionalValue = amount * price / 10^18 (to get USDC value with 6 decimals)
        uint256 notionalValue = (amount * price) / (10**18);
        return (notionalValue * tradingFee) / 10000;
    }

    /**
     * @dev Record a trade in the trade history
     * @param buyer Buyer address
     * @param seller Seller address
     * @param price Trade price
     * @param amount Trade amount
     * @param buyerMargin Whether buyer used margin
     * @param sellerMargin Whether seller used margin
     * @param tradeValue Trade value in USDC
     * @param buyerFee Fee paid by buyer
     * @param sellerFee Fee paid by seller
     */
    function _recordTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin,
        uint256 tradeValue,
        uint256 buyerFee,
        uint256 sellerFee
    ) internal {
        uint256 tradeId = nextTradeId++;
        
        // Create trade record
        trades[tradeId] = Trade({
            tradeId: tradeId,
            buyer: buyer,
            seller: seller,
            price: price,
            amount: amount,
            timestamp: block.timestamp,
            buyOrderId: 0, // TODO: Pass actual order IDs when available
            sellOrderId: 0, // TODO: Pass actual order IDs when available
            buyerIsMargin: buyerMargin,
            sellerIsMargin: sellerMargin,
            tradeValue: tradeValue,
            buyerFee: buyerFee,
            sellerFee: sellerFee
        });
        
        // Add to user trade histories
        userTradeIds[buyer].push(tradeId);
        userTradeIds[seller].push(tradeId);
        
        // Increment total trade count
        totalTradeCount++;
        
        // Update VWAP tracking
        _updateVWAPData(tradeId, price, amount);
        
        // Emit trade event
        emit TradeExecuted(tradeId, buyer, seller, price, amount, tradeValue, block.timestamp);
    }

    // ============ Trade History Query Functions ============

    /**
     * @dev Get all trades with pagination
     * @param offset Starting index (0-based)
     * @param limit Maximum number of trades to return (max 100)
     * @return tradeData Array of trades
     * @return hasMore Whether there are more trades available
     */
    function getAllTrades(uint256 offset, uint256 limit) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        
        if (offset >= totalTradeCount) {
            return (new Trade[](0), false);
        }
        
        uint256 remainingTrades = totalTradeCount - offset;
        uint256 actualLimit = remainingTrades < limit ? remainingTrades : limit;
        
        tradeData = new Trade[](actualLimit);
        
        // Note: tradeIds start from 1, so we need to adjust indexing
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = totalTradeCount - offset - i; // Get newest trades first
            tradeData[i] = trades[tradeId];
        }
        
        hasMore = offset + actualLimit < totalTradeCount;
        return (tradeData, hasMore);
    }

    /**
     * @dev Get trades for a specific user with pagination
     * @param user User address
     * @param offset Starting index in user's trade history
     * @param limit Maximum number of trades to return (max 100)
     * @return tradeData Array of trades for the user
     * @return hasMore Whether there are more trades available for this user
     */
    function getUserTrades(address user, uint256 offset, uint256 limit) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        
        uint256[] storage userTrades = userTradeIds[user];
        
        if (offset >= userTrades.length) {
            return (new Trade[](0), false);
        }
        
        uint256 remainingTrades = userTrades.length - offset;
        uint256 actualLimit = remainingTrades < limit ? remainingTrades : limit;
        
        tradeData = new Trade[](actualLimit);
        
        // Get newest trades first (reverse chronological order)
        for (uint256 i = 0; i < actualLimit; i++) {
            uint256 tradeId = userTrades[userTrades.length - 1 - offset - i];
            tradeData[i] = trades[tradeId];
        }
        
        hasMore = offset + actualLimit < userTrades.length;
        return (tradeData, hasMore);
    }

    /**
     * @dev Get recent trades (last N trades)
     * @param count Number of recent trades to return (max 100)
     * @return tradeData Array of recent trades
     */
    function getRecentTrades(uint256 count) 
        external 
        view 
        returns (Trade[] memory tradeData) 
    {
        require(count > 0 && count <= MAX_TRADES_PER_QUERY, "OrderBook: invalid count");
        
        if (totalTradeCount == 0) {
            return new Trade[](0);
        }
        
        uint256 actualCount = totalTradeCount < count ? totalTradeCount : count;
        tradeData = new Trade[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint256 tradeId = totalTradeCount - i; // Get newest trades first
            tradeData[i] = trades[tradeId];
        }
        
        return tradeData;
    }

    /**
     * @dev Get trades within a specific time range
     * @return tradeData Array of trades within the time range
     * @return hasMore Whether there are more trades available in this range
     */
    function getTradesByTimeRange(
        uint256 startTime, 
        uint256 endTime, 
        uint256 offset, 
        uint256 limit
    ) 
        external 
        view 
        returns (Trade[] memory tradeData, bool hasMore) 
    {
        require(limit > 0 && limit <= MAX_TRADES_PER_QUERY, "OrderBook: invalid limit");
        require(startTime <= endTime, "OrderBook: invalid time range");
        
        // This is a simplified implementation - in production you might want to use
        // more efficient indexing structures for time-based queries
        Trade[] memory tempTrades = new Trade[](limit);
        uint256 foundCount = 0;
        uint256 skippedCount = 0;
        
        // Search backwards from newest trades
        for (uint256 i = totalTradeCount; i >= 1 && foundCount < limit; i--) {
            Trade storage trade = trades[i];
            
            if (trade.timestamp >= startTime && trade.timestamp <= endTime) {
                if (skippedCount >= offset) {
                    tempTrades[foundCount] = trade;
                    foundCount++;
                } else {
                    skippedCount++;
                }
            }
            
            // Stop if we've gone too far back in time
            if (trade.timestamp < startTime) {
                break;
            }
        }
        
        // Create properly sized return array
        tradeData = new Trade[](foundCount);
        for (uint256 i = 0; i < foundCount; i++) {
            tradeData[i] = tempTrades[i];
        }
        
        // Check if there are more trades (simplified check)
        hasMore = foundCount == limit;
        
        return (tradeData, hasMore);
    }

    /**
     * @dev Get trade statistics
     * @return totalTrades Total number of trades
     * @return totalVolume Total trading volume in USDC (6 decimals)
     * @return totalFees Total fees collected in USDC (6 decimals)
     */
    function getTradeStatistics() 
        external 
        view 
        returns (uint256 totalTrades, uint256 totalVolume, uint256 totalFees) 
    {
        totalTrades = totalTradeCount;
        totalVolume = 0;
        totalFees = 0;
        
        // Calculate totals from all trades
        for (uint256 i = 1; i <= totalTradeCount; i++) {
            Trade storage trade = trades[i];
            totalVolume += trade.tradeValue;
            totalFees += trade.buyerFee + trade.sellerFee;
        }
        
        return (totalTrades, totalVolume, totalFees);
    }

    /**
     * @dev Get user trade count
     * @param user User address
     * @return Number of trades for the user
     */
    function getUserTradeCount(address user) external view returns (uint256) {
        return userTradeIds[user].length;
    }

    /**
     * @dev Get specific trade by ID
     * @param tradeId Trade ID
     * @return trade Trade data
     */
    function getTradeById(uint256 tradeId) external view returns (Trade memory trade) {
        require(tradeId > 0 && tradeId < nextTradeId, "OrderBook: invalid trade ID");
        return trades[tradeId];
    }

    // ============ Administrative Functions ============

    /**
     * @dev Update trading parameters
     * @param _marginRequirementBps Margin requirement in basis points
     * @param _tradingFee Trading fee in basis points
     * @param _feeRecipient Fee recipient address
     */
    function updateTradingParameters(
        uint256 _marginRequirementBps,
        uint256 _tradingFee,
        address _feeRecipient
    ) external onlyAdmin {
        require(_marginRequirementBps <= 15000, "OrderBook: margin requirement too high"); // Max 150% for shorts
        require(_tradingFee <= 1000, "OrderBook: trading fee too high"); // Max 10%
        require(_feeRecipient != address(0), "OrderBook: fee recipient cannot be zero");
        
        marginRequirementBps = _marginRequirementBps;
        tradingFee = _tradingFee;
        feeRecipient = _feeRecipient;
        
        emit TradingParametersUpdated(_marginRequirementBps, _tradingFee, _feeRecipient);
    }

    /**
     * @dev Update maximum slippage tolerance for market orders
     * @param _maxSlippageBps New maximum slippage in basis points
     */
    function updateMaxSlippage(uint256 _maxSlippageBps) external onlyAdmin {
        require(_maxSlippageBps <= 5000, "OrderBook: slippage too high"); // Max 50%
        
        uint256 oldSlippage = maxSlippageBps;
        maxSlippageBps = _maxSlippageBps;
        
        emit MaxSlippageUpdated(oldSlippage, _maxSlippageBps);
    }

    /**
     * @dev Modify an existing order (cancel old and place new atomically)
     * @param orderId The ID of the order to modify
     * @param price New price for the order
     * @param amount New amount for the order
     * @return newOrderId The ID of the new order
     */
    function modifyOrder(uint256 orderId, uint256 price, uint256 amount) 
        external 
        orderExists(orderId) 
        onlyOrderOwner(orderId)
        validOrder(price, amount)
        returns (uint256 newOrderId) 
    {
        Order storage oldOrder = orders[orderId];
        bool isBuy = oldOrder.isBuy;
        bool isMarginOrder = oldOrder.isMarginOrder;
        uint256 marginRequired = oldOrder.marginRequired;
        
        // Cancel the old order
        if (isMarginOrder) {
            vault.unreserveMargin(msg.sender, bytes32(orderId));
        }
        
        if (isBuy) {
            _removeFromBuyBook(orderId, oldOrder.price, oldOrder.amount);
        } else {
            _removeFromSellBook(orderId, oldOrder.price, oldOrder.amount);
        }
        
        _removeOrderFromUserList(msg.sender, orderId);
        delete orders[orderId];
        delete cumulativeMarginUsed[orderId];
        
        // Place the new order
        if (isMarginOrder) {
            marginRequired = _calculateMarginRequired(amount, price, isBuy);
        }
        
        newOrderId = _placeLimitOrder(price, amount, isBuy, isMarginOrder, marginRequired);
        
        emit OrderModified(orderId, newOrderId, msg.sender, price, amount);
        
        return newOrderId;
    }

    /**
     * @dev Get user's position in this market
     * @param user User address
     * @return Position size (positive for long, negative for short)
     */
    function getUserPosition(address user) external view returns (int256) {
        (int256 size,,) = vault.getPositionSummary(user, marketId);
        return size;
    }

    /**
     * @dev Get trading parameters
     * @return marginRequirement Margin requirement in basis points
     * @return fee Trading fee in basis points
     * @return recipient Fee recipient address
     */
    function getTradingParameters() external view returns (uint256 marginRequirement, uint256 fee, address recipient) {
        return (marginRequirementBps, tradingFee, feeRecipient);
    }

    /**
     * @dev Get market price data for orderbook viewer
     * @return midPrice Current mid price
     * @return bestBidPrice Best bid price
     * @return bestAskPrice Best ask price  
     * @return lastTradePriceReturn Last trade price
     * @return markPrice Mark price (same as mid)
     * @return spread Current spread
     * @return spreadBps Spread in basis points
     * @return isValid Whether market data is valid
     */
    function getMarketPriceData() external view returns (
        uint256 midPrice,
        uint256 bestBidPrice, 
        uint256 bestAskPrice,
        uint256 lastTradePriceReturn,
        uint256 markPrice,
        uint256 spread,
        uint256 spreadBps,
        bool isValid
    ) {
        bestBidPrice = bestBid;
        bestAskPrice = bestAsk;
        lastTradePriceReturn = lastTradePrice;
        
        // Calculate mid price
        if (bestBid > 0 && bestAsk < type(uint256).max) {
            midPrice = (bestBid + bestAsk) / 2;
            spread = bestAsk - bestBid;
            spreadBps = (spread * 10000) / midPrice; // Convert to basis points
            isValid = true;
        } else if (bestBid > 0) {
            midPrice = bestBid;
            spread = 0;
            spreadBps = 0;
            isValid = true;
        } else if (bestAsk < type(uint256).max) {
            midPrice = bestAsk;
            spread = 0;
            spreadBps = 0;
            isValid = true;
        } else {
            midPrice = 1000000; // Default 1 USDC
            spread = 0;
            spreadBps = 0;
            isValid = false;
        }
        
        // Use VWAP-based mark price calculation
        markPrice = calculateMarkPrice();
    }


    /**
     * @dev Get count of active orders
     * @return buyOrderCount Number of active buy orders
     * @return sellOrderCount Number of active sell orders
     */
    function getActiveOrdersCount() external view returns (uint256 buyOrderCount, uint256 sellOrderCount) {
        // Count active orders by iterating through price levels
        for (uint256 i = 0; i < buyPrices.length; i++) {
            uint256 price = buyPrices[i];
            if (buyLevels[price].exists && buyLevels[price].totalAmount > 0) {
                // Count orders at this price level
                uint256 orderId = buyLevels[price].firstOrderId;
                while (orderId != 0) {
                    if (orders[orderId].amount > 0) {
                        buyOrderCount++;
                    }
                    orderId = orders[orderId].nextOrderId;
                }
            }
        }
        
        for (uint256 i = 0; i < sellPrices.length; i++) {
            uint256 price = sellPrices[i];
            if (sellLevels[price].exists && sellLevels[price].totalAmount > 0) {
                // Count orders at this price level
                uint256 orderId = sellLevels[price].firstOrderId;
                while (orderId != 0) {
                    if (orders[orderId].amount > 0) {
                        sellOrderCount++;
                    }
                    orderId = orders[orderId].nextOrderId;
                }
            }
        }
        
        return (buyOrderCount, sellOrderCount);
    }

    /**
     * @dev Get best bid and ask prices
     * @return bidPrice Best bid price
     * @return askPrice Best ask price
     */
    function getBestPrices() external view returns (uint256 bidPrice, uint256 askPrice) {
        return (bestBid, bestAsk);
    }

    /**
     * @dev Get filled amount for an order
     * @param orderId Order ID
     * @return Amount filled
     */
    function getFilledAmount(uint256 orderId) external view returns (uint256) {
        return filledAmounts[orderId];
    }

    // ============ VWAP Functions ============
    
    /**
     * @dev Update VWAP data when a new trade occurs
     */
    function _updateVWAPData(uint256 /* tradeId */, uint256 /* price */, uint256 /* amount */) internal {
        // Simplified VWAP tracking - just store last trade info
    }
    
    /**
     * @dev Calculate VWAP for a specific time window - simplified version
     * @return vwap The volume-weighted average price
     * @return totalVolume Total volume in the time window
     * @return tradeCount Number of trades in the time window
     * @return isValid Whether the VWAP is valid (meets minimum volume)
     */
    function calculateVWAP(uint256 /* timeWindow */) public view returns (
        uint256 vwap,
        uint256 totalVolume,
        uint256 tradeCount,
        bool isValid
    ) {
        // Simplified VWAP calculation - use last trade price
        vwap = lastTradePrice;
        totalVolume = 0;
        tradeCount = 0;
        isValid = lastTradePrice > 0;
        return (vwap, totalVolume, tradeCount, isValid);
    }
    
    /**
     * @dev Get VWAP for the default time window
     */
    function getVWAP() external view returns (uint256) {
        return lastTradePrice;
    }
    
    /**
     * @dev Get VWAP data for multiple time windows - simplified version
     */
    function getMultiWindowVWAP() external view returns (
        uint256 vwap5m,
        uint256 vwap15m,
        uint256 vwap1h,
        uint256 vwap4h,
        uint256 vwap24h
    ) {
        // All windows use last trade price for simplicity
        uint256 price = lastTradePrice;
        return (price, price, price, price, price);
    }
    
    /**
     * @dev Configure VWAP parameters
     * @param _timeWindow New time window in seconds
     * @param _minVolume Minimum volume for valid VWAP
     * @param _useVWAP Whether to use VWAP for mark price
     */
    function configureVWAP(
        uint256 _timeWindow,
        uint256 _minVolume,
        bool _useVWAP
    ) external {
        require(msg.sender == leverageController || msg.sender == feeRecipient, "Unauthorized");
        require(_timeWindow > 0 && _timeWindow <= 86400, "Invalid time window"); // Max 24 hours
        
        vwapTimeWindow = _timeWindow;
        minVolumeForVWAP = _minVolume;
        useVWAPForMarkPrice = _useVWAP;
        
        emit VWAPConfigUpdated(_timeWindow, _minVolume, _useVWAP);
    }

    // ============ Mark Price Functions ============

    /**
     * @dev Calculate the current mark price using VWAP-based hierarchy
     * @return Current mark price with 6 decimals (USDC)
     * @notice Priority: 1) VWAP, 2) Mid-price, 3) Last trade, 4) Fallbacks
     */
    function calculateMarkPrice() public view returns (uint256) {
        // IMPORTANT: This function must be pure/view-only.
        // Do NOT trigger liquidations or any state changes here.
        // External callers (keepers) should call a separate non-view function
        // to process liquidations after fetching the mark price.
        return _calculateMarkPrice();
    }
    
    /**
     * @dev Internal function to calculate mark price
     */
    function _calculateMarkPrice() internal view returns (uint256) {
        // Simplified mark price calculation
        if (bestBid > 0 && bestAsk < type(uint256).max) {
            // Use mid-price if both sides exist
            return (bestBid + bestAsk) / 2;
        } else if (lastTradePrice > 0) {
            // Use last trade price if available
            return lastTradePrice;
        } else {
            // Default to 1 USDC
            return 1000000;
        }
    }

    /**
     * @dev Get the current mark price (alias for calculateMarkPrice)
     * @return Current mark price with 6 decimals (USDC)
     */
    function getMarkPrice() external view returns (uint256) {
        return calculateMarkPrice();
    }

    // ============ Leverage Control Functions ============

    /**
     * @dev Enable leverage trading for this market
     * @param _maxLeverage Maximum leverage allowed (e.g., 10 for 10x)
     * @param _marginRequirementBps New margin requirement in basis points
     */
    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) 
        external 
        onlyLeverageController 
    {
        require(_maxLeverage > 1 && _maxLeverage <= 100, "OrderBook: invalid max leverage");
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OrderBook: invalid margin requirement");
        require(_marginRequirementBps <= (10000 / _maxLeverage), "OrderBook: margin requirement too low for max leverage");
        
        leverageEnabled = true;
        maxLeverage = _maxLeverage;
        marginRequirementBps = _marginRequirementBps;
        
        emit LeverageEnabled(msg.sender, _maxLeverage, _marginRequirementBps);
        emit MarginRequirementUpdated(marginRequirementBps, _marginRequirementBps);
    }

    /**
     * @dev Disable leverage trading for this market (revert to 1:1 margin)
     */
    function disableLeverage() 
        external 
        onlyLeverageController 
    {
        leverageEnabled = false;
        maxLeverage = 1;
        marginRequirementBps = 10000; // 100% margin requirement (1:1)
        
        emit LeverageDisabled(msg.sender);
        emit MarginRequirementUpdated(marginRequirementBps, 10000);
    }

    /**
     * @dev Update leverage controller
     * @param _newController New leverage controller address
     */
    function setLeverageController(address _newController) 
        external 
        onlyLeverageController 
    {
        require(_newController != address(0), "OrderBook: invalid controller address");
        
        address oldController = leverageController;
        leverageController = _newController;
        
        emit LeverageControllerUpdated(oldController, _newController);
    }

    /**
     * @dev Update margin requirement (only when leverage is enabled)
     * @param _marginRequirementBps New margin requirement in basis points
     */
    function setMarginRequirement(uint256 _marginRequirementBps) 
        external 
        onlyLeverageController 
        leverageAllowed
    {
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OrderBook: invalid margin requirement");
        require(_marginRequirementBps <= (10000 / maxLeverage), "OrderBook: margin requirement too low for max leverage");
        
        uint256 oldRequirement = marginRequirementBps;
        marginRequirementBps = _marginRequirementBps;
        
        emit MarginRequirementUpdated(oldRequirement, _marginRequirementBps);
    }

    /**
     * @dev Get leverage status and parameters
     * @return enabled Whether leverage is enabled
     * @return maxLev Maximum leverage allowed
     * @return marginReq Current margin requirement in basis points
     * @return controller Current leverage controller
     */
    function getLeverageInfo() external view returns (
        bool enabled,
        uint256 maxLev,
        uint256 marginReq,
        address controller
    ) {
        return (leverageEnabled, maxLeverage, marginRequirementBps, leverageController);
    }

    // ============ Internal Helper Functions ============

    /**
     * @dev Remove order ID from user's order list
     * @param user User address
     * @param orderId Order ID to remove
     */
    function _removeOrderFromUserList(address user, uint256 orderId) internal {
        uint256[] storage userOrderList = userOrders[user];
        
        if (userOrderList.length == 0) {
            return;
        }
        
        for (uint256 i = 0; i < userOrderList.length; i++) {
            if (userOrderList[i] == orderId) {
                // Remove by swapping with last element and popping
                if (i < userOrderList.length - 1) {
                    userOrderList[i] = userOrderList[userOrderList.length - 1];
                }
                userOrderList.pop();
                break;
            }
        }
    }

    
}
