# Contract Interactions Summary - Interactive Trader

This document provides a comprehensive overview of all contract interactions between `interactive-trader.js` and the HyperLiquid V2 smart contracts, including CoreVault.sol and the diamond OrderBook system.

## 📋 Overview

The interactive trader interacts with 4 main contract types:
1. **CoreVault.sol** - Primary vault contract for collateral, positions, and margin management
2. **Diamond OrderBook** - Modular order book system with multiple facets
3. **MockUSDC** - ERC20 token contract for collateral operations
4. **LiquidationManager** - Specialized liquidation logic (delegated from CoreVault)

## 🔗 Contract Setup

### Contract Initialization
```javascript
// CoreVault contract
this.contracts.vault = await getContract("CORE_VAULT");

// MockUSDC contract
this.contracts.mockUSDC = await getContract("MOCK_USDC");

// Diamond OrderBook facets
this.contracts.obView = await ethers.getContractAt("OBViewFacet", obAddress);
this.contracts.obPricing = await ethers.getContractAt("OBPricingFacet", obAddress);
this.contracts.obPlace = await ethers.getContractAt("OBOrderPlacementFacet", obAddress);
this.contracts.obExec = await ethers.getContractAt("OBTradeExecutionFacet", obAddress);
this.contracts.obLiq = await ethers.getContractAt("OBLiquidationFacet", obAddress);

// Optional liquidation manager
this.contracts.liquidationManager = await getContract("LIQUIDATION_MANAGER");
```

## 🏦 CoreVault.sol Functions

CoreVault.sol is the primary vault contract handling collateral, positions, and margin management.

### 📊 Portfolio & Margin Management

| Function | Usage | Contract |
|----------|-------|----------|
| `getUnifiedMarginSummary(user)` | Gets comprehensive margin data for a user | CoreVault |
| `getUserPositions(user)` | Retrieves all positions for a user | CoreVault |
| `getAvailableCollateral(user)` | Calculates available collateral for new trades | CoreVault |
| `userCollateral(user)` | Gets deposited collateral amount | CoreVault |
| `getPositionSummary(user, marketId)` | Gets position details for a specific market | CoreVault |
| `getLiquidationPrice(user, marketId)` | Gets liquidation price for a position | CoreVault |
| `getEffectiveMaintenanceMarginBps(user, marketId)` | Gets MMR in basis points | CoreVault |
| `getEffectiveMaintenanceDetails(user, marketId)` | Gets detailed MMR metrics | CoreVault |
| `getPositionEquity(user, marketId)` | Gets position equity and notional | CoreVault |
| `getPositionFreeMargin(user, marketId)` | Gets free margin above MMR | CoreVault |
| `getMarginUtilization(user)` | Gets margin utilization ratio | CoreVault |
| `getUserPayoutEquityTotal(user)` | Gets total payout equity across positions | CoreVault |
| `getPositionPayoutEquity(user, marketId)` | Gets payout equity for specific position | CoreVault |
| `userSocializedLoss(user)` | Gets accumulated socialized losses | CoreVault |

### 💰 Collateral Operations

| Function | Usage | Contract |
|----------|-------|----------|
| `depositCollateral(amount)` | Deposits USDC collateral | CoreVault |
| `withdrawCollateral(amount)` | Withdraws USDC collateral | CoreVault |
| `topUpPositionMargin(marketId, amount)` | Adds margin to existing position | CoreVault |
| `releaseMargin(user, marketId, amount)` | Releases margin from position | CoreVault |

### 🔄 Margin Management (Internal)

| Function | Usage | Contract |
|----------|-------|----------|
| `lockMargin(user, marketId, amount)` | Locks margin for position | CoreVault |
| `reserveMargin(user, orderId, marketId, amount)` | Reserves margin for pending order | CoreVault |
| `unreserveMargin(user, orderId)` | Unreserves margin for cancelled order | CoreVault |
| `releaseExcessMargin(user, orderId, newAmount)` | Adjusts reserved margin amount | CoreVault |

## 📈 Diamond OrderBook Functions

The OrderBook uses a diamond pattern with multiple facets for different operations.

### 🔍 View Functions (OBViewFacet)

| Function | Usage | Contract |
|----------|-------|----------|
| `getBestPrices()` | Gets best bid and ask prices | OBViewFacet |
| `bestBid()` | Gets best bid price | OBViewFacet |
| `bestAsk()` | Gets best ask price | OBViewFacet |
| `getActiveOrdersCount()` | Gets count of active buy/sell orders | OBViewFacet |

### 💰 Pricing Functions (OBPricingFacet)

| Function | Usage | Contract |
|----------|-------|----------|
| `calculateMarkPrice()` | Calculates current mark price | OBPricingFacet |
| `getOrderBookDepth(depth)` | Gets order book depth at price levels | OBPricingFacet |
| `getMarketPriceData()` | Gets comprehensive market data | OBPricingFacet |

### 📝 Order Management (OBOrderPlacementFacet)

| Function | Usage | Contract |
|----------|-------|----------|
| `getUserOrders(user)` | Gets all orders for a user | OBOrderPlacementFacet |
| `getOrder(orderId)` | Gets specific order details | OBOrderPlacementFacet |
| `getFilledAmount(orderId)` | Gets filled amount for an order | OBOrderPlacementFacet |
| `placeMarginLimitOrder(price, amount, isBuy)` | Places a limit order | OBOrderPlacementFacet |
| `placeMarginMarketOrder(amount, isBuy)` | Places a market order | OBOrderPlacementFacet |
| `placeMarginMarketOrderWithSlippage(amount, isBuy, slippageBps)` | Places market order with slippage protection | OBOrderPlacementFacet |
| `cancelOrder(orderId)` | Cancels a specific order | OBOrderPlacementFacet |

### 📊 Trade History (OBTradeExecutionFacet)

| Function | Usage | Contract |
|----------|-------|----------|
| `getUserTradeCount(user)` | Gets total trade count for user | OBTradeExecutionFacet |
| `getUserTrades(user, offset, limit)` | Gets user's trade history | OBTradeExecutionFacet |
| `getTradeStatistics()` | Gets global trade statistics | OBTradeExecutionFacet |
| `getRecentTrades(limit)` | Gets recent market trades | OBTradeExecutionFacet |
| `lastTradePrice()` | Gets last trade price | OBTradeExecutionFacet |

### 🔄 Liquidation Functions (OBLiquidationFacet)

| Function | Usage | Contract |
|----------|-------|----------|
| `setConfigLiquidationScanOnTrade(enable)` | Enables/disables scan on trade | OBLiquidationFacet |
| `setConfigLiquidationDebug(enable)` | Enables/disables debug events | OBLiquidationFacet |
| `liquidationScanOnTrade()` | Checks if scan on trade is enabled | OBLiquidationFacet |
| `liquidationDebug()` | Checks if debug is enabled | OBLiquidationFacet |
| `pokeLiquidations()` | Manually triggers liquidation scan | OBLiquidationFacet |

## 💎 MockUSDC Functions

MockUSDC is the ERC20 collateral token.

| Function | Usage | Contract |
|----------|-------|----------|
| `balanceOf(user)` | Gets USDC balance for user | MockUSDC |
| `approve(spender, amount)` | Approves vault to spend USDC | MockUSDC |
| `getAddress()` | Gets contract address | MockUSDC |

## ⚡ LiquidationManager Functions

LiquidationManager handles complex liquidation logic (delegated from CoreVault).

| Function | Usage | Contract |
|----------|-------|----------|
| `queryFilter(eventFilter, fromBlock, toBlock)` | Queries liquidation events | LiquidationManager |
| `getAddress()` | Gets contract address | LiquidationManager |

## 🔄 Event Listeners

The trader sets up extensive event listeners for real-time monitoring:

### CoreVault Events
- `CollateralDeposited` - User deposits collateral
- `CollateralWithdrawn` - User withdraws collateral
- `MarginConfiscated` - Margin seized during liquidation
- `LiquidatorRewardPaid` - Liquidator receives reward
- `MakerLiquidationRewardPaid` - Maker receives liquidation reward
- `SocializedLossApplied` - Loss socialized across users
- `HaircutApplied` - Haircut applied to user collateral

### OrderBook Events
- `OrderMatched` - Orders matched and executed
- `OrderPlaced` - New order placed
- `OrderCancelled` - Order cancelled
- `TradeExecutionStarted` - Trade execution begins
- `TradeValueCalculated` - Trade value computed
- `TradeRecorded` - Trade recorded in history
- `LiquidationTradeDetected` - Liquidation trade detected
- `MarginUpdatesStarted` - Margin updates begin
- `FeesDeducted` - Trading fees deducted

### ADL Events
- `SocializationStarted` - ADL socialization begins
- `ProfitablePositionFound` - Profitable position identified for reduction
- `AdministrativePositionClosure` - Position reduced via ADL
- `SocializationCompleted` - ADL socialization completed
- `PositionUpdated` - Position size updated
- `DebugProfitCalculation` - Debug profit calculation events

## 🎯 Key Usage Patterns

### Portfolio Management
1. **Margin Summary**: `getUnifiedMarginSummary()` provides comprehensive portfolio data
2. **Position Tracking**: `getUserPositions()` tracks all user positions
3. **Available Balance**: `getAvailableCollateral()` calculates tradable balance
4. **Real-time Updates**: Event listeners provide real-time portfolio updates

### Order Management
1. **Order Placement**: `placeMarginLimitOrder()` and `placeMarginMarketOrder()` for trading
2. **Order Monitoring**: `getUserOrders()` and `getOrder()` for tracking orders
3. **Order Cancellation**: `cancelOrder()` for canceling orders
4. **Trade History**: `getUserTrades()` for viewing trade history

### Liquidation Monitoring
1. **Liquidation Detection**: Event listeners monitor liquidation events
2. **Margin Health**: `getEffectiveMaintenanceMarginBps()` tracks margin requirements
3. **Position Risk**: `getLiquidationPrice()` shows liquidation triggers
4. **Socialized Loss**: `userSocializedLoss()` tracks accumulated losses

### Collateral Operations
1. **Deposits**: `depositCollateral()` with `approve()` for funding
2. **Withdrawals**: `withdrawCollateral()` for removing funds
3. **Margin Management**: `topUpPositionMargin()` for position maintenance

This comprehensive integration allows the interactive trader to provide real-time trading capabilities with full visibility into positions, orders, and liquidation events.
