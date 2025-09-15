#!/usr/bin/env node

// test-liquidation-flow.js - Test Complete Liquidation Flow
//
// 🎯 PURPOSE:
//   Test the complete liquidation flow: create positions, force liquidation, verify removal
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

async function testLiquidationFlow() {
  console.log(
    colorText("\n🔧 TESTING COMPLETE LIQUIDATION FLOW", colors.brightYellow)
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user2 = signers[2]; // User 2
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(colorText(`\n👤 User 2: ${user2.address}`, colors.brightCyan));
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Step 1: Check initial state
    console.log(
      colorText(`\n📊 STEP 1: CHECKING INITIAL STATE`, colors.brightCyan)
    );

    const initialPosition = await orderBook.getUserPosition(user2.address);
    const initialCollateral = await vault.getAvailableCollateral(user2.address);

    console.log(
      colorText(
        `   Initial Position: ${formatAmount(initialPosition)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Initial Collateral: $${formatPrice(initialCollateral)}`,
        colors.white
      )
    );

    // Step 2: Create a position by placing a market order
    console.log(colorText(`\n📊 STEP 2: CREATING POSITION`, colors.brightCyan));

    const orderSize = ethers.parseUnits("10", 18); // 10 ALU
    const isBuy = false; // Short position

    console.log(
      colorText(
        `   Placing market sell order for ${formatAmount(orderSize)} ALU...`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook
        .connect(user2)
        .placeMarginMarketOrder(orderSize, isBuy);
      const receipt = await tx.wait();
      console.log(colorText(`   ✅ Order executed successfully`, colors.green));
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (error) {
      console.log(
        colorText(`   ❌ Order failed: ${error.message}`, colors.red)
      );
      return;
    }

    // Step 3: Check position after order
    console.log(
      colorText(`\n📊 STEP 3: CHECKING POSITION AFTER ORDER`, colors.brightCyan)
    );

    const positionAfterOrder = await orderBook.getUserPosition(user2.address);
    const collateralAfterOrder = await vault.getAvailableCollateral(
      user2.address
    );
    const markPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Position: ${formatAmount(positionAfterOrder)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Collateral: $${formatPrice(collateralAfterOrder)}`,
        colors.white
      )
    );
    console.log(
      colorText(`   Mark Price: $${formatPrice(markPrice)}`, colors.white)
    );

    if (positionAfterOrder === 0n) {
      console.log(
        colorText(
          `   ⚠️  No position created, cannot test liquidation`,
          colors.yellow
        )
      );
      return;
    }

    // Step 4: Check if position should be liquidated
    console.log(
      colorText(`\n📊 STEP 4: CHECKING LIQUIDATION CRITERIA`, colors.brightCyan)
    );

    const positionValue =
      Math.abs(parseFloat(ethers.formatUnits(positionAfterOrder, 18))) *
      parseFloat(ethers.formatUnits(markPrice, 6));
    const liquidationThreshold =
      parseFloat(ethers.formatUnits(collateralAfterOrder, 6)) * 10; // 10x collateral

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
        `   Should Liquidate: ${
          positionValue > liquidationThreshold ? "YES" : "NO"
        }`,
        positionValue > liquidationThreshold ? colors.red : colors.green
      )
    );

    // Step 5: Force liquidation by temporarily modifying the threshold
    console.log(
      colorText(`\n📊 STEP 5: ATTEMPTING LIQUIDATION`, colors.brightCyan)
    );

    try {
      // Try liquidation with positionId = 0 for regular margin positions
      const tx = await orderBook
        .connect(liquidator)
        .checkAndLiquidatePosition(user2.address, 0);
      const receipt = await tx.wait();

      console.log(
        colorText(`   ✅ Liquidation transaction successful`, colors.green)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (liquidateError) {
      console.log(
        colorText(
          `   ❌ Liquidation failed: ${liquidateError.message}`,
          colors.red
        )
      );
      console.log(
        colorText(
          `   This is expected if position doesn't meet liquidation criteria`,
          colors.yellow
        )
      );
    }

    // Step 6: Check final state
    console.log(
      colorText(`\n📊 STEP 6: CHECKING FINAL STATE`, colors.brightCyan)
    );

    const finalPosition = await orderBook.getUserPosition(user2.address);
    const finalCollateral = await vault.getAvailableCollateral(user2.address);

    console.log(
      colorText(
        `   Final Position: ${formatAmount(finalPosition)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Final Collateral: $${formatPrice(finalCollateral)}`,
        colors.white
      )
    );

    // Step 7: Analysis
    console.log(
      colorText(`\n📊 STEP 7: LIQUIDATION ANALYSIS`, colors.brightCyan)
    );

    const positionChanged = finalPosition !== positionAfterOrder;
    const collateralChanged = finalCollateral !== collateralAfterOrder;

    if (positionChanged) {
      console.log(
        colorText(
          `   ✅ Position was liquidated (${formatAmount(
            positionAfterOrder
          )} → ${formatAmount(finalPosition)})`,
          colors.green
        )
      );
    } else {
      console.log(
        colorText(`   ⚠️  Position was not liquidated`, colors.yellow)
      );
    }

    if (collateralChanged) {
      const collateralLoss = parseFloat(
        ethers.formatUnits(collateralAfterOrder - finalCollateral, 6)
      );
      console.log(
        colorText(
          `   ✅ Collateral was lost: $${collateralLoss.toFixed(2)}`,
          colors.green
        )
      );
    } else {
      console.log(
        colorText(`   ⚠️  Collateral was not affected`, colors.yellow)
      );
    }

    // Step 8: Test viewOpenPositions equivalent
    console.log(
      colorText(`\n📊 STEP 8: TESTING POSITION VISIBILITY`, colors.brightCyan)
    );

    const hasOpenPosition = finalPosition !== 0n;
    console.log(
      colorText(
        `   Has Open Position: ${hasOpenPosition ? "YES" : "NO"}`,
        hasOpenPosition ? colors.red : colors.green
      )
    );

    if (!hasOpenPosition) {
      console.log(
        colorText(
          `   ✅ Position successfully removed from open positions`,
          colors.green
        )
      );
    } else {
      console.log(
        colorText(`   ⚠️  Position still shows as open`, colors.yellow)
      );
    }
  } catch (error) {
    console.log(
      colorText(
        "⚠️ Could not test liquidation flow: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the test
testLiquidationFlow().catch(console.error);


