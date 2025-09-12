#!/usr/bin/env node

/**
 * 🔄 UPGRADE MARK PRICE TO DECENTRALIZED
 *
 * This script demonstrates how the mark price calculation
 * would work with the new decentralized approach.
 *
 * NOTE: Since the contracts are already deployed, you would need to:
 * 1. Deploy new versions with the updated code
 * 2. Or use upgradeable contracts pattern
 * 3. Or demonstrate the functionality with mock calculations
 */

const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function calculateDecentralizedMarkPrice(orderBook) {
  const [bestBid, bestAsk] = await orderBook.getBestPrices();
  const lastTradePrice = await orderBook.lastTradePrice();

  // Implement the same logic as the smart contract
  if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
    // Both bid and ask exist - use mid-price
    return (bestBid + bestAsk) / 2n;
  }

  // Only bid exists
  if (bestBid > 0n && bestAsk === ethers.MaxUint256) {
    if (lastTradePrice > 0n) {
      return lastTradePrice;
    }
    return bestBid + bestBid / 100n; // 1% premium
  }

  // Only ask exists
  if (bestBid === 0n && bestAsk < ethers.MaxUint256) {
    if (lastTradePrice > 0n) {
      return lastTradePrice;
    }
    return bestAsk - bestAsk / 100n; // 1% discount
  }

  // No orders exist - use last trade price
  if (lastTradePrice > 0n) {
    return lastTradePrice;
  }

  // Default to 1 USDC
  return ethers.parseUnits("1", 6);
}

async function main() {
  console.log(
    colorText("\n🔄 DEMONSTRATING DECENTRALIZED MARK PRICE", colors.bright)
  );
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");

    // Get deployment info
    const deploymentInfo = require("../deployments/localhost-deployment.json");
    const marketId = deploymentInfo.aluminumMarket.marketId;
    const deployer = deploymentInfo.deployer;

    console.log(colorText("\n📊 CURRENT SYSTEM STATE", colors.yellow));

    // Get current order book state
    const [bestBid, bestAsk] = await orderBook.getBestPrices();
    const lastTradePrice = await orderBook.lastTradePrice();
    const currentStoredMarkPrice = await vault.marketMarkPrices(marketId);

    console.log(`\nOrder Book State:`);
    console.log(
      `  Best Bid: ${
        bestBid > 0 ? "$" + ethers.formatUnits(bestBid, 6) : "None"
      }`
    );
    console.log(
      `  Best Ask: ${
        bestAsk < ethers.MaxUint256
          ? "$" + ethers.formatUnits(bestAsk, 6)
          : "None"
      }`
    );
    console.log(`  Last Trade: $${ethers.formatUnits(lastTradePrice, 6)}`);
    console.log(
      `  Current Stored Mark Price: $${ethers.formatUnits(
        currentStoredMarkPrice,
        6
      )}`
    );

    // Calculate what the decentralized mark price would be
    const decentralizedMarkPrice = await calculateDecentralizedMarkPrice(
      orderBook
    );
    console.log(
      colorText(
        `\n✨ Decentralized Mark Price: $${ethers.formatUnits(
          decentralizedMarkPrice,
          6
        )}`,
        colors.green
      )
    );

    // Explain the calculation
    console.log(colorText("\n📐 CALCULATION LOGIC:", colors.cyan));
    if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
      const midPrice = (bestBid + bestAsk) / 2n;
      console.log(`  Both sides exist → Using mid-price`);
      console.log(
        `  ($${ethers.formatUnits(bestBid, 6)} + $${ethers.formatUnits(
          bestAsk,
          6
        )}) ÷ 2 = $${ethers.formatUnits(midPrice, 6)}`
      );
    } else if (bestBid > 0n) {
      console.log(`  Only bids exist → Using last trade price`);
      console.log(`  Last trade: $${ethers.formatUnits(lastTradePrice, 6)}`);
    } else if (bestAsk < ethers.MaxUint256) {
      console.log(`  Only asks exist → Using last trade price`);
      console.log(`  Last trade: $${ethers.formatUnits(lastTradePrice, 6)}`);
    } else {
      console.log(`  No orders → Using last trade price or default`);
      console.log(`  Price: $${ethers.formatUnits(decentralizedMarkPrice, 6)}`);
    }

    // Show impact on P&L
    console.log(colorText("\n💰 IMPACT ON P&L CALCULATION", colors.magenta));

    const positions = await vault.getUserPositions(deployer);
    if (positions.length > 0) {
      const position = positions[0];
      const size = position.size;
      const entryPrice = position.entryPrice;
      const isLong = position.isLong;

      console.log(`\nPosition Details:`);
      console.log(`  Type: ${isLong ? "LONG" : "SHORT"}`);
      console.log(
        `  Size: ${ethers.formatUnits(size < 0n ? -size : size, 18)} ALU`
      );
      console.log(`  Entry Price: $${ethers.formatUnits(entryPrice, 6)}`);

      // Calculate P&L with stored mark price
      let storedPnL;
      const absSize = size < 0n ? -size : size;
      if (isLong) {
        storedPnL =
          ((currentStoredMarkPrice - entryPrice) * size) / BigInt(10 ** 18);
      } else {
        storedPnL =
          ((entryPrice - currentStoredMarkPrice) * absSize) / BigInt(10 ** 18);
      }

      // Calculate P&L with decentralized mark price
      let decentralizedPnL;
      if (isLong) {
        decentralizedPnL =
          ((decentralizedMarkPrice - entryPrice) * size) / BigInt(10 ** 18);
      } else {
        decentralizedPnL =
          ((entryPrice - decentralizedMarkPrice) * absSize) / BigInt(10 ** 18);
      }

      console.log(`\nP&L Comparison:`);
      console.log(
        `  With Stored Mark Price ($${ethers.formatUnits(
          currentStoredMarkPrice,
          6
        )}): ${ethers.formatUnits(storedPnL, 6)} USDC`
      );
      console.log(
        `  With Decentralized Price ($${ethers.formatUnits(
          decentralizedMarkPrice,
          6
        )}): ${ethers.formatUnits(decentralizedPnL, 6)} USDC`
      );

      const difference = decentralizedPnL - storedPnL;
      if (difference !== 0n) {
        console.log(
          colorText(
            `  Difference: ${difference > 0n ? "+" : ""}${ethers.formatUnits(
              difference,
              6
            )} USDC`,
            difference > 0n ? colors.green : colors.red
          )
        );
      } else {
        console.log(colorText(`  No difference in P&L`, colors.yellow));
      }
    }

    console.log(colorText("\n📋 IMPLEMENTATION SUMMARY", colors.yellow));
    console.log("  ✅ Added calculateMarkPrice() to OrderBook.sol");
    console.log("  ✅ Added getMarkPrice() to CentralizedVault.sol");
    console.log("  ✅ Updated getUnrealizedPnL() to use dynamic pricing");
    console.log("  ✅ Fully decentralized price discovery!");

    console.log(colorText("\n🚀 NEXT STEPS", colors.cyan));
    console.log("  1. Compile contracts: npx hardhat compile");
    console.log("  2. Deploy updated contracts or use upgrade pattern");
    console.log("  3. All mark prices will be calculated from order book");
    console.log("  4. No more manual mark price updates needed!");

    console.log(colorText("\n═".repeat(80), colors.cyan));
  } catch (error) {
    console.error(colorText("\n❌ Error:", colors.red), error.message);
    console.error(error.stack);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
