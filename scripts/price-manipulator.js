#!/usr/bin/env node

// price-manipulator.js - Automated Price Manipulation Script
//
// 🎯 FEATURES:
//   ✅ Automated price adjustments
//   ✅ Liquidation target tracking
//   ✅ Configurable price movements
//   ✅ Smart order placement
//
// 🚀 USAGE:
//   npx hardhat run scripts/price-manipulator.js --network localhost
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

// Get all users and their positions
async function getAllUsersAndPositions(orderBook) {
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

  const userPositions = [];
  for (const user of users) {
    try {
      const positionIds = await orderBook.getUserPositions(user);
      const positions = [];

      for (const positionId of positionIds) {
        const isolatedPos = await orderBook.getPosition(user, positionId);
        positions.push({
          id: positionId,
          size: isolatedPos.size,
          entryPrice: isolatedPos.entryPrice,
          liquidationPrice: isolatedPos.liquidationPrice,
          isolatedMargin: isolatedPos.isolatedMargin,
        });
      }

      userPositions.push({
        address: user,
        positions: positions,
      });
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
        });
      }
    }
  }

  // Sort by percentage move needed (closest to liquidation first)
  return targets.sort((a, b) => a.percentageMove - b.percentageMove);
}

// Place a buy order to increase price
async function placeBuyOrder(orderBook, price, amount) {
  try {
    const tx = await orderBook.placeMarginLimitOrder(
      price,
      amount,
      true // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Buy order placed successfully${colors.reset}`
    );
    console.log(`   Price: $${formatPrice(price)}`);
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place buy order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Place a sell order to decrease price
async function placeSellOrder(orderBook, price, amount) {
  try {
    const tx = await orderBook.placeMarginLimitOrder(
      price,
      amount,
      false // isBuy
    );

    const receipt = await tx.wait();
    console.log(
      `${colors.green}✅ Sell order placed successfully${colors.reset}`
    );
    console.log(`   Price: $${formatPrice(price)}`);
    console.log(`   Amount: ${formatAmount(amount)}`);
    console.log(`   TX: ${receipt.transactionHash}`);
    return true;
  } catch (error) {
    console.log(
      `${colors.red}❌ Failed to place sell order: ${error.message}${colors.reset}`
    );
    return false;
  }
}

// Automated price manipulation
async function manipulatePrice(orderBook, targetPrice, orderSize = 1) {
  const currentPrice = await orderBook.getMarkPrice();
  const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
  const targetPriceFloat = parseFloat(targetPrice);

  console.log(`\n${colors.bright}🎯 PRICE MANIPULATION${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);
  console.log(`Current Price: $${formatPrice(currentPrice)}`);
  console.log(`Target Price: $${targetPrice}`);
  console.log(`Order Size: ${orderSize} units`);

  const newPrice = ethers.parseUnits(targetPriceFloat.toFixed(6), 6);
  const amount = ethers.parseUnits(orderSize.toString(), 18);

  if (targetPriceFloat > currentPriceFloat) {
    console.log(
      `\n${colors.bright}Placing buy order to increase price...${colors.reset}`
    );
    return await placeBuyOrder(orderBook, newPrice, amount);
  } else {
    console.log(
      `\n${colors.bright}Placing sell order to decrease price...${colors.reset}`
    );
    return await placeSellOrder(orderBook, newPrice, amount);
  }
}

// Main function
async function runPriceManipulator() {
  console.log(`${colors.brightCyan}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                🎯 PRICE MANIPULATOR 🎯                      ║"
  );
  console.log(
    "║              Automated Liquidation Driver                   ║"
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

    // Get current state
    const userPositions = await getAllUsersAndPositions(orderBook);
    const currentPrice = await orderBook.getMarkPrice();
    const targets = findLiquidationTargets(userPositions, currentPrice);

    console.log(`${colors.bright}📊 CURRENT MARKET STATE${colors.reset}`);
    console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);
    console.log(`Mark Price: $${formatPrice(currentPrice)}`);
    console.log(`Users with positions: ${userPositions.length}`);
    console.log(`Liquidation targets: ${targets.length}`);

    if (targets.length > 0) {
      console.log(
        `\n${colors.bright}🎯 CLOSEST LIQUIDATION TARGET${colors.reset}`
      );
      const closestTarget = targets[0];
      console.log(`User: ${closestTarget.user}`);
      console.log(
        `Position: ${closestTarget.isLong ? "LONG" : "SHORT"} ${formatAmount(
          closestTarget.size
        )}`
      );
      console.log(`Entry Price: $${formatPrice(closestTarget.entryPrice)}`);
      console.log(
        `Liquidation Price: $${formatPrice(closestTarget.liquidationPrice)}`
      );
      console.log(
        `Move needed: $${formatPrice(
          closestTarget.priceDiff
        )} (${closestTarget.percentageMove.toFixed(2)}%)`
      );

      // Example: Move price 10% towards liquidation
      const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
      const liquidationFloat = parseFloat(
        ethers.formatUnits(closestTarget.liquidationPrice, 6)
      );
      const movePercentage = 0.1; // 10% of the way to liquidation

      const newPriceFloat =
        currentPriceFloat +
        (liquidationFloat - currentPriceFloat) * movePercentage;
      const newPrice = newPriceFloat.toFixed(2);

      console.log(
        `\n${colors.bright}Moving price 10% towards liquidation...${colors.reset}`
      );
      console.log(`New target price: $${newPrice}`);

      await manipulatePrice(orderBook, newPrice, 1);
    } else {
      console.log(
        `\n${colors.green}✅ No liquidation targets found${colors.reset}`
      );
    }

    console.log(
      `\n${colors.brightGreen}🎉 Price manipulation complete!${colors.reset}`
    );
  } catch (error) {
    console.log(
      `${colors.red}❌ Error in price manipulator: ${error.message}${colors.reset}`
    );
    console.log(error.stack);
  }
}

// Export functions for reuse
module.exports = {
  runPriceManipulator,
  getAllUsersAndPositions,
  findLiquidationTargets,
  manipulatePrice,
  placeBuyOrder,
  placeSellOrder,
};

// Run if called directly
if (require.main === module) {
  runPriceManipulator().catch(console.error);
}
