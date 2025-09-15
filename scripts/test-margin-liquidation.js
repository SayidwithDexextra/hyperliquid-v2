#!/usr/bin/env node

// test-margin-liquidation.js - Test Regular Margin Position Liquidation
//
// 🎯 PURPOSE:
//   Test the new liquidation mechanism for regular margin positions
//

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(4);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function testMarginLiquidation() {
  console.log(
    colorText(
      "\n🔧 TESTING REGULAR MARGIN POSITION LIQUIDATION",
      colors.brightYellow
    )
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user2Address = signers[2].address; // User 2
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(colorText(`\n👤 User 2: ${user2Address}`, colors.brightCyan));
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Get current mark price
    const currentMarkPrice = await orderBook.getMarkPrice();
    const markPriceFloat = parseFloat(ethers.formatUnits(currentMarkPrice, 6));
    console.log(
      colorText(
        `💰 Current Mark Price: $${markPriceFloat.toFixed(4)}`,
        colors.brightGreen
      )
    );

    // Get user's regular margin position
    const positionSize = await orderBook.getUserPosition(user2Address);
    const positionSizeFloat = parseFloat(ethers.formatUnits(positionSize, 18));
    console.log(
      colorText(
        `📊 Position Size: ${positionSizeFloat.toFixed(4)} ALU`,
        colors.cyan
      )
    );

    if (positionSizeFloat === 0) {
      console.log(colorText(`\n⚠️  No position to liquidate`, colors.yellow));
      return;
    }

    // Get available margin
    const availableMargin = await vault.getAvailableCollateral(user2Address);
    const availableMarginFloat = parseFloat(
      ethers.formatUnits(availableMargin, 6)
    );
    console.log(
      colorText(
        `💰 Available Margin: $${availableMarginFloat.toFixed(2)}`,
        colors.cyan
      )
    );

    // Calculate position value and liquidation threshold
    const absSize = Math.abs(positionSizeFloat);
    const positionValue = absSize * markPriceFloat; // Position value in USD
    const liquidationThreshold = availableMarginFloat * 10; // 10x available margin

    console.log(
      colorText(`💰 Position Value: $${positionValue.toFixed(2)}`, colors.cyan)
    );
    console.log(
      colorText(
        `⚡ Liquidation Threshold: $${liquidationThreshold.toFixed(2)}`,
        colors.magenta
      )
    );

    // Check if position should be liquidated
    const shouldLiquidate = positionValue > liquidationThreshold;

    console.log(colorText(`\n🔍 LIQUIDATION ANALYSIS:`, colors.brightCyan));
    console.log(
      colorText(
        `   Position Type: ${positionSizeFloat > 0 ? "LONG" : "SHORT"}`,
        colors.white
      )
    );
    console.log(
      colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
    );
    console.log(
      colorText(
        `   Liquidation Threshold: $${liquidationThreshold.toFixed(2)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Should Liquidate: ${shouldLiquidate ? "YES" : "NO"}`,
        shouldLiquidate ? colors.red : colors.green
      )
    );

    if (!shouldLiquidate) {
      console.log(
        colorText(`\n✅ Position is not at liquidation price`, colors.green)
      );
      return;
    }

    console.log(colorText(`\n⚡ ATTEMPTING LIQUIDATION...`, colors.yellow));

    try {
      // Attempt liquidation with positionId = 0 for regular margin positions
      const tx = await orderBook
        .connect(liquidator)
        .checkAndLiquidatePosition(user2Address, 0);
      const receipt = await tx.wait();

      console.log(
        colorText(`\n✅ LIQUIDATION SUCCESSFUL!`, colors.brightGreen)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));

      // Check position after liquidation
      const newPositionSize = await orderBook.getUserPosition(user2Address);
      const newPositionSizeFloat = parseFloat(
        ethers.formatUnits(newPositionSize, 18)
      );

      console.log(
        colorText(`\n📊 POSITION AFTER LIQUIDATION:`, colors.brightCyan)
      );
      console.log(
        colorText(
          `   Position Size: ${newPositionSizeFloat.toFixed(4)} ALU`,
          colors.white
        )
      );

      if (newPositionSizeFloat === 0) {
        console.log(
          colorText(`   ✅ Position successfully closed`, colors.green)
        );
      } else {
        console.log(
          colorText(
            `   ⚠️  Position still exists: ${newPositionSizeFloat.toFixed(
              4
            )} ALU`,
            colors.yellow
          )
        );
      }
    } catch (liquidateError) {
      console.log(colorText(`\n❌ LIQUIDATION FAILED!`, colors.red));
      console.error(`Liquidation error:`, liquidateError.message);
    }
  } catch (error) {
    console.log(
      colorText("⚠️ Could not test liquidation: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the test
testMarginLiquidation().catch(console.error);
