### Hack Mode — Market Legend

Use this guide to interact with the trading terminal’s Hack Mode. It provides fast, keyboard-driven control over all trading actions and a compact visual ledger of your recent operations.

### Activation
- On the `Select Your Trading Account` screen, press `H` to open Hack Mode.
- Press `ESC` to return to account selection at any time.
- Type `help` or `?` to print this legend in Hack Mode.

### Input Model
- Commands are space-separated tokens.
- You can chain multiple commands using a comma or semicolon: `,` or `;`.
- Optional user targeting prefix per command: `U{n}` (e.g., `U2`). If omitted, the currently selected user is used.
- Sizing mode for order commands:
  - `1` = token units (ALU)
  - `2` = USDC notional (auto-converted to units)

### Orders
- Limit Buy: `LB <price> <mode> <value>`
- Limit Sell: `LS <price> <mode> <value>`
- Market Buy: `MB <mode> <value> [slipBps]`
- Market Sell: `MS <mode> <value> [slipBps]`
- Notes:
  - `mode 1` expects ALU units. `mode 2` expects USDC notional.
  - `slipBps` is optional (default `100` = 1%).
  - Market orders convert notional using the current reference price (best bid/ask).

### Collateral
- Deposit: `DEP <amountUSDC>`
- Withdraw: `WDR <amountUSDC>`

### Cancel / Orders Management
- Cancel All: `CA`
- Cancel by Order ID: `CO <orderId>`
- Cancel Nth Order (1-based index in your list): `CNO <index>`
- View My Orders: `ORDS`

### Positions & Analytics
- View Open Positions (for current/target user): `POS`
- Portfolio box: `PF`
- Live Order Book: `OB`
- Overview (all users & markets): `OVR`
- Detailed Portfolio Analysis: `DPA`
- Detailed Margin Analysis: `DMA`
- Trade History: `TH`
- Liquidation History: `LH`
- Slippage Test: `SLT`

### Assertions (for automated checks)
- Strict mode: `STRICT ON|OFF` — when ON, failing assertions throw and stop batch execution.
- Sleep: `SLEEP <ms>` — pause between steps to allow state to propagate.
- Assert best-of-book:
  - `ASSERT BID <op> <price|NONE>` — check best bid matches operation (e.g., `== 2.40`, `>= 2.30`, or `NONE`).
  - `ASSERT ASK <op> <price|NONE>` — check best ask.
- Assert market depth at a price level:
  - `ASSERT DEPTH BID|ASK <price> <op> <units>` — verify total units available at a specific price level.
- Assert user orders:
  - `ASSERT ORDER [U{n}] BUY|SELL <price>` — verify that user has an order at price and side.
  - `ASSERT NO_ORDER [U{n}] BUY|SELL <price>` — verify absence of such order.
- Assert book empty:
  - `ASSERT BOOK_EMPTY` — verifies no bids and no asks in the book.
- Assert net positions:
  - `ASSERT POSITION [U{n}] LONG|SHORT <op> <units>` — verify net user exposure (long or short) in ALU units across all markets.
- Assert balances and socialized loss:
  - `ASSERT COLLAT [U{n}] <op> <usdc>` — user collateral in USDC.
  - `ASSERT AVAIL [U{n}] <op> <usdc>` — available collateral.
  - `ASSERT HAIRCUT [U{n}] <op> <usdc>` — accumulated socialized loss for user.

### Margin Operations
- Top Up Position Margin: `TUP <positionIndex> <amountUSDC>`
- Reduce Margin (if permitted): `RED <positionIndex> <amountUSDC>`

### Miscellaneous
- Switch User: `SU <userIndex>` (e.g., `SU 2` to switch to `User 2`)
- Print Legend: `help` or `?`
- Return: press `ESC` (typing `back` or `exit` also works)
- Batch: `RUN <path>` (execute a file containing commands)

### Examples
- Place multiple limit orders from different users:
  - `U1 LB 2.20 1 20, U2 LB 2.30 1 20`
- Place a limit order by notional instead of units:
  - `U1 LB 2.20 2 1000` (buys ~$1000 notional at $2.20)
- Market buy with 0.75% slippage cap:
  - `U2 MB 2 500 75`
- Collateral and quick info:
  - `U1 DEP 1000; U1 PF; U1 ORDS`
 - Run from a file in Hack Mode:
  - `RUN ./scenarios/opening-bids.txt`
 - CLI run on start (skips to batch before UI):
  - `npx hardhat run scripts/interactive-trader.js --network localhost -- --hack-file ./scenarios/opening-bids.txt`

### Example Assertions
- `ASSERT BID == 2.40`
- `ASSERT ASK NONE`
- `ASSERT ORDER U1 BUY 2.40`
- `ASSERT NO_ORDER U2 SELL 2.60`
- `STRICT ON` (stop on first failure)
- Margin operations:
  - `U3 TUP 1 250` (top up position #1 by $250)
  - `U4 RED 1 100` (reduce margin on position #1 by $100, if permitted)
- Cancellations:
  - `U2 CNO 2` (cancel second order in list)
  - `U2 CA` (cancel all orders)

### Ledger & Feedback
- After each batch, a compact ledger prints recent actions with timestamps and status:
  - `✅` success, `❌` error
  - Includes a short summary (e.g., `LB 20 @ $2.2`, `DEP $1000`, `CA 3`).

### Notes & Best Practices
- Units & Decimals: ALU uses 18 decimals on-chain; USDC uses 6 decimals. Inputs are human-readable; the terminal converts to appropriate on-chain precision.
- Collateral Check: Limit orders pre-check available collateral and warn if insufficient.
- Market Notional Mode: For `MB`/`MS` with `mode 2`, notional is converted using current reference price (best bid/ask); execution may vary within slippage bounds.
- Multi-User: Prefix each command independently with `U{n}` when batching across users.
- Delimiters: Both `,` and `;` are supported between commands.


