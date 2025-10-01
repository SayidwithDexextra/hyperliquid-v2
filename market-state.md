### Market

- **symbol**: ALU-USD
- **mark price (for initial trades)**: $1.00
- **would-be mark price (mid of book)**: $2.25
- **leverage**: disabled
- **margin**: longs 100%, shorts 150%
- **trading fee**: 0%

### Users (post-deposit)

- **Deployer**: wallet 9,500 USDC, collateral 500 USDC
- **User 1**: wallet 9,500 USDC, collateral 500 USDC
- **User 2**: wallet 9,500 USDC, collateral 500 USDC
- **User 3**: wallet 9,985 USDC, collateral 15 USDC
- **User 4**: wallet 9,500 USDC, collateral 500 USDC

### Positions

- **Deployer**: long +4 ALU @ $1.00 (open)
- **User 1**: long +6 ALU @ $1.00 (open)
- **User 3**: short −10 ALU @ $1.00 (open, liq @ $2.08)

### Order Book

- **active ask**: User 2 — 20 ALU @ $2.30
- **active bid**: User 4 — 20 ALU @ $2.20
- **best bid**: $2.20
- **best ask**: $2.30



### On User 4 best bid @ $2.20 (expected behavior)

- **order book update**: best bid becomes $2.20 while best ask remains $2.30 (20 ALU).
- **mark price recalculation**: with both sides present, mark = mid-price = ($2.20 + $2.30) / 2 = **$2.25**.
- **price sync**: `OrderBook` emits `PriceUpdated` and calls `CoreVault.updateMarkPrice(...)` with $2.25.
- **liquidation scan**: price movement ≥ 2% vs last mark triggers `LiquidationCheckTriggered` and `_checkPositionsForLiquidation`.
- **User3 status**: short −10 @ $1.00 with liq @ **$2.08** → now liquidatable at mark $2.25.
- **auto-liquidation flow (short)**:
  - Creates market BUY for 10 ALU with 15% slippage bound → max buy price ≈ $2.25 × 1.15 = **$2.5875**.
  - Fills against User2 ask at **$2.30** (within bounds), closing User3's short to 0.
  - `CoreVault` seizes collateral to cover loss and pays maker reward; emits `LiquidationExecuted`, `MakerLiquidationRewardPaid`, and position update events.
- **post-liquidation book**: User2 ask reduces to 10 ALU @ $2.30; best bid stays $2.20 → mark remains **$2.25**.


### Liquidation, equity, gap loss, and socialized loss

- **realized loss (short close)**: `loss = (executionPrice − entryPrice) × size`.
  - With execution at $2.30, entry $1.00, size 10 → loss = (2.30 − 1.00) × 10 = **$13.00**.
- **collateral coverage**: User3 collateral = **$15.00**. With fee = 0%, loss is covered, leaving up to **$2.00** for penalty/maker reward.
- **penalty & rewards**:
  - `CoreVault` applies liquidation penalty per configured MMR params; emits `MarginConfiscated(user, seized, penalty, liquidator)`.
  - Maker on the opposite side may receive reward; emits `MakerLiquidationRewardPaid(maker, user, marketId, reward)`.
  - Aggregate deductions: `totalCost = loss + penalty + rewards (+ fees)`.
- **remaining equity vs gap loss**:
  - `remaining = collateral − totalCost`.
  - If `remaining ≥ 0`: user keeps any leftover as available collateral; emits `LiquidationExecuted(user, marketId, liquidator, seizedOrLoss, remainingCollateral)`.
  - If `remaining < 0`: shortfall = `abs(remaining)` is a **gap loss**.
    - `OrderBook` emits `GapLossDetected(trader, marketId, gapLossAmount, liquidationPrice, executionPrice, positionSize)` and `LiquidationRequiresSocialization(trader, remainingShortfall, userCollateralExhausted)`.
    - `CoreVault` starts socialization: `SocializationStarted(marketId, lossAmount, liquidatedUser, timestamp)`.
- **socialized loss mechanics (high-level)**:
  - Loss is distributed across opposing profitable positions and/or across all open positions according to vault policy.
  - As losses are applied, events are emitted per user: `AvailableCollateralConfiscated(user, amount, remainingAvailable)` and `UserLossSocialized(user, lossAmount, remainingCollateral)`.
  - Completion: `SocializationCompleted(marketId, totalLossCovered, remainingLoss, positionsAffected, liquidatedUser)`.
  - If the system cannot fully cover the shortfall (e.g., insufficient opposing equity): `SocializationFailed(marketId, lossAmount, reason, liquidatedUser)`.
- **this scenario (with $2.30 fill)**:
  - Trading loss $13.00 is fully covered by User3’s $15.00 collateral; penalty/reward are taken from the ~$2.00 remainder. No socialization occurs here because there is no uncovered trading loss. Any uncollected penalty is not socialized.


### Penalty and maker reward computation (from CoreVault rules)

- **constants**: LIQUIDATION_PENALTY_BPS = 10% (penalty on notional).
- **inputs**: size = 10 ALU (short), execution price = $2.30, entry = $1.00, locked collateral ≈ $15.00.
- **notional at execution**: 10 × $2.30 = **$23.00**.
- **penalty (10%)**: 10% × $23.00 = **$2.30**.
- **trading loss**: ($2.30 − $1.00) × 10 = **$13.00**.
- **actual loss**: trading loss + penalty = $13.00 + $2.30 = **$15.30**.
- **seized**: min(actual loss, locked, collateral) = min($15.30, $15.00, $15.00) = **$15.00**.
- **seized remainder after trading loss**: $15.00 − $13.00 = **$2.00**.
- **maker reward pool (credited to OB)**: min(penalty, seized remainder) = min($2.30, $2.00) = **$2.00**.
- **uncovered trading loss**: max($13.00 − $15.00, 0) = **$0.00** (no socialization).
- **uncovered penalty (not socialized)**: $2.30 − $2.00 = **$0.30**.

- **check vs $2 remainder**: penalty exceeds remainder by **$0.30**. Makers are paid **$2.00** total; the extra **$0.30** penalty is not collected nor socialized. Therefore, no socialized loss occurs in this scenario.
