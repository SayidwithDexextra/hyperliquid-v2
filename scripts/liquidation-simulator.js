#!/usr/bin/env node

// liquidation-simulator.js - Detailed Liquidation Analysis & Simulation
//
// 🎯 FEATURES:
//   ✅ Find user 2's short position
//   ✅ Calculate exact liquidation price
//   ✅ Simulate price movements to trigger liquidation
//   ✅ Stop one trade before liquidation
//   ✅ Provide exact steps to trigger liquidation
//

const { ethers } = require("hardhat");
const {
  getContract,
  getAddress,
  MARKET_INFO,
  displayFullConfig,
} = require("../config/contracts");

// 🎨 COLOR PALETTE
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
};

// Helper functions
function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(2);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

function formatUSDC(amount) {
  return parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
}

// Get all users from events
async function getAllUsers(orderBook) {
  const users = new Set();

  try {
    const positionEvents = await orderBook.queryFilter(
      orderBook.filters.PositionUpdated()
    );
    positionEvents.forEach((event) => {
      if (event.args && event.args.user) {
        users.add(event.args.user);
      }
    });
  } catch (error) {
    console.log(
      `${colors.yellow}Warning: Could not fetch position events${colors.reset}`
    );
  }

  try {
    const orderEvents = await orderBook.queryFilter(
      orderBook.filters.OrderPlaced()
    );
    orderEvents.forEach((event) => {
      if (event.args && event.args.trader) {
        users.add(event.args.trader);
      }
    });
  } catch (error) {
    console.log(
      `${colors.yellow}Warning: Could not fetch order events${colors.reset}`
    );
  }

  return Array.from(users);
}

// Find user 2's position
async function findUser2Position(orderBook, users) {
  console.log(
    `${colors.brightCyan}🔍 FINDING USER 2'S POSITION${colors.reset}`
  );
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  const currentPrice = await orderBook.getMarkPrice();
  console.log(
    `\n${colors.bright}Current Mark Price: ${colors.blue}$${formatPrice(
      currentPrice
    )}${colors.reset}\n`
  );

  let user2Address = null;
  let user2Position = null;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(
      `${colors.bright}User ${i + 1}: ${colors.cyan}${user}${colors.reset}`
    );

    try {
      // Check simple position
      const position = await orderBook.userPositions(user);
      console.log(
        `  Simple Position: ${
          position !== 0n ? formatAmount(position) : "None"
        }`
      );

      // Check isolated positions
      const positionIds = await orderBook.getUserPositions(user);
      console.log(`  Isolated Positions: ${positionIds.length}`);

      for (const positionId of positionIds) {
        const isolatedPos = await orderBook.getPosition(user, positionId);
        console.log(`    Position #${positionId}:`);
        console.log(`      Size: ${formatAmount(isolatedPos.size)}`);
        console.log(
          `      Entry Price: $${formatPrice(isolatedPos.entryPrice)}`
        );
        console.log(
          `      Isolated Margin: $${formatUSDC(isolatedPos.isolatedMargin)}`
        );
        console.log(
          `      Liquidation Price: $${formatPrice(
            isolatedPos.liquidationPrice
          )}`
        );

        // Check if this is a short position at $3.10
        if (
          isolatedPos.size < 0n &&
          formatPrice(isolatedPos.entryPrice) === "3.10"
        ) {
          user2Address = user;
          user2Position = isolatedPos;
          console.log(
            `      ${colors.brightGreen}🎯 FOUND USER 2'S SHORT POSITION!${colors.reset}`
          );
        }
      }

      console.log();
    } catch (error) {
      console.log(`  ${colors.red}Error: ${error.message}${colors.reset}\n`);
    }
  }

  return { user2Address, user2Position };
}

// Simulate liquidation scenario
async function simulateLiquidationScenario(
  orderBook,
  user2Address,
  user2Position
) {
  if (!user2Address || !user2Position) {
    console.log(
      `${colors.red}❌ User 2's short position not found${colors.reset}`
    );
    return;
  }

  console.log(`\n${colors.brightCyan}⚡ LIQUIDATION SIMULATION${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  const currentPrice = await orderBook.getMarkPrice();
  const liquidationPrice = user2Position.liquidationPrice;

  console.log(`\n${colors.bright}User 2's Position Details:${colors.reset}`);
  console.log(`  Address: ${colors.cyan}${user2Address}${colors.reset}`);
  console.log(
    `  Position: ${colors.red}SHORT ${formatAmount(user2Position.size)} units${
      colors.reset
    }`
  );
  console.log(`  Entry Price: $${formatPrice(user2Position.entryPrice)}`);
  console.log(`  Current Price: $${formatPrice(currentPrice)}`);
  console.log(
    `  Liquidation Price: ${colors.red}$${formatPrice(liquidationPrice)}${
      colors.reset
    }`
  );
  console.log(
    `  Isolated Margin: $${formatUSDC(user2Position.isolatedMargin)}`
  );

  // Calculate PnL
  const positionFloat = Math.abs(
    parseFloat(ethers.formatUnits(user2Position.size, 18))
  );
  const entryPriceFloat = parseFloat(
    ethers.formatUnits(user2Position.entryPrice, 6)
  );
  const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));

  const pnlFloat = positionFloat * (entryPriceFloat - currentPriceFloat); // Short position PnL
  const pnl = BigInt(Math.round(pnlFloat * 1e6));
  const isProfit = pnl >= 0n;
  const percentage = (pnlFloat / (positionFloat * entryPriceFloat)) * 100;

  console.log(`\n${colors.bright}Current PnL:${colors.reset}`);
  console.log(
    `  PnL: ${isProfit ? colors.green : colors.red}$${formatUSDC(
      pnl
    )} (${percentage.toFixed(2)}%)${colors.reset}`
  );

  // Check if already at liquidation risk
  const isAtRisk = currentPrice >= liquidationPrice;
  if (isAtRisk) {
    console.log(
      `\n${colors.brightRed}⚠️  POSITION IS ALREADY AT LIQUIDATION RISK! ⚠️${colors.reset}`
    );
    return;
  }

  // Calculate price movement needed
  const priceDiff = liquidationPrice - currentPrice;
  const priceDiffFloat = parseFloat(ethers.formatUnits(priceDiff, 6));
  const percentageMove = (priceDiffFloat / currentPriceFloat) * 100;

  console.log(`\n${colors.bright}Liquidation Analysis:${colors.reset}`);
  console.log(
    `  Price movement needed: ${colors.yellow}$${formatPrice(priceDiff)}${
      colors.reset
    }`
  );
  console.log(
    `  Percentage move required: ${colors.yellow}${percentageMove.toFixed(2)}%${
      colors.reset
    }`
  );
  console.log(`  Current price: $${formatPrice(currentPrice)}`);
  console.log(`  Target liquidation price: $${formatPrice(liquidationPrice)}`);

  // Simulate stopping one trade before liquidation
  const stopBeforeLiquidation =
    liquidationPrice - BigInt(Math.round(0.01 * 1e6)); // $0.01 before liquidation
  const stopPriceFloat = parseFloat(
    ethers.formatUnits(stopBeforeLiquidation, 6)
  );
  const stopPriceDiff = stopBeforeLiquidation - currentPrice;
  const stopPriceDiffFloat = parseFloat(ethers.formatUnits(stopPriceDiff, 6));
  const stopPercentageMove = (stopPriceDiffFloat / currentPriceFloat) * 100;

  console.log(
    `\n${colors.bright}Stop One Trade Before Liquidation:${colors.reset}`
  );
  console.log(
    `  Stop price: ${colors.yellow}$${formatPrice(stopBeforeLiquidation)}${
      colors.reset
    }`
  );
  console.log(
    `  Price movement to stop: ${colors.yellow}$${formatPrice(stopPriceDiff)}${
      colors.reset
    }`
  );
  console.log(
    `  Percentage move to stop: ${colors.yellow}${stopPercentageMove.toFixed(
      2
    )}%${colors.reset}`
  );

  // Calculate PnL at stop price
  const stopPnlFloat = positionFloat * (entryPriceFloat - stopPriceFloat);
  const stopPnl = BigInt(Math.round(stopPnlFloat * 1e6));
  const stopIsProfit = stopPnl >= 0n;
  const stopPercentage =
    (stopPnlFloat / (positionFloat * entryPriceFloat)) * 100;

  console.log(`\n${colors.bright}PnL at Stop Price:${colors.reset}`);
  console.log(
    `  PnL: ${stopIsProfit ? colors.green : colors.red}$${formatUSDC(
      stopPnl
    )} (${stopPercentage.toFixed(2)}%)${colors.reset}`
  );

  // Provide exact steps to trigger liquidation
  console.log(
    `\n${colors.brightCyan}🎯 EXACT STEPS TO TRIGGER LIQUIDATION${colors.reset}`
  );
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  console.log(
    `\n${colors.bright}Step 1: Place a large buy order at or above liquidation price${colors.reset}`
  );
  console.log(`  - Price: $${formatPrice(liquidationPrice)} or higher`);
  console.log(
    `  - Size: At least ${formatAmount(
      user2Position.size
    )} units (to fully liquidate)`
  );
  console.log(`  - This will immediately trigger liquidation when matched`);

  console.log(
    `\n${colors.bright}Step 2: Alternative - Place multiple smaller orders${colors.reset}`
  );
  console.log(
    `  - Start with orders at $${formatPrice(stopBeforeLiquidation)}`
  );
  console.log(
    `  - Gradually increase price to $${formatPrice(liquidationPrice)}`
  );
  console.log(`  - Each order will move the mark price closer to liquidation`);

  console.log(`\n${colors.bright}Step 3: Market order approach${colors.reset}`);
  console.log(
    `  - Place a market buy order for ${formatAmount(user2Position.size)} units`
  );
  console.log(`  - This will match against existing sell orders`);
  console.log(
    `  - If no sell orders exist, it will create a buy order at current price`
  );
  console.log(
    `  - Then place another order at liquidation price to trigger liquidation`
  );

  // Check current order book for available liquidity
  console.log(`\n${colors.bright}Current Order Book Analysis:${colors.reset}`);
  const bestBid = await orderBook.bestBid();
  const bestAsk = await orderBook.bestAsk();

  console.log(
    `  Best Bid: ${bestBid > 0n ? `$${formatPrice(bestBid)}` : "None"}`
  );
  console.log(
    `  Best Ask: ${
      bestAsk < ethers.MaxUint256 ? `$${formatPrice(bestAsk)}` : "None"
    }`
  );

  if (bestAsk < ethers.MaxUint256) {
    const askFloat = parseFloat(ethers.formatUnits(bestAsk, 6));
    const liquidationFloat = parseFloat(
      ethers.formatUnits(liquidationPrice, 6)
    );

    if (askFloat <= liquidationFloat) {
      console.log(
        `  ${colors.green}✅ Existing sell orders can trigger liquidation${colors.reset}`
      );
    } else {
      console.log(
        `  ${colors.yellow}⚠️  Need to place new orders to reach liquidation price${colors.reset}`
      );
    }
  } else {
    console.log(
      `  ${colors.red}❌ No sell orders available - need to create liquidity${colors.reset}`
    );
  }

  return {
    user2Address,
    user2Position,
    currentPrice,
    liquidationPrice,
    stopBeforeLiquidation,
    priceDiff,
    percentageMove,
  };
}

// Main function
async function runLiquidationSimulator() {
  console.log(`${colors.brightCyan}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                ⚡ LIQUIDATION SIMULATOR ⚡                  ║"
  );
  console.log(
    "║              Find User 2 & Simulate Liquidation             ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log(`${colors.reset}`);

  try {
    // Get contracts
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");

    console.log(
      `${colors.bright}📡 Connected to contracts successfully${colors.reset}\n`
    );

    // Get all users
    const users = await getAllUsers(orderBook);
    console.log(
      `${colors.bright}👥 Found ${users.length} users in the system${colors.reset}\n`
    );

    // Find user 2's position
    const { user2Address, user2Position } = await findUser2Position(
      orderBook,
      users
    );

    // Simulate liquidation scenario
    const result = await simulateLiquidationScenario(
      orderBook,
      user2Address,
      user2Position
    );

    if (result) {
      console.log(
        `\n${colors.brightGreen}🎉 Liquidation simulation complete!${colors.reset}`
      );
      console.log(`\n${colors.bright}Summary:${colors.reset}`);
      console.log(`  User 2: ${result.user2Address}`);
      console.log(
        `  Position: SHORT ${formatAmount(
          result.user2Position.size
        )} @ $${formatPrice(result.user2Position.entryPrice)}`
      );
      console.log(
        `  Liquidation Price: $${formatPrice(result.liquidationPrice)}`
      );
      console.log(`  Current Price: $${formatPrice(result.currentPrice)}`);
      console.log(
        `  Price Move Needed: $${formatPrice(
          result.priceDiff
        )} (${result.percentageMove.toFixed(2)}%)`
      );
    }
  } catch (error) {
    console.log(
      `${colors.red}❌ Error in liquidation simulator: ${error.message}${colors.reset}`
    );
    console.log(error.stack);
  }
}

// Export functions for reuse
module.exports = {
  runLiquidationSimulator,
  findUser2Position,
  simulateLiquidationScenario,
};

// Run if called directly
if (require.main === module) {
  runLiquidationSimulator().catch(console.error);
}


