# Market Setup & Authorization Guide

This guide explains the authorization requirements needed for a market to begin trading seamlessly.

## Quick Start

For markets created via `FuturesMarketFactory.createFuturesMarket()`, all authorizations are handled automatically. For manual setup, follow the requirements below.

## Core Authorization Requirements

### 1. Contract Roles

| Contract | Required Role | Purpose |
|----------|--------------|---------|
| FuturesMarketFactory | `FACTORY_ROLE` | Register OrderBooks & assign markets |
| OrderBook | `ORDERBOOK_ROLE` | Execute trades & manage margin |

### 2. Market Setup Steps

1. **Register OrderBook** - `vault.registerOrderBook(orderBookAddress)`
2. **Assign Market** - `vault.assignMarketToOrderBook(marketId, orderBookAddress)`
3. **Market Authorization** - Happens automatically during assignment

### 3. Key Permissions

**ORDERBOOK_ROLE permits:**
- Lock/release margin for positions
- Reserve/unreserve margin for orders
- Update user positions
- Transfer collateral (spot trades)
- Deduct trading fees

**FACTORY_ROLE permits:**
- Register new OrderBooks
- Assign markets to OrderBooks
- Update mark prices

### 4. Verification Checklist

```javascript
// Verify market is ready for trading
const isReady = await checkMarketAuthorization(orderBookAddress, marketId);

async function checkMarketAuthorization(orderBook, marketId) {
    const vault = await getContract("CENTRALIZED_VAULT");
    
    return {
        hasOrderBookRole: await vault.hasRole(ORDERBOOK_ROLE, orderBook),
        isRegistered: await vault.registeredOrderBooks(orderBook),
        marketAuthorized: await vault.authorizedMarkets(marketId),
        correctAssignment: await vault.marketToOrderBook(marketId) === orderBook
    };
}
```

### 5. Common Issues

| Error | Solution |
|-------|----------|
| "market not authorized" | Market needs assignment to OrderBook |
| "Only ORDERBOOK_ROLE" | Grant ORDERBOOK_ROLE to OrderBook |
| "OrderBook not registered" | Register OrderBook in vault |

## Manual Setup Script

For manual OrderBook deployment:

```javascript
// 1. Deploy OrderBook
const orderBook = await OrderBook.deploy(vault, marketId, feeRecipient);

// 2. Setup authorization (requires admin or factory role)
await vault.registerOrderBook(orderBook.address);
await vault.assignMarketToOrderBook(marketId, orderBook.address);

// 3. Verify setup
const ready = await checkMarketAuthorization(orderBook.address, marketId);
console.log("Market ready:", ready);
```

## Using the Factory (Recommended)

```javascript
// Automatic setup via factory
await factory.createFuturesMarket(
    marketSymbol,      // e.g., "BTC-USD"
    metricUrl,         // Data source URL
    settlementDate,    // Unix timestamp
    startPrice,        // Initial price (6 decimals)
    dataSource,        // e.g., "Binance"
    tags,             // ["CRYPTO", "BTC"]
    marginRequirement, // Basis points (10000 = 100%)
    tradingFee        // Basis points (10 = 0.1%)
);
// All authorizations handled automatically!
```

## Notes

- TradingRouter doesn't need special roles (uses delegated permissions)
- Each OrderBook has its own leverage controller
- Markets created via factory are automatically authorized
- Manual setup requires FACTORY_ROLE or admin privileges
