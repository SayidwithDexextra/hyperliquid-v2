// Script to identify all decimal precision issues in interactive-trader.js
const fs = require("fs");

console.log("Analyzing decimal precision issues in interactive-trader.js...\n");

// Based on the tokenDecimals.MD reference:
// - USDC: 6 decimals
// - ALU (and most tokens): 18 decimals
// - Prices: 6 decimals (USDC)
// - Sizes/Amounts: 18 decimals (ALU)

console.log("Known decimal formats:");
console.log("- USDC values (collateral, fees, prices): 6 decimals");
console.log("- ALU amounts (sizes, positions): 18 decimals");
console.log("- Mixed calculations need careful handling\n");

console.log("Issues found in portfolio display:");
console.log(
  "1. totalCollateral - Being formatted with formatUSDC but might be in 18 decimals"
);
console.log("2. realizedPnL - Might be in 18 decimals instead of 6");
console.log(
  "3. marginSummary fields - Need to verify each field's decimal precision"
);
console.log(
  "4. Portfolio value calculation - Already fixed to handle mixed decimals"
);
console.log("5. unrealizedPnL - Already fixed to use 18 decimals");

console.log("\nRecommended fixes:");
console.log(
  "1. Check contract's MarginSummary struct to understand each field's precision"
);
console.log(
  "2. Create helper functions to handle different decimal precisions"
);
console.log(
  "3. Verify all formatUSDC calls are only used for 6-decimal values"
);
console.log("4. Create formatALU for 18-decimal values");
console.log("5. Add explicit comments about decimal precision for each field");
