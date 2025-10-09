# OrderBook.sol Abstraction Plan - Size Reduction Strategy

## Current State Analysis

**Current Contract Size:**
- OrderBook.sol: 49,777 bytes (about 2.07x over the 24KB limit)
- Target: Reduce to under 24,000 bytes (24KB safe target)

**Largest Functions by Line Count (measured):**
1. `_executeTrade` - 202 lines (trade execution, margin updates, feeing, liquidation hooks)
2. `_calculateMarkPrice` - 185 lines (VWAP + hybrid mark + fallbacks)
3. `_executeLiquidationMarketOrder` - 151 lines (liquidation market execution + tracking)
4. `_checkPositionsForLiquidation` - 142 lines (vault-driven scan + guards)
5. `_matchBuyOrderWithSlippage` - 138 lines (buy-side matching loop)
6. `_matchSellOrderWithSlippage` - 103 lines (sell-side matching loop)
7. `getOrderBookDepth` - 80 lines (depth view + sorting)

## Core Abstraction Principle

**One-to-One State Preservation (Minimal Extraction):** We will keep a one-to-one state and behavior in terms of technical implementation. The plan is to copy and paste only the largest few functions and their utilities into separate helper contracts, and call them from `OrderBook.sol`. We are not redesigning logic; we are delegating it. All public interfaces and behavior remain identical, including seamless compatibility with `FuturesMarketFactory.sol`.

## Minimal Viable Abstraction Strategy (extract only the largest few)

We will extract in priority order and stop as soon as the bytecode is under 24KB.

### Priority 1: Liquidation Subsystem (largest responsibility)
**Create: `LiquidationProcessor.sol`**
**Copy/Paste Functions:**
- `_executeLiquidationMarketOrder`
- `_checkPositionsForLiquidation`
- `_checkAndLiquidateTrader`
- `_processEnhancedLiquidationWithGapProtection`
- `_resetLiquidationTracking`, `_recordLiquidationMakerContribution`, `_distributeLiquidationRewards`

**Why:** This block is very large and event-heavy; extracting it typically removes the most bytecode in one step.

### Priority 2: Trade Execution Core
**Create: `TradeExecutionEngine.sol`**
**Copy/Paste Functions:**
- `_executeTrade`
- `_handleMarginUpdate`, `_handleLiquidationMarginUpdate`
- `_assertPreTradeSolvency`, `_releaseExcessMargin`, `_calculateTradingFee`, `_safeMarginUpdate`

**Why:** Second largest single locus of complexity and bytecode density; isolates vault/margin pathways.

### Priority 3 (only if still above 24KB): Choose ONE of the following
Option A — **Mark Price + VWAP**: `_calculateMarkPrice`, `_lastTwoTradeVWAP`, `_lastUpToFourTradeVWAP`, `_hybridWeightBps`, `_updateVWAPData`
Option B — **Matching Loops**: `_matchBuyOrderWithSlippage`, `_matchSellOrderWithSlippage`

**Decision Rule:**
- If post-Priority 2 size is just slightly over target, move VWAP/mark (compact API, high bytes/line ratio).
- If still materially over, move the two matching loops (bigger code blocks).

## Interface Design Pattern

Each extracted contract will implement a clear interface:

```solidity
interface IOrderMatchingEngine {
    function matchBuyOrder(Order calldata order, uint256 maxPrice) external returns (uint256 remainingAmount);
    function matchSellOrder(Order calldata order, uint256 minPrice) external returns (uint256 remainingAmount);
}

interface ITradeExecutionEngine {
    function executeTrade(address buyer, address seller, uint256 price, uint256 amount, bool buyerMargin, bool sellerMargin) external;
    function handleMarginUpdate(address user, int256 oldPosition, int256 amount, uint256 price, bool isMargin) external;
}
```

## OrderBook Facade Implementation

The main OrderBook contract will act as a facade:

```solidity
contract OrderBook {
    IOrderMatchingEngine public immutable matchingEngine;
    ITradeExecutionEngine public immutable executionEngine;
    ILiquidationProcessor public immutable liquidationProcessor;
    IMarkPriceCalculator public immutable priceCalculator;
    IOrderBookStorage public immutable storageContract;

    // Existing public functions remain unchanged
    function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) external returns (uint256) {
        // ... validation logic ...
        return _placeLimitOrder(price, amount, isBuy, false, 0);
    }

    // Internal functions delegate to extracted contracts
    function _matchBuyOrderWithSlippage(Order memory buyOrder, uint256 remainingAmount, uint256 maxPrice)
        internal returns (uint256) {
        return matchingEngine.matchBuyOrder(buyOrder, maxPrice);
    }
}
```

## FuturesMarketFactory.sol Compatibility

**Guaranteed Compatibility:** All existing function calls from FuturesMarketFactory.sol will continue to work exactly as before:

- `OrderBook(orderBook).updateTradingParameters(...)` ✅
- `OrderBook(orderBook).enableLeverage(...)` ✅
- `OrderBook(orderBook).disableLeverage()` ✅
- `OrderBook(orderBook).setLeverageController(...)` ✅
- `OrderBook(orderBook).getLeverageInfo()` ✅

## Expected Size Reduction (minimal extraction)

We need to remove roughly ~25,800 bytes from the current 49,777 bytes.

Estimated impact (guidance only; actual depends on compiler):
- Priority 1 (Liquidation Subsystem): ~12–18 KB
- Priority 2 (Trade Execution Core): ~8–12 KB
- Priority 3 (either Mark Price or Matching Loops): ~6–10 KB

Plan to stop immediately once the deployed bytecode is < 24,000 bytes.

**Risk Mitigation:**
- Each extracted contract is independently testable
- Gradual rollout allows for validation at each phase
- Maintains exact behavioral equivalence
- No breaking changes to external interfaces

## Implementation Sequence

1. Copy/paste Priority 1 functions into `LiquidationProcessor.sol`; wire calls from `OrderBook.sol`.
2. Recompile and check size. If still > 24KB, do Priority 2.
3. Recompile and check size. If still > 24KB, do Priority 3 (choose A or B per rule).
4. Keep all public interfaces unchanged; `OrderBook.sol` remains the single external entry point.
5. Comprehensive tests to validate one-to-one behavior.

This approach preserves a one-to-one technical implementation by copying functions verbatim into helper contracts and delegating from `OrderBook.sol`, extracting only the largest few responsibilities necessary to get under the size limit.
