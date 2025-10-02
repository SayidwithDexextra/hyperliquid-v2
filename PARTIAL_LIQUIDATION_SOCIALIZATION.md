### Partial-Fill Liquidation and Socialized Loss (Current Implementation)

This note explains how the protocol handles liquidations when only part of a position can be executed immediately (partial fills), and how any uncovered trading loss is socialized.

### Key Concepts
- **settlePrice**: For liquidation, the vault uses the worst execution price seen during the liquidation attempt if any fills occurred; otherwise it uses the current mark price provided by the order book.
- **marginLocked**: Collateral reserved for the position. Liquidation seizes from `marginLocked` (bounded by the user's available collateral). Only the portion of trading loss not covered by seized funds is socialized. Penalties are never socialized.
- **Penalty**: Applied on the position notional at `settlePrice`. It is deducted from seized funds before rewards. Not socialized.
- **Uncovered trading loss**: `max(0, tradingLoss - seized)`. This is the only value that goes to ADL/socialization.
- **Socialization allocation**: Distributed across profitable positions in the same market proportional to each position's notional at the current mark.

### Liquidation Flow (Short Example)
Assume a short position: size = 10 ALU, entry = $1.00, `marginLocked = $15.00`.

1) Trigger and execution
   - Liquidation is triggered (e.g., at mark $2.08). The order book buys to close the short.
   - Available asks allow only 3 units to fill at $2.09. The remaining 7 units cannot be executed now.

2) Determine settlePrice
   - Because there was at least one execution, `settlePrice = worstExecutionPrice = $2.09`.

3) Trading loss and penalty at settlePrice
   - Trading loss (short): `(settlePrice − entry) × size = (2.09 − 1.00) × 10 = $10.90`.
   - Penalty (example 10%): `penalty = notional × 10% = (10 × 2.09) × 10% = $2.09`.
   - Actual loss accounting figure: `actualLoss = tradingLoss + penalty = 10.90 + 2.09 = $12.99` (used to cap seizure from locked margin).

4) Seizure from marginLocked
   - Seizable amount: `seized = min(marginLocked, actualLoss) = min(15.00, 12.99) = $12.99`.
   - Of the seized amount, up to `tradingLoss` covers trading loss first.
   - Uncovered trading loss: `max(0, tradingLoss − seized) = max(0, 10.90 − 12.99) = $0.00` → no socialization.
   - Remainder of seized after trading loss contributes to penalty/rewards; penalties are not socialized.

5) Socialization trigger
   - Since `uncoveredLoss = 0`, ADL/socialization does not occur.

6) If uncoveredLoss > 0
   - When `seized < tradingLoss`, the uncovered portion is socialized.
   - Allocation per profitable position i: `assign_i = uncoveredLoss × (notional_i / totalNotionalProfitable)` using current mark for notionals.
   - Each recipient accrues `positions[j].socializedLossAccrued6 += assign_i` and `userSocializedLoss[user] += assign_i`.

### Worked Alternative (When marginLocked is Insufficient)
Change `marginLocked` to $9.00 with the same fills and prices.

1) Trading loss at settlePrice 2.09: $10.90; penalty 10% of notional: $2.09; actualLoss = $12.99
2) Seized = min(9.00, 12.99) = $9.00
3) Uncovered trading loss = max(0, 10.90 − 9.00) = $1.90 → socialize $1.90
4) Suppose two profitable positions with notionals at mark total $27.12, where User A has $20.86 and User B has $6.26
   - A: 1.90 × (20.86 / 27.12) ≈ $1.46 haircut
   - B: 1.90 × (6.26 / 27.12) ≈ $0.44 haircut

### Notes for Partial Fills
- Realized fills occur at actual trade prices. The vault settles the position at `settlePrice = worstExecutionPrice` for loss/penalty computation when any fills happen; otherwise it falls back to mark.
- Partial fills do not themselves cause socialization; only a shortfall of seized funds relative to trading loss does.
- Penalties reduce what remains for the user but are not socialized.

### Parameters and References
- Penalty: `LIQUIDATION_PENALTY_BPS = 1000` (10%).
- Short liquidation logic: see `CoreVault.liquidateShort`.
- Long liquidation logic: see `CoreVault.liquidateLong`.
- Socialization: `_socializeLoss` distributes uncovered trading loss across profitable positions by notional at mark.


