Scenario Setup

Trader D is short 10 units @ $1.

Proceeds from the short: $10.

Collateral posted (150% rule): $15.

Total funds: $25.

Liquidation price: $2.08.

At liquidation event, order book liquidity:

3 units available @ $2.09

No deeper liquidity.

Step 1 — Liquidation triggered

Trader D’s equity falls below maintenance margin.

Liquidation engine attempts to close the short position.

Step 2 — Attempt to close the position

The engine buys back as many units as the market allows.

Only 3 units @ $2.09 can be filled.

Accounting of the fill

Cost to repurchase = 3 × $2.09 = $6.27.

Remaining position = 7 short units still open.

Step 3 — Handling the unfilled 7 units

The remaining 7 units stay in Trader D’s account.

They are marked at the current mark price ($2.08) for accounting purposes.

They remain under liquidation watch, meaning the engine will try to liquidate them again when liquidity becomes available.

Why we leave them in the account

Posting all 7 units to the order book immediately could fail if there’s no taker.

Leaving them in the account allows gradual liquidation without artificially inflating slippage.

Step 4 — Checking solvency after partial fill

Total repurchase cost:

Filled 3 units = $6.27

Remaining 7 units valued at mark price = 7 × $2.08 = $14.56

Total = $20.83

Short proceeds originally received = $10

Net requirement = $20.83 − $10 = $10.83

Trader D had $15 collateral → enough to cover.

Remaining collateral = $15 − $10.83 = $4.17

Result: Trader D remains solvent. No socialized loss is applied.

Step 5 — When socialized loss would apply

If Trader D’s total cost had exceeded their collateral + proceeds, the shortfall would trigger the socialized loss system.

Socialized loss does not reduce units. Instead, it:

Records a global loss amount (S).

Reduces other traders’ future realized profits proportionally when they take profits.

Final State

Trader D’s position: 7 units still short.

Collateral left: $4.17.

Liquidation engine continues monitoring and will attempt to close remaining units as liquidity becomes available.

Socialized loss remains 0, because Trader D’s funds were sufficient.

✅ Key Takeaways

Filled portion executes immediately.

Unfilled units remain in the account, marked at the mark price.

Collateral covers losses first.

Socialized loss only applies if losses exceed total funds.

The system can continuously liquidate remaining units as liquidity appears.