# HyperLiquid V2 - Multi-Contract Architecture Mapping Guide

## Overview
This document serves as a comprehensive navigation map for the HyperLiquid V2 system, which has evolved from the original `OrderBook.sol` monolith into a **diamond pattern architecture** with functions distributed across multiple contracts and facets.

**Current Architecture:**
- **Original:** Single `OrderBook.sol` contract (3,947 lines)
- **New:** Diamond pattern with multiple facets and contracts
- **Purpose:** Help AI assistants navigate the distributed architecture and map original functionality to new implementations

## Architecture Overview

### Contract Purpose
Centralized exchange-style order book with:
- **Limit & Market Orders**: FIFO matching engine
- **Margin Trading**: Integrated with CoreVault for position management
- **Advanced Liquidation System**: Multi-layer liquidation with gap protection
- **VWAP-based Mark Pricing**: Sophisticated price discovery
- **Comprehensive Trade History**: Full audit trail

### Key Dependencies
- **CoreVault**: Position management, margin handling, liquidation execution
- **Math Library**: Safe arithmetic operations
- **PositionManager**: Position data structures

### Diamond Pattern Architecture

#### Contract Structure
The original `OrderBook.sol` functionality has been refactored into:

**Core Contracts:**
- `Diamond.sol` - Diamond proxy contract
- `CoreVault.sol` - Position and margin management
- `PositionManager.sol` - Position data structures

**Facet Contracts (Original OrderBook Functions Distributed):**
- `OBOrderPlacementFacet.sol` - Order placement and matching logic
- `OBLiquidationFacet.sol` - Liquidation system implementation
- `OBViewFacet.sol` - View functions and queries
- Additional facets for specific functionality

#### Function Mapping Strategy
When looking for original OrderBook functionality:
1. **Identify the functional area** (order placement, liquidation, queries, etc.)
2. **Locate the corresponding facet** that handles that functionality
3. **Map the original function calls** to the new facet structure
4. **Verify diamond proxy delegation** to the correct facet

#### Navigation Challenges in New Architecture
- **Function Distribution:** Single contract functions now split across facets
- **State Management:** Shared state through diamond storage patterns
- **Cross-Facet Calls:** Functions may need to call across multiple facets
- **Interface Consistency:** Diamond interface vs original contract interface

### CoreVault Integration Architecture

#### ICoreVault Interface (lines 7-52)
The OrderBook integrates extensively with CoreVault through a comprehensive interface that handles:

**Position Management:**
```solidity
function getPositionSummary(address user, bytes32 marketId) external view
    returns (int256 size, uint256 entryPrice, uint256 marginLocked)
function getUserPositions(address user) external view returns (PositionManager.Position[] memory)
function getUnifiedMarginSummary(address user) external view returns (...)
function getMarginUtilization(address user) external view returns (uint256 utilizationBps)
```

**Margin Operations:**
```solidity
function lockMargin(address user, bytes32 marketId, uint256 amount) external
function releaseMargin(address user, bytes32 marketId, uint256 amount) external
function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external
function unreserveMargin(address user, bytes32 orderId) external
function releaseExcessMargin(address user, bytes32 orderId, uint256 actualMarginNeeded) external
function getAvailableCollateral(address user) external view returns (uint256)
```

**Position Updates:**
```solidity
function updatePositionWithMargin(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice, uint256 marginToLock) external
function updatePositionWithLiquidation(address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, address liquidator) external
```

**Liquidation System:**
```solidity
function isLiquidatable(address user, bytes32 marketId, uint256 markPrice) external returns (bool)
function liquidateShort/Long(address user, bytes32 marketId, address liquidator, uint256 executionPrice) external
function confiscateAvailableCollateralForGapLoss(address user, uint256 gapLossAmount) external
function socializeLoss(bytes32 marketId, uint256 lossAmount, address liquidatedUser) external
function setUnderLiquidation(address user, bytes32 marketId, bool state) external
function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory users)
function getLiquidationPrice(address user, bytes32 marketId) external view returns (uint256, bool)
function getPositionEquity(address user, bytes32 marketId) external view returns (int256, uint256, bool)
function getEffectiveMaintenanceMarginBps(address user, bytes32 marketId) external view returns (uint256, uint256, bool)
function payMakerLiquidationReward(address liquidatedUser, bytes32 marketId, address maker, uint256 amount) external
```

**Fee Management:**
```solidity
function deductFees(address user, uint256 feeAmount, address feeRecipient) external
function transferCollateral(address from, address to, uint256 amount) external
```

**Debug & Monitoring:**
```solidity
function debugEmitIsLiquidatable(address user, bytes32 marketId, uint256 markPrice) external
```

---

## CoreVault Integration Patterns

### State Synchronization Architecture

#### Position State Management
The OrderBook maintains minimal local state and relies on CoreVault as the single source of truth:

**State Flow:**
```
OrderBook Local State → CoreVault Authoritative State → OrderBook Sync
     ↑                                                                ↓
User Orders ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
```

**Critical Synchronization Points:**
1. **Position Updates**: `vault.updatePositionWithMargin()` or `vault.updatePositionWithLiquidation()`
2. **Margin Operations**: `vault.reserveMargin()`, `vault.releaseMargin()`, `vault.unreserveMargin()`
3. **Mark Price Sync**: `vault.updateMarkPrice()` after every trade and mark calculation
4. **Fee Collection**: `vault.deductFees()` for trading fees

#### Error Handling Patterns

**Try/Catch Usage (47 vault function calls):**
```solidity
// Graceful degradation pattern
try vault.getPositionSummary(user, marketId) returns (int256 size, uint256 entryPrice, uint256 marginLocked) {
    // Success: use authoritative data
    _processPositionData(size, entryPrice, marginLocked);
} catch {
    // Fallback: use cached or default values
    _handlePositionQueryFailure(user, marketId);
}
```

**Common Fallback Strategies:**
- **Position Queries**: Fall back to cached position data or return early
- **Margin Operations**: Continue execution without margin updates (log error)
- **Liquidation Checks**: Skip individual trader if vault query fails
- **State Updates**: Use local fallbacks and emit debug events

### Cross-Contract Data Flow

#### Margin Order Lifecycle
```
1. Order Placement (placeMarginLimitOrder)
   ├── Calculate margin required: _calculateMarginRequired()
   ├── Reserve margin: vault.reserveMargin(user, orderId, marketId, amount)
   ├── Execute matching: _matchBuyOrderWithSlippage()
   ├── Update position: vault.updatePositionWithMargin()
   └── Release excess: vault.releaseExcessMargin()

2. Order Cancellation (cancelOrder)
   ├── Unreserve margin: vault.unreserveMargin(user, orderId)
   └── Remove from order book: _removeFromBuyBook/_removeFromSellBook()

3. Partial Fill Handling
   ├── Calculate new margin needed: _calculateMarginRequired()
   └── Release excess: vault.releaseExcessMargin(user, orderId, newAmount)
```

#### Liquidation Integration Flow
```
1. Liquidation Scanning (_checkPositionsForLiquidation)
   ├── Query users: vault.getUsersWithPositionsInMarket(marketId)
   ├── Check eligibility: vault.isLiquidatable(user, marketId, markPrice)
   ├── Get position: vault.getPositionSummary(user, marketId)
   └── Execute liquidation: _executeLiquidationMarketOrder()

2. Liquidation Execution (_executeLiquidationMarketOrder)
   ├── Create liquidation order (OrderBook as trader)
   ├── Execute matching against order book
   ├── Update position: vault.updatePositionWithLiquidation()
   ├── Set liquidation control: vault.setUnderLiquidation(user, true)
   └── Distribute rewards: vault.payMakerLiquidationReward()

3. Gap Protection (_processEnhancedLiquidationWithGapProtection)
   ├── Calculate gap loss: execution_price - trigger_price
   ├── Confiscate collateral: vault.confiscateAvailableCollateralForGapLoss()
   ├── Socialize losses: vault.socializeLoss() (if needed)
   └── Update mark price: vault.updateMarkPrice()
```

#### Mark Price Synchronization
```
Every Trade Execution:
1. Calculate new mark: _calculateMarkPrice()
2. Update vault: vault.updateMarkPrice(marketId, currentMark)
3. Trigger liquidation scan: _checkPositionsForLiquidation()

Liquidation Scans:
1. Calculate mark: _calculateMarkPrice()
2. Update vault: vault.updateMarkPrice(marketId, currentMark)
3. Process liquidations: _checkPositionsForLiquidation()
```

### CoreVault Function Call Patterns

#### Position Query Pattern (17 calls)
```solidity
// Always try/catch with fallback
try vault.getPositionSummary(user, marketId) returns (int256 size, uint256 entryPrice, uint256 marginLocked) {
    // Use authoritative position data
    _processPositionUpdate(user, size, entryPrice, marginLocked);
} catch {
    // Fallback to cached data or skip operation
    emit PositionQueryFailed(user, marketId);
}
```

#### Margin Operation Pattern (15 calls)
```solidity
// Reserve margin for new orders
vault.reserveMargin(msg.sender, bytes32(orderId), marketId, marginRequired);

// Release margin for filled orders
vault.releaseExcessMargin(user, bytes32(orderId), actualMarginNeeded);

// Unreserve margin for cancelled orders
vault.unreserveMargin(user, bytes32(orderId));
```

#### State Update Pattern (8 calls)
```solidity
// Regular position updates
vault.updatePositionWithMargin(user, marketId, sizeDelta, entryPrice, marginToLock);

// Liquidation position updates
vault.updatePositionWithLiquidation(user, marketId, sizeDelta, executionPrice, liquidator);
```

#### Liquidation Control Pattern (6 calls)
```solidity
// Check liquidation eligibility
bool isLiquidatable = vault.isLiquidatable(user, marketId, markPrice);

// Set liquidation control flag
vault.setUnderLiquidation(user, marketId, true);

// Query users for liquidation scanning
address[] memory users = vault.getUsersWithPositionsInMarket(marketId);
```

---

## Core Data Structures

### Order Struct (lines 70-80)
```solidity
struct Order {
    uint256 orderId;           // Unique order identifier
    address trader;            // Order owner
    uint256 price;             // Price (6 decimals - USDC)
    uint256 amount;            // Remaining amount (18 decimals)
    bool isBuy;                // Buy (true) or Sell (false)
    uint256 timestamp;         // Block timestamp
    uint256 nextOrderId;       // Linked list pointer
    uint256 marginRequired;    // Margin reserved for this order
    bool isMarginOrder;        // Uses margin vs spot
}
```

### PriceLevel Struct (lines 83-88)
```solidity
struct PriceLevel {
    uint256 totalAmount;       // Total liquidity at price
    uint256 firstOrderId;      // Head of order linked list
    uint256 lastOrderId;       // Tail of order linked list
    bool exists;               // Whether price level is active
}
```

### Trade Struct (lines 953-967)
```solidity
struct Trade {
    uint256 tradeId;           // Unique trade ID
    address buyer;             // Buyer address
    address seller;            // Seller address
    uint256 price;             // Execution price (6 decimals)
    uint256 amount;            // Trade amount (18 decimals)
    uint256 timestamp;         // Block timestamp
    uint256 buyOrderId;        // Buy order reference
    uint256 sellOrderId;       // Sell order reference
    bool buyerIsMargin;        // Buy side margin usage
    bool sellerIsMargin;       // Sell side margin usage
    uint256 tradeValue;        // Value in USDC (6 decimals)
    uint256 buyerFee;          // Fee paid by buyer
    uint256 sellerFee;         // Fee paid by seller
}
```

### LiquidationExecutionResult Struct (lines 91-98)
```solidity
struct LiquidationExecutionResult {
    bool success;                    // Execution success
    uint256 filledAmount;           // Amount actually filled
    uint256 remainingAmount;        // Unfilled amount
    uint256 averageExecutionPrice;  // VWAP of execution
    uint256 worstExecutionPrice;    // Highest price paid (for buys)
    uint256 totalExecutions;        // Number of price levels hit
}
```

---

## State Variables Organization

### Order Book State (lines 100-124)
- `orders`: Order ID → Order struct mapping
- `buyLevels`/`sellLevels`: Price → PriceLevel mapping
- `userOrders`: User → Order IDs array
- `bestBid`/`bestAsk`: Current best prices
- `buyPrices`/`sellPrices`: Price level arrays for iteration

### Trading Parameters (lines 120-135)
- `marginRequirementBps`: Base margin requirement (10000 = 100%)
- `tradingFee`: Fee in basis points (10 = 0.1%)
- `maxSlippageBps`: Maximum slippage for market orders
- `unitMarginLong6`/`unitMarginShort6`: Per-unit margin rates

### Liquidation State (lines 135-175)
- `MAX_POSITIONS_TO_CHECK`: Batch size for liquidation scanning
- `MAX_LIQUIDATIONS_PER_CALL`: Rate limiting
- `liquidationInProgress`: Recursion guard
- `liquidationMode`: Indicates active liquidation execution
- `liquidationTarget`: User being liquidated
- `pendingLiquidationRescan`: Deferred liquidation check flag

### Liquidation Reward System (lines 165-190)
- `liquidationMakers`: Array of makers contributing to liquidation
- `liquidationMakerNotionalScaled`: Scaled notionals for reward weighting
- `liquidationRewardedRecipients`: Count of rewarded makers
- `MAX_LIQUIDATION_REWARD_RECIPIENTS`: Gas-safe cap (64)

### Trade History System (lines 951-978)
- `trades`: Trade ID → Trade struct mapping
- `nextTradeId`: Auto-incrementing trade counter
- `userTradeIds`: User → Trade IDs array
- `totalTradeCount`: Total trades executed

---

## Function Pipeline Maps

### 1. Order Placement Pipeline

#### Entry Points
```
placeLimitOrder() → _placeLimitOrder()
placeMarginLimitOrder() → _placeLimitOrder()
placeMarketOrder() → _placeMarketOrder()
placeMarginMarketOrder() → _placeMarketOrder()
```

#### _placeLimitOrder() Pipeline (lines 1335-1412)
```
_placeLimitOrder(price, amount, isBuy, isMarginOrder, marginRequired)
    ├── Reserve margin (if margin order)
    ├── Create Order struct
    ├── Match against opposite book:
    │   ├── _matchBuyOrder() or _matchSellOrder()
    │   └── _executeTrade() → Position updates
    ├── Add unfilled amount to book:
    │   ├── _addToBuyBook() or _addToSellBook()
    │   └── _onMarkPricePotentiallyChanged() → Liquidation scan
    └── Release margin for fully filled orders
```

#### _placeMarketOrder() Pipeline (lines 1489-1573)
```
_placeMarketOrder(amount, isBuy, isMarginOrder, slippageBps)
    ├── Validate inputs and liquidity availability
    ├── Check available collateral (margin orders only)
    ├── Calculate slippage bounds
    ├── Create market Order struct
    ├── Execute matching:
    │   ├── _matchBuyOrderWithSlippage() or _matchSellOrderWithSlippage()
    │   ├── _executeTrade() → Position updates
    │   └── _onMarkPricePotentiallyChanged() → Liquidation scan
    └── Return filled amount
```

### 2. Order Matching Pipeline

#### Buy Order Matching (lines 1620-1757)
```
_matchBuyOrderWithSlippage(buyOrder, remainingAmount, maxPrice)
    ├── Iterate through sell price levels (bestAsk → higher)
    ├── For each price level:
    │   ├── Walk through sell orders (FIFO)
    │   ├── Calculate match amount
    │   ├── Execute trade:
    │   │   ├── _safeExecuteTradeWithFallback()
    │   │   ├── Record liquidation maker contribution (if liquidation)
    │   │   └── Update liquidation execution tracking
    │   ├── Update order amounts and price levels
    │   ├── Remove fully filled orders
    │   └── Update bestAsk pointer
    ├── Check slippage protection
    └── _onMarkPricePotentiallyChanged() → Liquidation scan
```

#### Sell Order Matching (lines 1773-1875)
```
_matchSellOrderWithSlippage(sellOrder, remainingAmount, minPrice)
    ├── Iterate through buy price levels (bestBid → lower)
    ├── For each price level:
    │   ├── Walk through buy orders (FIFO)
    │   ├── Calculate match amount
    │   ├── Execute trade:
    │   │   ├── _safeExecuteTradeWithFallback()
    │   │   ├── Record liquidation maker contribution (if liquidation)
    │   │   └── Update liquidation execution tracking
    │   ├── Update order amounts and price levels
    │   ├── Remove fully filled orders
    │   └── Update bestBid pointer
    └── _onMarkPricePotentiallyChanged() → Liquidation scan
```

### 3. Trade Execution Pipeline

#### Core Trade Execution (lines 2675-2876)
```
_executeTrade(buyer, seller, price, amount, buyerMargin, sellerMargin)
    ├── Calculate trade value and fees (with overflow protection)
    ├── Record trade in history
    ├── Retrieve current positions from CoreVault
    ├── Calculate new positions
    ├── Update active trader tracking
    ├── Track known users for liquidation scanning
    ├── Handle margin updates:
    │   ├── _handleLiquidationMarginUpdate() (if liquidation)
    │   ├── _assertPreTradeSolvency() (solvency checks)
    │   ├── vault.updatePositionWithMargin() or updatePositionWithLiquidation()
    │   └── Deduct trading fees
    ├── Update mark price in vault
    └── Trigger liquidation scan (if conditions met)
```

#### Margin Update Pipeline (lines 2554-2612)
```
_handleMarginUpdate(user, oldPosition, amount, price, isMargin)
    ├── Skip for OrderBook contract (liquidation orders)
    ├── Calculate required margin for new position
    ├── Handle position flips (long↔short) correctly
    ├── Call vault.updatePositionWithMargin()
    └── Apply netting and margin release for closes
```

### 4. Liquidation System Pipeline

#### Liquidation Scanning (lines 335-476)
```
_checkPositionsForLiquidation(markPrice)
    ├── Check recursion guard (prevent infinite loops)
    ├── Query vault for users with positions
    ├── Process users in batches (MAX_POSITIONS_TO_CHECK)
    ├── For each user:
    │   ├── _checkAndLiquidateTrader()
    │   ├── Emit detailed liquidation events
    │   └── Rate limit liquidations (MAX_LIQUIDATIONS_PER_CALL)
    ├── Update scanning index for next batch
    ├── Handle pending rescans (if liquidity arrived during liquidation)
    └── Clear recursion guard
```

#### Individual Trader Liquidation (lines 484-601)
```
_checkAndLiquidateTrader(trader, markPrice)
    ├── Check if user is liquidatable via vault.isLiquidatable()
    ├── Fetch current position from vault
    ├── Determine position direction (long/short)
    ├── Execute liquidation market order:
    │   ├── _executeLiquidationMarketOrder()
    │   ├── Handle partial fills and retries
    │   └── Track liquidation execution metrics
    ├── Process liquidation with gap protection:
    │   ├── _processEnhancedLiquidationWithGapProtection()
    │   ├── Mark position under liquidation control
    │   └── Distribute maker rewards
    └── Return liquidation result
```

#### Liquidation Market Order Execution (lines 611-761)
```
_executeLiquidationMarketOrder(trader, amount, isBuy, markPrice)
    ├── Validate inputs and check liquidity availability
    ├── Calculate liquidation slippage bounds (15% vs 5% for normal)
    ├── Create liquidation order (attributed to OrderBook)
    ├── Execute matching with forced crossing:
    │   ├── _matchBuyOrderWithSlippage() or _matchSellOrderWithSlippage()
    │   ├── Track maker contributions for rewards
    │   ├── Record execution prices and volumes
    │   └── Handle slippage widening for forced fills
    ├── Calculate execution results (VWAP, worst price, success rate)
    └── Return detailed execution results
```

#### Enhanced Liquidation Processing (lines 770-836)
```
_processEnhancedLiquidationWithGapProtection(trader, positionSize, triggerPrice, executionResult)
    ├── Calculate gap loss (difference between trigger and execution price)
    ├── Emit gap loss detection events
    ├── Update mark price for accurate margin calculations
    ├── Apply partial liquidation via vault (no full liquidation here)
    ├── Calculate and distribute maker rewards:
    │   ├── _distributeLiquidationRewards()
    │   ├── Proportional reward distribution
    │   └── Handle dust and failed payouts gracefully
    └── Emit comprehensive liquidation breakdown events
```

### 5. Liquidation Reward System

#### Maker Contribution Tracking (lines 192-221)
```
_recordLiquidationMakerContribution(maker, price, amount)
    ├── Skip tracking for OrderBook contract itself
    ├── Scale amount to prevent overflow (amount/1e12)
    ├── Find existing maker or add new one (capped at 64)
    ├── Calculate notional contribution (scaled_amount * price)
    └── Update total notional for reward weighting
```

#### Reward Distribution (lines 223-257)
```
_distributeLiquidationRewards(liquidatedUser, rewardAmount)
    ├── Early returns for zero rewards or no makers
    ├── Calculate proportional shares based on notional contributions
    ├── Distribute rewards via vault.payMakerLiquidationReward()
    ├── Handle payout failures gracefully (try/catch)
    ├── Allocate dust to first maker
    └── Emit detailed reward distribution events
```

### 6. Mark Price Calculation Pipeline

#### VWAP-Based Mark Price (lines 3600-3784)
```
_calculateMarkPrice()
    ├── Check for two-sided market (bid + ask):
    │   ├── Calculate integer mid price
    │   ├── Compute 4-trade VWAP if enabled and valid
    │   ├── Apply hybrid weighting (20-50% VWAP + 50-80% mid)
    │   └── Return blended mark price
    ├── Handle one-sided markets:
    │   ├── Try 2-trade VWAP fallback
    │   ├── Fall back to last trade price
    │   ├── Fall back to available best price
    │   └── Return default (1 USDC)
    └── No VWAP dependencies - pure calculation
```

#### VWAP Calculation Functions
```
_lastTwoTradeVWAP() → Simple 2-trade weighted average
_lastUpToFourTradeVWAP() → Numerically stable up to 4-trade VWAP
_hybridWeightBps(tradesUsed) → Weight schedule: 1→20%, 2→30%, 3→40%, 4+→50%
```

### 7. Administrative Functions

#### Trading Parameters (lines 3314-3343)
```
updateTradingParameters(marginRequirementBps, tradingFee, feeRecipient)
    ├── Validate parameter ranges
    ├── Update state variables
    └── Emit configuration events

updateMaxSlippage(maxSlippageBps)
    ├── Validate slippage limit (≤50%)
    └── Update maxSlippageBps
```

#### Leverage Control (lines 3826-3905)
```
enableLeverage(maxLeverage, marginRequirementBps)
    ├── Validate leverage parameters
    ├── Enable leverage and update settings
    └── Emit enable events

disableLeverage()
    ├── Revert to 1:1 margin requirements
    └── Emit disable events

setLeverageController(newController)
    ├── Update controller authorization
    └── Emit controller change events
```

### 8. Query Functions

#### Order Book Queries
```
getOrderBookDepth(levels) → Price/amount arrays for bids and asks
getOrderBookDepthFromPointers(levels) → Pointer-based depth (resilient)
getBestPrices() → Current best bid/ask
isBookCrossed() → Check if bid ≥ ask
```

#### User-Specific Queries
```
getUserOrders(user) → Array of user's order IDs
getUserTrades(user, offset, limit) → Paginated user trade history
getUserPosition(user) → Current position size in market
getUserTradeCount(user) → Total trades for user
```

#### Market Data
```
getMarketPriceData() → Comprehensive price information (mid, spread, mark, VWAP)
getTradeStatistics() → Volume, trade count, total fees
getAllTrades(offset, limit) → Paginated trade history
```

---

## Critical Code Paths for Debugging

### Liquidation Failures
1. **Start at**: `_checkPositionsForLiquidation()` (line 335)
2. **Check recursion guards** (lines 340-344)
3. **Verify vault user queries** (lines 367-373)
4. **Individual trader processing** → `_checkAndLiquidateTrader()` (line 432)
5. **Liquidation eligibility** → `vault.isLiquidatable()` (line 501)
6. **Market order execution** → `_executeLiquidationMarketOrder()` (line 527)
7. **Gap protection processing** → `_processEnhancedLiquidationWithGapProtection()` (line 572)

### Matching Engine Issues
1. **Start at**: `_matchBuyOrderWithSlippage()` or `_matchSellOrderWithSlippage()` (lines 1620/1773)
2. **Check price level iteration** (lines 1631/1778)
3. **Verify trade execution** → `_executeTrade()` (line 1661)
4. **Confirm position updates** → `vault.updatePositionWithMargin()` (line 2611)
5. **Check mark price sync** → `vault.updateMarkPrice()` (line 2855)

### Margin Calculation Errors
1. **Start at**: `_calculateMarginRequired()` (line 2884)
2. **Check notional calculation** (line 2890)
3. **Verify margin requirement percentages** (lines 2892-2893)
4. **Execution margin** → `_calculateExecutionMargin()` (line 2901)
5. **Pre-trade solvency** → `_assertPreTradeSolvency()` (line 2917)

---

## Key Integration Points

### CoreVault Integration
- **Position Management**: All position state stored in CoreVault
- **Margin Operations**: `lockMargin()`, `releaseMargin()`, `updatePositionWithMargin()`
- **Liquidation Execution**: `updatePositionWithLiquidation()`, `setUnderLiquidation()`
- **Mark Price Sync**: `updateMarkPrice()` called after every trade
- **Fee Collection**: `deductFees()` for trading fees

### Event System
Comprehensive event logging for:
- **Trade Execution**: `TradeExecuted`, `OrderMatched`, `PositionUpdated`
- **Liquidation Process**: `LiquidationCheckStarted`, `AutoLiquidationTriggered`, `GapLossDetected`
- **Debug Information**: `ArithmeticDebug`, `DebugLiquidationContext`, `LiquidationLiquidityCheck`

### Gas Optimization Patterns
- **Batch Processing**: `MAX_POSITIONS_TO_CHECK`, `MAX_LIQUIDATIONS_PER_CALL`
- **Dynamic Scaling**: Amount/price scaling to prevent overflow
- **Pointer Management**: Efficient best bid/ask tracking
- **Array Management**: Price level arrays for O(1) access

---

## Common Debugging Scenarios

### "Orders matching but positions not updating"
1. **Check `_executeTrade()` → `vault.updatePositionWithMargin()` calls** (line 2611)
2. **Verify position retrieval from `vault.getPositionSummary()`** (lines 2743-2744)
3. **Check margin updates in `_handleMarginUpdate()`** (line 2554) or `_handleLiquidationMarginUpdate()` (line 2624)
4. **Verify state synchronization**: Check if `vault.updateMarkPrice()` is called after trades (line 2855)
5. **Check try/catch blocks**: Look for `PositionQueryFailed` or `MarginUpdateFailed` events

### "Liquidation not triggering"
1. **Check `_checkPositionsForLiquidation()` recursion guards** (lines 340-344)
2. **Verify `vault.getUsersWithPositionsInMarket()` returns expected users** (line 368)
3. **Check `vault.isLiquidatable()` call and return value** (line 501)
4. **Verify mark price calculation and sync in `_calculateMarkPrice()`** (line 3600)
5. **Check liquidation scanning triggers**: Verify `_onMarkPricePotentiallyChanged()` calls (line 3795)
6. **Debug vault integration**: Look for `LiquidationCheckStarted` and `LiquidationTraderBeingChecked` events

### "Insufficient liquidity for liquidation"
1. **Check `_executeLiquidationMarketOrder()` liquidity validation** (lines 633-654)
2. **Verify best bid/ask pointers via `_resyncBestPrices()`** (line 2271)
3. **Check forced crossing logic when normal slippage fails** (lines 713-740)
4. **Verify liquidation price bounds calculation** (lines 656-670)
5. **Check maker contribution tracking**: Verify `_recordLiquidationMakerContribution()` (line 192)

### "Margin calculation errors"
1. **Check `_calculateMarginRequired()` for correct notional calculation** (line 2884)
2. **Verify margin requirement percentages for longs vs shorts** (lines 2892-2893)
3. **Check execution margin in `_calculateExecutionMargin()`** (line 2901)
4. **Verify pre-trade solvency checks in `_assertPreTradeSolvency()`** (line 2917)
5. **Check margin operation failures**: Look for failed `vault.reserveMargin()` or `vault.releaseExcessMargin()` calls

### "CoreVault integration failures"
1. **Check ICoreVault interface version compatibility** (lines 7-52)
2. **Verify contract addresses**: Ensure vault address is correctly set in constructor (line 1253)
3. **Check function call patterns**: Verify all 47 vault function calls use proper try/catch
4. **Monitor state synchronization**: Check `vault.updateMarkPrice()` calls after every trade
5. **Debug position queries**: Look for `PositionQueryFailed` events from try/catch blocks

### "Liquidation reward distribution issues"
1. **Check `_distributeLiquidationRewards()` function** (line 223)
2. **Verify maker contribution tracking**: Check `_recordLiquidationMakerContribution()` (line 192)
3. **Check reward calculation**: Verify proportional distribution logic (lines 231-243)
4. **Monitor payout failures**: Look for `DebugMakerRewardPayOutcome` events with `false` success
5. **Verify vault balance**: Check `vault.getAvailableCollateral(address(this))` (line 582)

### "Mark price synchronization problems"
1. **Check `_calculateMarkPrice()` implementation** (line 3600)
2. **Verify VWAP calculations**: Check `_lastTwoTradeVWAP()` and `_lastUpToFourTradeVWAP()` (lines 3631, 3675)
3. **Monitor mark price updates**: Check all `vault.updateMarkPrice()` calls throughout the contract
4. **Check hybrid weighting logic**: Verify `_hybridWeightBps()` calculations (line 3727)
5. **Debug price fallbacks**: Check fallback hierarchy in `_calculateMarkPrice()`

---

## File Navigation Tips

### Finding Functions by Purpose
- **Order Placement**: Lines 1282-1470 (`placeLimitOrder`, `placeMarketOrder` functions)
- **Order Matching**: Lines 1620-2091 (`_matchBuyOrderWithSlippage`, `_matchSellOrderWithSlippage`)
- **Trade Execution**: Lines 2675-2876 (`_executeTrade` function)
- **Liquidation System**: Lines 335-836 (`_checkPositionsForLiquidation`, `_executeLiquidationMarketOrder`)
- **Mark Price**: Lines 3600-3784 (`_calculateMarkPrice` function)
- **Query Functions**: Lines 2314-3304 (all `get*` functions)
- **Admin Functions**: Lines 3307-3905 (parameter updates, leverage control)

### Understanding Function Relationships
- **Entry Points**: Public functions that users call directly
- **Internal Functions**: Private functions implementing core logic
- **Helper Functions**: Utility functions for calculations, validation, state management
- **Integration Functions**: Functions that call CoreVault or other contracts

## Position Top-Up Functionality

### Overview
The position top-up functionality allows users to add additional margin to their existing positions to improve their margin health and prevent liquidation. This is a critical risk management feature that enables traders to maintain positions during adverse market conditions.

### Core Implementation (CoreVault.sol)

#### Entry Point Function
```solidity
function topUpPositionMargin(bytes32 marketId, uint256 amount) external nonReentrant whenNotPaused
```
**Location:** CoreVault.sol, lines 844-852

**Parameters:**
- `marketId`: The market identifier for the position to top up
- `amount`: Additional margin amount to lock (in 6 decimals - USDC)

**Key Features:**
- **Collateral Validation**: Checks user has sufficient available collateral
- **Position Validation**: Ensures user has an existing position in the specified market
- **Atomic Operation**: Uses nonReentrant modifier to prevent reentrancy attacks
- **Event Emission**: Emits `MarginToppedUp` event for tracking
- **Liquidation Price Update**: Automatically recomputes liquidation trigger after top-up

#### Internal Implementation
```solidity
function _increasePositionMargin(address user, bytes32 marketId, uint256 amount) internal
```
**Location:** CoreVault.sol, lines 858-874

**Process:**
1. **Position Search**: Iterates through user's positions to find matching market
2. **Margin Increase**: Adds amount to position's `marginLocked`
3. **Validation**: Ensures position exists and has non-zero size
4. **Global Tracking**: Updates `totalMarginLocked` for system-wide margin tracking
5. **Liquidation Recalculation**: Calls `_recomputeAndStoreLiquidationPrice()` to update liquidation trigger

### Integration with OrderBook

#### Indirect Integration Pattern
The OrderBook doesn't directly implement top-up functionality but benefits from it through:

**State Synchronization:**
- OrderBook queries position state via `vault.getPositionSummary()` (47 calls in OrderBook.sol)
- Top-up changes are immediately reflected in subsequent OrderBook operations
- Liquidation scanning uses updated margin values for accurate liquidation decisions

**Liquidation Prevention:**
- Users can top-up positions to avoid liquidation during OrderBook liquidation scans
- Top-up affects `vault.isLiquidatable()` results, preventing unnecessary liquidations
- Maintains position integrity during high-volatility OrderBook matching

#### Cross-Contract Data Flow
```
User Top-Up Request
       ↓
CoreVault.topUpPositionMargin()
       ├── Validates available collateral
       ├── Increases position marginLocked
       ├── Updates liquidation trigger
       └── Emits MarginToppedUp event
       ↓
OrderBook Operations Continue
       ├── Queries updated position state
       ├── Uses new margin for solvency checks
       └── Prevents liquidation if margin sufficient
```

### Usage Scenarios

#### 1. Pre-Liquidation Top-Up
**Context:** User's position becomes liquidatable due to adverse price movement
**Process:**
1. User monitors position via OrderBook view functions or direct CoreVault queries
2. User calculates required top-up amount using liquidation price data
3. User calls `topUpPositionMargin()` with calculated amount
4. Position margin increases, liquidation trigger recalculated
5. Position no longer liquidatable at current mark price

#### 2. Proactive Margin Management
**Context:** User wants to improve position health before market volatility
**Process:**
1. User checks current margin utilization via `vault.getMarginUtilization()`
2. User calculates desired additional margin buffer
3. User executes top-up to increase margin headroom
4. Position becomes more resilient to price movements

#### 3. Post-Trade Margin Adjustment
**Context:** After large trades through OrderBook, user wants to adjust margin
**Process:**
1. OrderBook executes trade via `_executeTrade()` → `vault.updatePositionWithMargin()`
2. User assesses new position risk profile
3. User tops up margin to maintain desired risk level
4. Updated liquidation trigger reflects new margin

### Risk Management Integration

#### Solvency Impact
```solidity
// Before Top-Up
equity6 = marginLockedBefore + pnl6
maintenance6 = (notional6 * MAINTENANCE_BPS) / 10000n
isLiquidatable = equity6 < maintenance6

// After Top-Up
equity6 = marginLockedAfter + pnl6  // marginLockedAfter = marginLockedBefore + topUpAmount
isLiquidatable = equity6 < maintenance6  // Now false if topUpAmount sufficient
```

#### Liquidation Price Recalculation
The top-up triggers automatic recalculation of the fixed liquidation price:

```solidity
// Simplified liquidation price calculation
liquidationPrice = entryPrice + (marginLocked / absPositionSize)
// After top-up: liquidationPrice increases for longs, decreases for shorts
```

### Error Handling & Edge Cases

#### Validation Requirements
- `amount > 0`: Zero amounts not allowed
- `available >= amount`: Sufficient collateral required
- Position must exist with non-zero size in target market

#### Failure Scenarios
1. **Insufficient Collateral**: User lacks available collateral for top-up amount
2. **No Position Found**: User has no position in specified market
3. **System Paused**: CoreVault is in paused state (emergency control)
4. **Reentrancy**: Operation blocked by nonReentrant modifier

### Testing & Verification

#### Test Coverage (topup-margin-flow.test.js)
**Test Case:** `tops up user3's liquidatable short to postpone liquidation`

**Verification Points:**
- Position becomes non-liquidatable after sufficient top-up
- Margin locked increases by exact top-up amount
- Total system margin locked increases accordingly
- Liquidation trigger recalculated correctly
- Event emission confirms successful operation

**Test Flow:**
1. Create liquidatable position via price movement
2. Calculate required top-up amount mathematically
3. Execute top-up via CoreVault
4. Verify position state changes
5. Confirm non-liquidatable status at same price

### Architectural Importance

#### System Benefits
1. **Risk Management**: Enables users to actively manage liquidation risk
2. **Market Efficiency**: Reduces forced liquidations during normal operation
3. **User Experience**: Provides control over position lifecycle
4. **System Stability**: Prevents cascade liquidations from temporary price spikes

#### Integration Benefits
1. **Seamless Operation**: Works transparently with OrderBook trading
2. **Real-time Updates**: Immediate reflection in all vault queries
3. **Audit Trail**: Complete event history for compliance
4. **Gas Efficiency**: Single transaction for margin increase

### Security Considerations

#### Protection Mechanisms
- **Non-Reentrant**: Prevents reentrancy attacks during margin updates
- **Collateral Validation**: Ensures sufficient backing for all margin increases
- **Position Existence**: Validates legitimate position modifications only
- **Emergency Controls**: Pausable for emergency situations

#### Audit Trail
- **Event Logging**: `MarginToppedUp` event for all top-up operations
- **State Tracking**: Margin locked changes tracked in position summaries
- **Historical Data**: All top-ups preserved in transaction history

This top-up functionality represents a critical component of the risk management system, working in concert with the OrderBook's trading engine and the CoreVault's position management to provide users with comprehensive control over their leveraged positions.

---

## CoreVault Integration Quick Reference

### Function Call Summary
- **47 total vault function calls** across the OrderBook contract
- **17 position queries** with try/catch fallbacks
- **15 margin operations** for order lifecycle management
- **8 state updates** for position changes
- **6 liquidation control** operations
- **1 mark price synchronization** after every trade

### Critical Integration Points
1. **Position State**: All position data flows through `vault.getPositionSummary()` → `vault.updatePositionWithMargin()`
2. **Margin Management**: Order lifecycle managed via `vault.reserveMargin()` → `vault.releaseExcessMargin()` → `vault.unreserveMargin()`
3. **Liquidation Pipeline**: Complete liquidation flow through vault functions with comprehensive error handling
4. **Mark Price Sync**: `vault.updateMarkPrice()` called after every trade and mark calculation
5. **Fee Collection**: `vault.deductFees()` and `vault.transferCollateral()` for financial operations

### Error Handling Architecture
- **Graceful Degradation**: Try/catch blocks prevent single vault failures from breaking entire operations
- **Fallback Strategies**: Cached data, early returns, and debug event emission for failed operations
- **State Consistency**: Comprehensive event logging ensures auditability of all vault interactions
- **Debug Events**: Rich event system (`DebugLiquidationContext`, `ArithmeticDebug`, `PositionQueryFailed`) for troubleshooting

### Key Architectural Patterns
- **Single Source of Truth**: CoreVault maintains authoritative position and margin state
- **Event-Driven Updates**: Mark price changes trigger liquidation scans automatically
- **Batch Processing**: Liquidation scanning processes users in configurable batches for gas efficiency
- **Overflow Protection**: Dynamic scaling in calculations prevents arithmetic overflow
- **Recursive Guards**: Liquidation system prevents infinite loops during complex scenarios

This enhanced mapping provides comprehensive coverage of the OrderBook-CoreVault integration, enabling precise debugging of cross-contract interactions and state synchronization issues. The detailed pipeline maps, error handling patterns, and specific line number references make it easy for AI assistants to navigate the complex interaction patterns between these tightly coupled contracts.

---

## Diamond Pattern Architecture Navigation Guide

### Original Function → New Facet Mapping

#### Order Placement Functions
**Original OrderBook.sol Location:** Lines 1282-1470
**New Architecture Location:**
- `OBOrderPlacementFacet.sol` - Main order placement logic
- Core functions: `placeLimitOrder()`, `placeMarketOrder()`, `placeMarginLimitOrder()`, `placeMarginMarketOrder()`

**Navigation Strategy:**
1. **Check OBOrderPlacementFacet.sol** for order placement entry points
2. **Verify diamond delegation** from main diamond contract to this facet
3. **Map internal functions** from original `_placeLimitOrder()` and `_placeMarketOrder()`

#### Liquidation Functions
**Original OrderBook.sol Location:** Lines 335-836
**New Architecture Location:**
- `OBLiquidationFacet.sol` - Complete liquidation system implementation
- Core functions: `_checkPositionsForLiquidation()`, `_executeLiquidationMarketOrder()`, `_processEnhancedLiquidationWithGapProtection()`

**Navigation Strategy:**
1. **Check OBLiquidationFacet.sol** for liquidation logic
2. **Verify state management** through diamond storage patterns
3. **Map liquidation reward system** from original implementation

#### View/Query Functions
**Original OrderBook.sol Location:** Lines 2314-3304
**New Architecture Location:**
- `OBViewFacet.sol` - All view functions and queries
- Core functions: `getOrderBookDepth()`, `getUserOrders()`, `getMarketPriceData()`, etc.

**Navigation Strategy:**
1. **Check OBViewFacet.sol** for all query operations
2. **Verify data aggregation** across multiple facets if needed
3. **Map complex queries** that may span multiple facets

### Architecture-Specific Debugging Challenges

#### State Management Issues
**Problem:** Functions distributed across facets may have inconsistent state access
**Solution Strategy:**
1. **Check diamond storage patterns** in `OrderBookStorage.sol`
2. **Verify state variable locations** across facets
3. **Examine cross-facet state synchronization**

#### Function Call Routing Issues
**Problem:** Original internal function calls now need inter-facet communication
**Solution Strategy:**
1. **Map original function call chains** to new facet structure
2. **Verify diamond function selectors** are correctly configured
3. **Check for missing function implementations** in facets

#### Interface Consistency Issues
**Problem:** Original contract interface vs diamond pattern interface
**Solution Strategy:**
1. **Compare function signatures** between original and facets
2. **Verify diamond proxy delegation** to correct facets
3. **Check ABI compatibility** for frontend integration

### Debugging Template for Distributed Architecture

When debugging issues in the new diamond pattern architecture:

1. **Identify Original Functionality**
   - Which original OrderBook.sol function is failing?
   - What was the original line number range?
   - What other functions did it depend on?

2. **Map to New Architecture**
   - Which facet should contain this functionality?
   - Has the function been moved or renamed?
   - Are dependencies in other facets?

3. **Verify Implementation**
   - Check the facet implementation matches original logic
   - Verify state management patterns
   - Test diamond delegation is working

4. **Check Integration Points**
   - Verify cross-facet function calls work correctly
   - Check state synchronization between facets
   - Verify event emission for debugging

### Common Architecture-Specific Issues

#### "Function not found in facet"
**Symptoms:** Function exists in original but not accessible in new architecture
**Root Cause:** Function not implemented in the target facet or incorrect diamond delegation
**Solution:** Check facet implementations and diamond function selectors

#### "State inconsistency between facets"
**Symptoms:** Data differs when accessed through different facets
**Root Cause:** State not properly shared through diamond storage
**Solution:** Verify diamond storage patterns and state variable locations

#### "Cross-facet call failures"
**Symptoms:** Functions that worked in original fail when calling across facets
**Root Cause:** Missing implementations or incorrect function signatures in target facets
**Solution:** Map complete call chains and verify all functions exist in target facets

This navigation guide helps AI assistants understand how to map issues from the original monolithic OrderBook.sol to the new distributed diamond pattern architecture, ensuring they can find the correct implementations and debug issues effectively in the refactored codebase.

---

## Market Order Debugging Template - Diamond Architecture

### Issue: "Transaction reverted and Hardhat couldn't infer the reason"

**Error Context:** Market buy and market sell orders are reverting in the diamond pattern architecture. The original OrderBook.sol implementation was correct, but the refactored version is failing.

### Phase 1: Original Market Order Implementation Mapping

**Required Action:** Map the original working market order implementation to understand expected behavior:

**From CodeBaseMapAssistant.MD Reference:**
- **Section:** "1. Order Placement Pipeline" → "_placeMarketOrder() Pipeline"
- **Original Location:** Lines 1489-1573 in OrderBook.sol
- **Key Functions:**
  - `placeMarketOrder()` - Entry point for market orders
  - `placeMarginMarketOrder()` - Entry point for margin market orders
  - `_placeMarketOrder()` - Core market order implementation

**Original Market Order Flow:**
```
_placeMarketOrder(amount, isBuy, isMarginOrder, slippageBps)
    ├── Validate inputs and liquidity availability
    ├── Check available collateral (margin orders only)
    ├── Calculate slippage bounds (maxPrice for buys, minPrice for sells)
    ├── Create market Order struct with slippage-limited price
    ├── Execute matching with slippage protection:
    │   ├── _matchBuyOrderWithSlippage() or _matchSellOrderWithSlippage()
    │   ├── _executeTrade() → Position updates
    │   └── _onMarkPricePotentiallyChanged() → Liquidation scan
    └── Return filled amount
```

### Phase 2: Diamond Architecture Navigation

**Required Action:** Locate market order functionality in the new diamond pattern:

**From CodeBaseMapAssistant.MD Reference:**
- **Section:** "Diamond Pattern Architecture Navigation Guide" → "Original Function → New Facet Mapping"
- **Target Facet:** `OBOrderPlacementFacet.sol` (Order Placement Functions)

**Navigation Strategy:**
1. **Check OBOrderPlacementFacet.sol** for market order implementations
2. **Verify diamond delegation** from main diamond contract to order placement facet
3. **Map original market order functions** to facet implementations
4. **Check for missing dependencies** that may be in other facets

### Phase 3: Common Market Order Revert Causes

**Required Action:** Investigate typical causes of market order reverts in diamond architecture:

**Pre-execution Revert Causes:**
1. **Liquidity Validation Failures:**
   - No opposing liquidity available (`bestAsk == 0` for buys, `bestBid == 0` for sells)
   - Insufficient depth for requested amount
   - Price level synchronization issues in diamond storage

2. **Margin/Collateral Validation Failures:**
   - `vault.getAvailableCollateral()` returns insufficient funds
   - Margin requirement calculation errors
   - Collateral check happens before order creation

3. **Slippage Bound Calculation Issues:**
   - `referencePrice` (bestAsk/bestBid) is 0 or incorrect
   - Slippage bounds calculation overflow/underflow
   - Market order price limits too restrictive

4. **Diamond Architecture Issues:**
   - Function not properly implemented in target facet
   - Incorrect diamond function selector configuration
   - State variable access issues across facets

**During-execution Revert Causes:**
1. **Matching Engine Issues:**
   - Price level iteration problems in diamond storage
   - Order book state corruption
   - Cross-facet state access failures

2. **Vault Integration Failures:**
   - `vault.getPositionSummary()` calls failing
   - `vault.updatePositionWithMargin()` reverts
   - Position state inconsistencies

3. **Event/Mark Price Issues:**
   - `_onMarkPricePotentiallyChanged()` triggers liquidation scan that fails
   - Mark price calculation errors in diamond context

### Phase 4: Systematic Debugging Approach

**Required Action:** Follow this step-by-step debugging process:

**Step 1: Verify Diamond Delegation**
```solidity
// Check if market order functions are properly registered in diamond
// Look for function selectors in diamond contract or deployment script
// Verify OBOrderPlacementFacet.sol is correctly added to diamond
```

**Step 2: Check Liquidity State**
```solidity
// Verify order book has opposing liquidity
// Check bestBid/bestAsk values in diamond storage
// Ensure price levels exist and are accessible across facets
```

**Step 3: Test Function Isolation**
```solidity
// Test individual functions in facets directly (bypass diamond)
// Call facet functions directly to isolate diamond delegation issues
// Compare results with diamond proxy calls
```

**Step 4: Trace Transaction Execution**
```solidity
// Add debug events to trace execution path
// Check for reverts in specific function calls
// Monitor gas usage for out-of-gas scenarios
```

**Step 5: Verify State Consistency**
```solidity
// Check if state variables are properly shared across facets
// Verify diamond storage patterns are working correctly
// Ensure no state corruption from previous operations
```

### Phase 5: Architecture-Specific Solutions

**Required Action:** Address diamond pattern specific issues:

**For Function Delegation Issues:**
- Verify function selectors are correctly calculated and registered
- Check facet interface matches diamond expectations
- Ensure facet is properly added to diamond during deployment

**For State Management Issues:**
- Check `OrderBookStorage.sol` for proper diamond storage patterns
- Verify state variables are correctly accessed across facets
- Ensure no state conflicts between facets

**For Cross-Facet Dependencies:**
- Map all internal function calls to their new facet locations
- Verify all dependencies are properly implemented
- Check for circular dependencies between facets

### Investigation Deliverables

**Root Cause Analysis:**
- Identify whether issue is in diamond delegation, facet implementation, or state management
- Determine if it's a pre-execution validation failure or during-execution error
- Pinpoint the exact line/contract causing the revert

**Fix Implementation:**
- Correct function implementation in target facet
- Fix diamond delegation configuration
- Resolve state management issues

**Prevention Measures:**
- Add proper error handling and debug events
- Implement function existence checks
- Add state consistency validation

**Testing Strategy:**
- Create isolated tests for each facet
- Test diamond delegation separately
- Add comprehensive integration tests

### Reference Materials

**Required Reading:**
- **CodeBaseMapAssistant.MD** - Complete architecture mapping and navigation guide
- **Sections:** "Diamond Pattern Architecture Navigation Guide", "1. Order Placement Pipeline"
- **OBOrderPlacementFacet.sol** - Market order implementations
- **Diamond.sol** - Diamond proxy and facet management
- **OrderBookStorage.sol** - Diamond storage patterns

This debugging template provides a systematic approach to identifying and resolving market order revert issues in your diamond pattern architecture, leveraging the comprehensive mapping between original OrderBook.sol implementation and the new distributed facet structure.
