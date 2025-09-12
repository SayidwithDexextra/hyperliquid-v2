#!/usr/bin/env node

/**
 * 📊 DEPLOYER POSITION EXPLANATION
 *
 * This script explains how the deployer address got a 150 ALU short position
 * and why it shows a positive P&L despite being short.
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
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatNumber(value, decimals = 2) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function main() {
  console.log(colorText("\n📊 DEPLOYER POSITION EXPLANATION", colors.bright));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await contracts.getContract("MOCK_USDC");

    // Get deployment info
    const deploymentInfo = require("../deployments/localhost-deployment.json");
    const marketId = deploymentInfo.aluminumMarket.marketId;
    const deployer = deploymentInfo.deployer;

    console.log(colorText("\n🔍 CURRENT POSITION ANALYSIS", colors.yellow));
    console.log(`  Deployer Address: ${deployer}`);

    // Get position details
    const positions = await vault.getUserPositions(deployer);

    if (positions.length === 0) {
      console.log(
        colorText("\n❌ No positions found for deployer", colors.red)
      );
      return;
    }

    const position = positions[0];
    const size = ethers.formatUnits(position.size, 18);
    const entryPrice = ethers.formatUnits(position.entryPrice, 6);
    const marginLocked = ethers.formatUnits(position.marginLocked, 6);
    const isLong = position.isLong;

    console.log(colorText("\n📈 POSITION DETAILS:", colors.green));
    console.log(`  Position Type: ${isLong ? "LONG" : "SHORT"}`);
    console.log(`  Size: ${size} ALU`);
    console.log(`  Entry Price: $${entryPrice} USDC`);
    console.log(`  Margin Locked: $${marginLocked} USDC`);

    // Get current mark price
    const markPrice = await vault.marketMarkPrices(marketId);
    const markPriceFormatted = ethers.formatUnits(markPrice, 6);
    console.log(`  Current Mark Price: $${markPriceFormatted} USDC`);

    // Calculate P&L
    let pnl;
    if (position.isLong) {
      pnl =
        ((markPrice - position.entryPrice) * position.size) / BigInt(10 ** 18);
    } else {
      // For short positions, profit when price goes down
      pnl =
        ((position.entryPrice - markPrice) *
          BigInt(Math.abs(Number(position.size)))) /
        BigInt(10 ** 18);
    }
    const pnlFormatted = ethers.formatUnits(pnl, 6);

    console.log(colorText("\n💰 P&L CALCULATION:", colors.magenta));
    console.log(`  Entry Price: $${entryPrice}`);
    console.log(`  Current Price: $${markPriceFormatted}`);
    console.log(
      `  Price Movement: ${
        markPriceFormatted < entryPrice ? "DOWN ↓" : "UP ↑"
      } by $${Math.abs(markPriceFormatted - entryPrice).toFixed(6)}`
    );
    console.log(`  P&L: ${pnl >= 0 ? "+" : ""}$${pnlFormatted} USDC`);

    // Explain how the position was created
    console.log(
      colorText("\n📖 HOW THIS POSITION WAS CREATED:", colors.yellow)
    );
    console.log(
      "  Based on the position size of exactly -150 ALU, this appears to be"
    );
    console.log("  the result of a position flipping test scenario:");
    console.log("");
    console.log("  1. Initially, the deployer might have had a LONG position");
    console.log(
      "  2. A SELL order was executed that was larger than the long position"
    );
    console.log("  3. This resulted in:");
    console.log("     - Closing the entire long position");
    console.log("     - Opening a new SHORT position with the remaining size");
    console.log("");
    console.log("  Example: If deployer was long 100 ALU and sold 250 ALU:");
    console.log("     - First 100 ALU closes the long position");
    console.log("     - Remaining 150 ALU creates a short position");

    // Explain P&L for short position
    console.log(colorText("\n📚 SHORT POSITION P&L EXPLANATION:", colors.cyan));
    console.log("  For a SHORT position:");
    console.log("  - You profit when the price goes DOWN");
    console.log("  - You lose when the price goes UP");
    console.log("");
    console.log(`  Entry Price: $${entryPrice}`);
    console.log(`  Current Price: $${markPriceFormatted}`);

    if (Number(markPriceFormatted) < Number(entryPrice)) {
      console.log(
        colorText(
          `  ✅ Price went DOWN, so the SHORT position is PROFITABLE`,
          colors.green
        )
      );
      console.log(
        `  Profit per ALU: $${(
          Number(entryPrice) - Number(markPriceFormatted)
        ).toFixed(6)}`
      );
      console.log(
        `  Total Profit: ${Math.abs(Number(size))} ALU × $${(
          Number(entryPrice) - Number(markPriceFormatted)
        ).toFixed(6)} = $${pnlFormatted}`
      );
    } else if (Number(markPriceFormatted) > Number(entryPrice)) {
      console.log(
        colorText(
          `  ❌ Price went UP, so the SHORT position has a LOSS`,
          colors.red
        )
      );
      console.log(
        `  Loss per ALU: $${(
          Number(markPriceFormatted) - Number(entryPrice)
        ).toFixed(6)}`
      );
      console.log(
        `  Total Loss: ${Math.abs(Number(size))} ALU × $${(
          Number(markPriceFormatted) - Number(entryPrice)
        ).toFixed(6)} = $${pnlFormatted}`
      );
    } else {
      console.log(`  ⚪ Price unchanged, no P&L`);
    }

    // Get order book state
    const [bestBid, bestAsk] = await orderBook.getBestPrices();
    console.log(colorText("\n📊 CURRENT MARKET STATE:", colors.blue));
    console.log(
      `  Best Bid: ${
        bestBid > 0 ? "$" + ethers.formatUnits(bestBid, 6) : "No bids"
      }`
    );
    console.log(
      `  Best Ask: ${
        bestAsk < ethers.MaxUint256
          ? "$" + ethers.formatUnits(bestAsk, 6)
          : "No asks"
      }`
    );

    // Get collateral info
    const collateralBalance = await vault.userCollateral(deployer);
    console.log(colorText("\n💳 COLLATERAL STATUS:", colors.green));
    console.log(
      `  Total Deposited: $${ethers.formatUnits(collateralBalance, 6)} USDC`
    );
    console.log(`  Margin Locked: $${marginLocked} USDC`);
    console.log(
      `  Available: $${ethers.formatUnits(
        collateralBalance - position.marginLocked,
        6
      )} USDC`
    );

    // Summary
    console.log(colorText("\n📝 SUMMARY:", colors.bright));
    console.log("  The deployer has a SHORT position of 150 ALU");
    console.log(
      `  Entry price was $${entryPrice}, current price is $${markPriceFormatted}`
    );

    if (pnl >= 0) {
      console.log(
        colorText(
          `  ✅ The position is PROFITABLE by $${pnlFormatted}`,
          colors.green
        )
      );
      console.log(
        "  This profit occurs because the price went DOWN while holding a SHORT position"
      );
    } else {
      console.log(
        colorText(
          `  ❌ The position has a LOSS of $${Math.abs(
            Number(pnlFormatted)
          ).toFixed(6)}`,
          colors.red
        )
      );
      console.log(
        "  This loss occurs because the price went UP while holding a SHORT position"
      );
    }

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
