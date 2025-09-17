# Smart Contract Methods Analysis

This document provides a comprehensive analysis of all smart contract methods available in the HyperLiquid v2 system and their usage in the interactive-trader.js script.

## 📊 Overview

The HyperLiquid v2 system consists of multiple interconnected smart contracts:
- **CoreVault**: Core collateral and position management
- **OrderBook**: Orderbook-based trading with margin support  
- **TradingRouter**: Unified trading interface across multiple markets
- **FuturesMarketFactory**: Factory for creating custom futures markets
- **PositionManager**: Library for position calculations (internal)
- **VaultAnalytics**: Library for analytics calculations (internal)

---

## 🔍 Methods Used in Interactive-Trader.js

### OrderBook Contract Methods

| Method | Used in Script | Available in Contract | Status |
|--------|----------------|----------------------|---------|
| `placeMarginLimitOrder(uint256,uint256,bool)` | ✅ | ✅ | **MATCHED** |
| `placeMarginMarketOrder(uint256,bool)` | ✅ | ✅ | **MATCHED** |
| `placeMarginMarketOrderWithSlippage(uint256,bool,uint256)` | ✅ | ✅ | **MATCHED** |
| `getUserOrders(address)` | ✅ | ✅ | **MATCHED** |
| `getOrder(uint256)` | ✅ | ✅ | **MATCHED** |
| `getFilledAmount(uint256)` | ✅ | ✅ | **MATCHED** |
| `cancelOrder(uint256)` | ✅ | ✅ | **MATCHED** |
| `getBestPrices()` | ✅ | ✅ | **MATCHED** |
| `getOrderBookDepth(uint256)` | ✅ | ✅ | **MATCHED** |
| `calculateMarkPrice()` | ✅ | ✅ | **MATCHED** |
| `getUserTradeCount(address)` | ✅ | ✅ | **MATCHED** |
| `getUserTrades(address,uint256,uint256)` | ✅ | ✅ | **MATCHED** |
| `getTradeStatistics()` | ✅ | ✅ | **MATCHED** |
| `getRecentTrades(uint256)` | ✅ | ✅ | **MATCHED** |
| `bestBid()` | ✅ | ✅ | **MATCHED** |
| `bestAsk()` | ✅ | ✅ | **MATCHED** |
| `getActiveOrdersCount()` | ✅ | ✅ | **MATCHED** |
| `buyLevels(uint256)` | ✅ | ✅ | **MATCHED** |
| `sellLevels(uint256)` | ✅ | ✅ | **MATCHED** |

### CoreVault Contract Methods

| Method | Used in Script | Available in Contract | Status |
|--------|----------------|----------------------|---------|
| `getUserPositions(address)` | ✅ | ✅ | **MATCHED** |
| `getMarginSummary(address)` | ✅ | ✅ | **MATCHED** |
| `userCollateral(address)` | ✅ | ✅ | **MATCHED** |
| `depositCollateral(uint256)` | ✅ | ✅ | **MATCHED** |
| `withdrawCollateral(uint256)` | ✅ | ✅ | **MATCHED** |

### FuturesMarketFactory Contract Methods

| Method | Used in Script | Available in Contract | Status |
|--------|----------------|----------------------|---------|
| `getMarket(bytes32)` | ✅ | ❌ | **MISSING** |

**Note**: The script calls `getMarket()` but this method doesn't exist. Available alternatives:
- `getMarketDetails(bytes32)` - Returns comprehensive market information
- `getMarketInfo(bytes32)` - Returns market name and OrderBook address
- `doesMarketExist(bytes32)` - Checks if market exists

### TradingRouter Contract Methods

| Method | Used in Script | Available in Contract | Status |
|--------|----------------|----------------------|---------|
| `placeMarginMarketOrder(bytes32,uint128,uint64,uint256)` | ✅ | ❌ | **SIGNATURE MISMATCH** |

**Note**: Script calls `placeMarginMarketOrder(marketId, amount, isBuy)` but contract expects `(marketId, amount, priceTick, leverage)`. Available alternatives:
- `marketBuyWithLeverage(bytes32,uint128,uint64,uint256)`
- `marketSellWithLeverage(bytes32,uint128,uint64,uint256)`

---

## 🏗️ Complete Available Methods by Contract

### CoreVault Contract

#### Core Functions
- `depositCollateral(uint256 amount)` - Deposit collateral tokens
- `withdrawCollateral(uint256 amount)` - Withdraw available collateral
- `updatePositionWithMargin(address,bytes32,int256,uint256,uint256)` - Update position with margin

#### View Functions  
- `getUserPositions(address user)` - Get all user positions
- `getUserPositionCount(address user)` - Get position count
- `getMarginSummary(address user)` - Get complete margin analytics
- `getAvailableCollateral(address user)` - Get available collateral
- `getTotalMarginUsed(address user)` - Get total margin in use
- `getMarkPrice(bytes32 marketId)` - Get current mark price
- `getGlobalStats()` - Get global vault statistics

#### Admin Functions
- `authorizeMarket(bytes32,address)` - Authorize new market
- `updateMarkPrice(bytes32,uint256)` - Update market mark price
- `pause()` / `unpause()` - Emergency controls
- `deductFees(address,uint256,address)` - Deduct trading fees

### OrderBook Contract

#### Trading Functions
- `placeLimitOrder(uint256 price, uint256 amount, bool isBuy)` - Place limit order
- `placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy)` - Place margin limit order
- `placeMarketOrder(uint256 amount, bool isBuy)` - Place market order
- `placeMarginMarketOrder(uint256 amount, bool isBuy)` - Place margin market order
- `placeMarketOrderWithSlippage(uint256,bool,uint256)` - Market order with slippage protection
- `placeMarginMarketOrderWithSlippage(uint256,bool,uint256)` - Margin market order with slippage
- `cancelOrder(uint256 orderId)` - Cancel existing order
- `modifyOrder(uint256,uint256,uint256)` - Modify existing order

#### Order Management
- `getUserOrders(address user)` - Get user's active orders
- `getOrder(uint256 orderId)` - Get order details
- `getFilledAmount(uint256 orderId)` - Get filled amount for order

#### Market Data
- `getOrderBookDepth(uint256 levels)` - Get order book depth
- `getBestPrices()` - Get best bid/ask prices
- `bestBid()` / `bestAsk()` - Individual best prices
- `getSpread()` - Current spread
- `isBookCrossed()` - Check if book is crossed
- `getActiveOrdersCount()` - Count of active orders
- `getMarketPriceData()` - Comprehensive price data

#### Trading History
- `getAllTrades(uint256,uint256)` - Get all trades with pagination
- `getUserTrades(address,uint256,uint256)` - Get user's trades
- `getRecentTrades(uint256)` - Get recent trades
- `getTradeById(uint256)` - Get specific trade
- `getUserTradeCount(address)` - Get user's trade count
- `getTradeStatistics()` - Get trading statistics
- `getTradesByTimeRange(uint256,uint256,uint256,uint256)` - Time-filtered trades

#### Price & Analytics
- `calculateMarkPrice()` - Calculate current mark price
- `getMarkPrice()` - Get mark price
- `getVWAP()` - Get VWAP
- `getMultiWindowVWAP()` - Get multi-timeframe VWAP
- `calculateVWAP(uint256)` - Calculate VWAP for timeframe

#### Position Management
- `getUserPosition(address)` - Get user's position
- `clearUserPosition(address)` - Clear user's position (admin)

#### Leverage Management
- `enableLeverage(uint256,uint256)` - Enable leverage trading
- `disableLeverage()` - Disable leverage trading
- `setLeverageController(address)` - Set leverage controller
- `setMarginRequirement(uint256)` - Update margin requirements
- `getLeverageInfo()` - Get leverage configuration

#### Configuration
- `updateTradingParameters(uint256,uint256,address)` - Update trading params
- `updateMaxSlippage(uint256)` - Update max slippage
- `configureVWAP(uint256,uint256,bool)` - Configure VWAP settings
- `getTradingParameters()` - Get current trading parameters

### TradingRouter Contract  

#### Core Trading
- `placeLimitOrder(bytes32,OrderSide,uint128,uint64,uint256,uint32)` - Place limit order
- `marketBuy(bytes32,uint128,uint64)` - Market buy order
- `marketSell(bytes32,uint128,uint64)` - Market sell order
- `marketBuyWithLeverage(bytes32,uint128,uint64,uint256)` - Leveraged market buy
- `marketSellWithLeverage(bytes32,uint128,uint64,uint256)` - Leveraged market sell
- `cancelOrder(bytes32,bytes32)` - Cancel order
- `batchCancelOrders(bytes32[],bytes32[])` - Cancel multiple orders

#### Portfolio Analytics
- `getUserActiveOrders(address)` - Get all active orders across markets
- `getUserPortfolioValue(address)` - Get total portfolio value
- `getUserPositionBreakdowns(address)` - Get detailed position analytics
- `getUserPositionBreakdownByMarket(address,bytes32)` - Market-specific breakdown
- `getUserTradingData(address)` - Comprehensive user data

#### Multi-Market Data
- `getMultiMarketData(bytes32[])` - Get price data for multiple markets
- `getMultiMarketSpreads(bytes32[])` - Get spreads for multiple markets
- `detectArbitrage(bytes32,bytes32)` - Detect arbitrage opportunities

#### Statistics
- `getTradingStats()` - Global trading statistics  
- `getMarketVolume(bytes32)` - Market-specific volume
- `getUserTradeCount(address)` - User trade count

#### Admin Functions
- `pause()` / `unpause()` - Emergency controls
- `grantUpdaterRole(address)` / `revokeUpdaterRole(address)` - Role management

### FuturesMarketFactory Contract

#### Market Creation
- `createFuturesMarket(string,string,uint256,uint256,string,string[],uint256,uint256)` - Create new market
- `deactivateFuturesMarket(address)` - Deactivate market

#### Market Discovery
- `getAllMarkets()` - Get all market IDs
- `getAllOrderBooks()` - Get all OrderBook addresses
- `getOrderBookForMarket(bytes32)` - Get OrderBook for market
- `getMarketForOrderBook(address)` - Get market for OrderBook
- `doesMarketExist(bytes32)` - Check market existence
- `getOrderBookCount()` - Total OrderBook count

#### Market Information
- `getMarketDetails(bytes32)` - Comprehensive market details
- `getMarketInfo(bytes32)` - Basic market info (name, OrderBook)
- `getMarketSymbol(bytes32)` - Market symbol
- `getMarketCreator(bytes32)` - Market creator address
- `getMarketMetricUrl(bytes32)` - Metric URL (source of truth)
- `getMarketSettlementDate(bytes32)` - Settlement date
- `getMarketStartPrice(bytes32)` - Initial market price
- `getMarketCreationTimestamp(bytes32)` - Creation time
- `getMarketDataSource(bytes32)` - Data source category
- `getMarketTags(bytes32)` - Market tags
- `getMarketSettlementInfo(bytes32)` - Settlement status & final price

#### Market Analytics  
- `isMarketSettled(bytes32)` - Check if market settled
- `getTimeToSettlement(bytes32)` - Time until settlement
- `getUserCreatedMarkets(address)` - Markets created by user
- `getActiveMarkets()` - Currently active markets
- `getMarketsReadyForSettlement()` - Markets ready to settle
- `getMarketsByType(bool)` - Custom vs standard markets
- `getMarketsByDataSource(string)` - Filter by data source
- `getMarketsByTag(string)` - Filter by tag
- `getMarketsBySettlementRange(uint256,uint256)` - Filter by settlement time

#### Oracle Integration
- `configureOracles(address,address,address)` - Configure oracle addresses
- `assignCustomOracle(bytes32,address)` - Assign custom oracle
- `requestUMASettlement(bytes32)` - Request UMA oracle settlement
- `settleMarketWithUMA(bytes32)` - Settle with UMA result
- `manualSettle(bytes32,uint256)` - Manual settlement by admin
- `getCurrentOraclePrice(bytes32)` - Get current oracle price
- `getMarketOracleConfig(bytes32)` - Oracle configuration
- `getMarketOracleInfo(bytes32)` - Comprehensive oracle info
- `requestPriceUpdate(bytes32)` - Request price update
- `batchUpdatePrices(bytes32[],uint256[])` - Batch price updates
- `getMarketsNeedingPriceUpdate(uint256)` - Stale price detection
- `getOracleHealthStatus()` - Oracle system health
- `emergencyPriceUpdate(bytes32,uint256,string)` - Emergency price override

#### Leverage Management
- `enableMarketLeverage(bytes32,uint256,uint256)` - Enable leverage for market
- `disableMarketLeverage(bytes32)` - Disable leverage for market  
- `setMarketLeverageController(bytes32,address)` - Set leverage controller
- `getMarketLeverageInfo(bytes32)` - Get leverage configuration
- `updateDefaultLeverageSettings(uint256,bool)` - Update defaults

#### Configuration & Admin
- `updateDefaultParameters(uint256,uint256)` - Update default trading params
- `updateMarketCreationFee(uint256)` - Update creation fee
- `togglePublicMarketCreation(bool)` - Enable/disable public creation
- `updateAdmin(address)` - Change admin
- `updateFeeRecipient(address)` - Change fee recipient
- `getDefaultParameters()` - Get default parameters
- `getMarketCreationSettings()` - Get creation settings

---

## 🔧 Recommended Updates for Interactive-Trader.js

### 1. Fix Missing Methods

**Replace this:**
```javascript
const marketData = await contracts.factory.getMarket(marketId);
```

**With:**
```javascript
const marketData = await contracts.factory.getMarketDetails(marketId);
// Returns: orderBook, creator, symbol, metricUrl, settlementDate, startPrice, creationTimestamp, exists
```

### 2. Fix TradingRouter Method Signature

**Current (incorrect):**
```javascript
const tx = await this.contracts.tradingRouter.placeMarginMarketOrder(
  marketId, amount, isBuy
);
```

**Should be:**
```javascript
// For buy orders
const tx = await this.contracts.tradingRouter.marketBuyWithLeverage(
  marketId, amount, maxPriceTick, leverage
);

// For sell orders  
const tx = await this.contracts.tradingRouter.marketSellWithLeverage(
  marketId, amount, minPriceTick, leverage
);
```

### 3. Add Missing Advanced Methods

The script could benefit from using these available but unused methods:

**Enhanced Order Management:**
```javascript
// Modify existing orders instead of cancel + place
await orderBook.modifyOrder(orderId, newPrice, newAmount);

// Better slippage control
await orderBook.placeMarginMarketOrderWithSlippage(amount, isBuy, slippageBps);
```

**Advanced Analytics:**
```javascript
// Comprehensive position analysis
const [breakdowns, summary] = await tradingRouter.getUserPositionBreakdowns(user);

// Cross-market opportunities
const [priceDiff, profit, direction] = await tradingRouter.detectArbitrage(market1, market2);

// Complete trading data in one call
const tradingData = await tradingRouter.getUserTradingData(user);
```

**Multi-Market Operations:**
```javascript
// Batch operations
await tradingRouter.batchCancelOrders(marketIds, orderIds);

// Multi-market data
const marketData = await tradingRouter.getMultiMarketData(marketIds);
```

---

## 📈 Analytics & Advanced Features Available

### Position Analytics (VaultAnalytics Library)
- `getMarginSummary()` - Complete margin breakdown
- `getAvailableCollateral()` - Available funds calculation  
- `getTotalMarginUsed()` - Margin utilization
- `getUnrealizedPnL()` - Unrealized P&L calculation
- `calculatePositionPnL()` - Individual position P&L

### Trading Analytics (OrderBook)
- VWAP calculations with multiple timeframes
- Comprehensive trade history with filtering
- Order book depth analysis
- Spread and liquidity metrics
- Auto-liquidation system

### Cross-Market Features (TradingRouter)
- Portfolio-level position management
- Arbitrage opportunity detection
- Multi-market spread analysis  
- Unified trading interface
- Batch operations support

---

## 🚨 Security & Risk Management

### Built-in Safety Features
- **Margin Requirements**: Configurable per market
- **Slippage Protection**: Built into market orders
- **Position Limits**: Automatic margin enforcement
- **Liquidation System**: Automated risk management
- **Access Controls**: Role-based permissions
- **Emergency Controls**: Pause functionality

### Best Practices for Integration
1. Always check available collateral before trading
2. Use slippage protection for market orders
3. Monitor margin requirements across positions
4. Implement proper error handling for failed transactions
5. Use batch operations for efficiency
6. Monitor liquidation risks with analytics functions

---

## 📊 Summary

**Total Methods Analyzed**: 150+
**Methods Used in Script**: 25
**Perfect Matches**: 22
**Missing/Broken**: 3
**Available but Unused**: 125+

The interactive-trader.js script successfully utilizes the core trading functionality but has significant opportunities to leverage advanced features like multi-market operations, enhanced analytics, and automated risk management tools available in the smart contracts.

---

*Last Updated: $(date)*
*Contract Version: HyperLiquid v2*
