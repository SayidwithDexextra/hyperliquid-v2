#!/usr/bin/env node

// liquidation-driver.js - Interactive Price Manipulation & Liquidation Driver
//
// 🎯 FEATURES:
//   ✅ Real-time OrderBook state monitoring
//   ✅ Interactive price adjustment controls
//   ✅ Gradual price movement execution
//   ✅ Liquidation target tracking
//   ✅ Smart order placement strategy
//   ✅ User-friendly interface
//
// 🚀 USAGE:
//   npx hardhat run scripts/liquidation-driver.js --network localhost
//

const { ethers } = require("hardhat");
const readline = require("readline");
const {
  getContract,
  getAddress,
  MARKET_INFO,
  displayFullConfig,
} = require("../config/contracts");

// 🎨 ENHANCED COLOR PALETTE
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
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

// Calculate PnL for a position
function calculatePnL(positionSize, entryPrice, currentPrice) {
  if (positionSize === 0n) return { pnl: 0n, isProfit: true, percentage: 0 };

  const sizeFloat = parseFloat(ethers.formatUnits(positionSize, 18));
  const entryFloat = parseFloat(ethers.formatUnits(entryPrice, 6));
  const currentFloat = parseFloat(ethers.formatUnits(currentPrice, 6));

  const pnlFloat =
    positionSize > 0n
      ? sizeFloat * (currentFloat - entryFloat) // Long position
      : sizeFloat * (entryFloat - currentFloat); // Short position

  const pnl = BigInt(Math.round(pnlFloat * 1e6));
  const isProfit = pnl >= 0n;
  const percentage =
    entryFloat > 0 ? Math.abs(pnlFloat / (sizeFloat * entryFloat)) * 100 : 0;

  return { pnl, isProfit, percentage };
}

// Get all users and their positions
async function getAllUsersAndPositions(orderBook) {
  const users = new Set();

  // Get users from events
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

  const userPositions = [];
  for (const user of users) {
    try {
      const positions = [];

      // Get isolated positions
      const positionIds = await orderBook.getUserPositions(user);
      for (const positionId of positionIds) {
        const isolatedPos = await orderBook.getPosition(user, positionId);
        if (isolatedPos.isActive) {
          positions.push({
            id: positionId,
            size: isolatedPos.size,
            entryPrice: isolatedPos.entryPrice,
            liquidationPrice: isolatedPos.liquidationPrice,
            isolatedMargin: isolatedPos.isolatedMargin,
            isIsolated: true,
          });
        }
      }

      // Get regular margin position
      const marginPosition = await orderBook.getUserPosition(user);
      if (marginPosition !== 0n) {
        // For regular margin positions, we need to calculate liquidation price
        // This is a simplified approach - in practice you'd need more data
        const currentPrice = await orderBook.getMarkPrice();
        const absSize = marginPosition > 0n ? marginPosition : -marginPosition;

        // Use current price as entry price for regular margin positions
        // In a real system, you'd store entry prices separately
        positions.push({
          id: 0, // Use 0 to indicate regular margin position
          size: marginPosition,
          entryPrice: currentPrice, // Simplified - would need actual entry price
          liquidationPrice: 0n, // Would need to calculate based on collateral
          isolatedMargin: 0n,
          isIsolated: false,
        });
      }

      if (positions.length > 0) {
        userPositions.push({
          address: user,
          positions: positions,
        });
      }
    } catch (error) {
      // Skip users with errors
    }
  }

  return userPositions;
}

// Find liquidation targets
function findLiquidationTargets(userPositions, currentPrice) {
  const targets = [];

  for (const user of userPositions) {
    for (const position of user.positions) {
      // Skip positions with no liquidation price (regular margin positions)
      if (position.liquidationPrice === 0n) {
        continue;
      }

      const isAtRisk =
        (position.size > 0n && currentPrice <= position.liquidationPrice) ||
        (position.size < 0n && currentPrice >= position.liquidationPrice);

      if (!isAtRisk) {
        const priceDiff =
          position.size > 0n
            ? position.liquidationPrice - currentPrice
            : currentPrice - position.liquidationPrice;

        const priceDiffFloat = parseFloat(ethers.formatUnits(priceDiff, 6));
        const percentageMove =
          (priceDiffFloat / parseFloat(ethers.formatUnits(currentPrice, 6))) *
          100;

        targets.push({
          user: user.address,
          positionId: position.id,
          size: position.size,
          entryPrice: position.entryPrice,
          liquidationPrice: position.liquidationPrice,
          currentPrice: currentPrice,
          priceDiff: priceDiff,
          percentageMove: percentageMove,
          isLong: position.size > 0n,
          isIsolated: position.isIsolated,
        });
      }
    }
  }

  // Sort by percentage move needed (closest to liquidation first)
  return targets.sort((a, b) => a.percentageMove - b.percentageMove);
}

// Display current market state
async function displayMarketState(orderBook, userPositions) {
  console.clear();
  console.log(`${colors.brightCyan}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                🎯 LIQUIDATION DRIVER 🎯                     ║"
  );
  console.log(
    "║              Interactive Price Manipulation                 ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log(`${colors.reset}`);

  const currentPrice = await orderBook.getMarkPrice();
  const bestBid = await orderBook.bestBid();
  const bestAsk = await orderBook.bestAsk();

  console.log(`\n${colors.bright}📊 CURRENT MARKET STATE${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);
  console.log(
    `  Mark Price: ${colors.blue}$${formatPrice(currentPrice)}${colors.reset}`
  );
  console.log(
    `  Best Bid: ${
      bestBid > 0n
        ? colors.green + `$${formatPrice(bestBid)}`
        : colors.red + "None"
    }${colors.reset}`
  );
  console.log(
    `  Best Ask: ${
      bestAsk < ethers.MaxUint256
        ? colors.red + `$${formatPrice(bestAsk)}`
        : colors.red + "None"
    }${colors.reset}`
  );

  if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2n;
    const spreadPercentage =
      (parseFloat(ethers.formatUnits(spread, 6)) /
        parseFloat(ethers.formatUnits(midPrice, 6))) *
      100;
    console.log(
      `  Spread: ${colors.yellow}$${formatPrice(
        spread
      )} (${spreadPercentage.toFixed(2)}%)${colors.reset}`
    );
  }

  // Display liquidation targets
  const targets = findLiquidationTargets(userPositions, currentPrice);
  console.log(`\n${colors.bright}🎯 LIQUIDATION TARGETS${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  if (targets.length === 0) {
    console.log(
      `  ${colors.green}✅ No liquidation targets found${colors.reset}`
    );
  } else {
    for (let i = 0; i < Math.min(targets.length, 5); i++) {
      const target = targets[i];
      const positionType = target.isLong ? "LONG" : "SHORT";
      const positionColor = target.isLong ? colors.green : colors.red;

      console.log(
        `  ${i + 1}. ${colors.cyan}${target.user.slice(0, 8)}...${
          colors.reset
        } (Position #${target.positionId})`
      );
      console.log(
        `     ${positionColor}${positionType} ${formatAmount(
          target.size
        )} @ $${formatPrice(target.entryPrice)}${colors.reset}`
      );
      console.log(
        `     Liquidation: ${colors.red}$${formatPrice(
          target.liquidationPrice
        )}${colors.reset}`
      );
      console.log(
        `     Move needed: ${colors.yellow}$${formatPrice(
          target.priceDiff
        )} (${target.percentageMove.toFixed(2)}%)${colors.reset}`
      );
      console.log();
    }
  }

  return { currentPrice, bestBid, bestAsk, targets };
}

// Place a market buy order to increase price
async function placeMarketBuyOrder(orderBook, amount) {
  try {
    const tx = await orderBook.placeMarginMarketOrder(
      amount,
      true // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Market buy order executed successfully${colors.reset}`
    );
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place market buy order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Place a market sell order to decrease price
async function placeMarketSellOrder(orderBook, amount) {
  try {
    const tx = await orderBook.placeMarginMarketOrder(
      amount,
      false // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Market sell order executed successfully${colors.reset}`
    );
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place market sell order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Place a limit buy order at specific price (for when no matching orders exist)
async function placeLimitBuyOrder(orderBook, price, amount) {
  try {
    const tx = await orderBook.placeMarginLimitOrder(
      price,
      amount,
      true // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Limit buy order placed successfully${colors.reset}`
    );
    console.log(`   Price: $${formatPrice(price)}`);
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place limit buy order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Place a limit sell order at specific price (for when no matching orders exist)
async function placeLimitSellOrder(orderBook, price, amount) {
  try {
    const tx = await orderBook.placeMarginLimitOrder(
      price,
      amount,
      false // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Limit sell order placed successfully${colors.reset}`
    );
    console.log(`   Price: $${formatPrice(price)}`);
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place limit sell order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Calculate order parameters
function calculateOrderParams(currentPrice, priceIncrease, orderSize) {
  const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
  const increaseFloat = parseFloat(priceIncrease);
  const newPriceFloat = currentPriceFloat + increaseFloat;
  const newPrice = ethers.parseUnits(newPriceFloat.toFixed(6), 6);

  const amount = ethers.parseUnits(orderSize.toString(), 18);
  const marginRequired = (amount * newPrice) / ethers.parseUnits("1", 18);

  return { newPrice, amount, marginRequired };
}

// Main interactive loop
async function runLiquidationDriver() {
  console.log(
    `${colors.bright}🚀 Starting Liquidation Driver...${colors.reset}\n`
  );

  try {
    // Get contracts
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const usdc = await getContract("MOCK_USDC");

    console.log(
      `${colors.bright}📡 Connected to contracts successfully${colors.reset}\n`
    );

    // Get current user positions
    const userPositions = await getAllUsersAndPositions(orderBook);
    console.log(
      `${colors.bright}👥 Found ${userPositions.length} users with positions${colors.reset}\n`
    );

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (question) => {
      return new Promise((resolve) => {
        rl.question(question, resolve);
      });
    };

    let running = true;
    let currentPrice = await orderBook.getMarkPrice();

    while (running) {
      // Display current state
      const marketState = await displayMarketState(orderBook, userPositions);
      currentPrice = marketState.currentPrice;

      console.log(`${colors.bright}🎮 INTERACTIVE CONTROLS${colors.reset}`);
      console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);
      console.log(`  +5%  - Increase price by 5%`);
      console.log(`  +10% - Increase price by 10%`);
      console.log(`  +25% - Increase price by 25%`);
      console.log(`  +50% - Increase price by 50%`);
      console.log(`  -5%  - Decrease price by 5%`);
      console.log(`  -10% - Decrease price by 10%`);
      console.log(`  -25% - Decrease price by 25%`);
      console.log(`  -50% - Decrease price by 50%`);
      console.log(`  target <price> - Set specific target price`);
      console.log(`  refresh - Refresh market state`);
      console.log(`  exit - Exit the application`);
      console.log();

      const input = await askQuestion(
        `${colors.bright}Enter command: ${colors.reset}`
      );

      const command = input.trim().toLowerCase();
      const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
      const orderSize = ethers.parseUnits("1", 18); // Fixed 1 unit order size

      if (command === "exit") {
        running = false;
        console.log(
          `\n${colors.brightGreen}👋 Exiting Liquidation Driver. Goodbye!${colors.reset}`
        );
        break;
      } else if (command === "refresh") {
        console.log(
          `\n${colors.bright}Refreshing market state...${colors.reset}`
        );
        // Refresh user positions
        const newUserPositions = await getAllUsersAndPositions(orderBook);
        userPositions.length = 0;
        userPositions.push(...newUserPositions);
        break;
      } else if (command.startsWith("target ")) {
        const targetPriceStr = command.replace("target ", "");
        const targetPriceFloat = parseFloat(targetPriceStr);

        if (isNaN(targetPriceFloat)) {
          console.log(
            `${colors.red}❌ Invalid target price. Please enter a number.${colors.reset}`
          );
          break;
        }

        if (targetPriceFloat > currentPriceFloat) {
          console.log(
            `\n${colors.bright}Executing market buy order to reach target price $${targetPriceFloat}...${colors.reset}`
          );
          await placeMarketBuyOrder(orderBook, orderSize);
        } else {
          console.log(
            `\n${colors.bright}Executing market sell order to reach target price $${targetPriceFloat}...${colors.reset}`
          );
          await placeMarketSellOrder(orderBook, orderSize);
        }
      } else if (command.startsWith("+") && command.endsWith("%")) {
        const percentage = parseFloat(command.slice(1, -1));

        if (isNaN(percentage)) {
          console.log(
            `${colors.red}❌ Invalid percentage. Please enter a number.${colors.reset}`
          );
          break;
        }

        const newPriceFloat = currentPriceFloat * (1 + percentage / 100);

        console.log(
          `\n${
            colors.bright
          }Executing market buy order to increase price by ${percentage}% ($${currentPriceFloat.toFixed(
            2
          )} → $${newPriceFloat.toFixed(2)})...${colors.reset}`
        );
        await placeMarketBuyOrder(orderBook, orderSize);
      } else if (command.startsWith("-") && command.endsWith("%")) {
        const percentage = parseFloat(command.slice(1, -1));

        if (isNaN(percentage)) {
          console.log(
            `${colors.red}❌ Invalid percentage. Please enter a number.${colors.reset}`
          );
          break;
        }

        const newPriceFloat = currentPriceFloat * (1 - percentage / 100);

        console.log(
          `\n${
            colors.bright
          }Executing market sell order to decrease price by ${percentage}% ($${currentPriceFloat.toFixed(
            2
          )} → $${newPriceFloat.toFixed(2)})...${colors.reset}`
        );
        await placeMarketSellOrder(orderBook, orderSize);
      } else {
        console.log(
          `\n${colors.red}❌ Invalid command. Please use one of the available commands.${colors.reset}`
        );
        console.log(
          `${colors.yellow}Examples: +5%, -10%, target 4.50, refresh, exit${colors.reset}`
        );
      }

      if (running && command !== "refresh") {
        console.log(
          `\n${colors.bright}Press Enter to continue...${colors.reset}`
        );
        await askQuestion("");
      }
    }

    rl.close();
  } catch (error) {
    console.log(
      `${colors.red}❌ Error in liquidation driver: ${error.message}${colors.reset}`
    );
    console.log(error.stack);
  }
}

// Export functions for reuse
module.exports = {
  runLiquidationDriver,
  getAllUsersAndPositions,
  findLiquidationTargets,
  displayMarketState,
  placeMarketBuyOrder,
  placeMarketSellOrder,
  placeLimitBuyOrder,
  placeLimitSellOrder,
};

// Run if called directly
if (require.main === module) {
  runLiquidationDriver().catch(console.error);
}
