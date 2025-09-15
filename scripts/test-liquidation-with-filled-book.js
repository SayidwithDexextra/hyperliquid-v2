#!/usr/bin/env node

// test-liquidation-with-filled-book.js - Test Liquidation with Filled Order Book
//
// 🎯 PURPOSE:
//   Test liquidation functionality using a pre-filled order book with liquidity
//   This script creates positions and then tests liquidation scenarios
//
// 💰 TESTING STRATEGY:
//   1. Create a position using the filled order book
//   2. Manipulate mark price to trigger liquidation
//   3. Execute liquidation and verify results
//   4. Test both long and short positions
//
// 🚀 USAGE:
//   node scripts/test-liquidation-with-filled-book.js
//   npx hardhat run scripts/test-liquidation-with-filled-book.js --network localhost

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

async function testLiquidationWithFilledBook() {
  console.log(
    colorText(
      "\n⚡ TESTING LIQUIDATION WITH FILLED ORDER BOOK",
      colors.brightYellow
    )
  );
  console.log(colorText("═".repeat(70), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCKUSDC");
    const signers = await ethers.getSigners();

    // Test users
    const positionHolder = signers[1]; // User 1 - will create position
    const liquidator = signers[0]; // Deployer - will liquidate

    console.log(
      colorText(
        `\n👤 Position Holder: ${positionHolder.address}`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Step 1: Check order book state
    console.log(
      colorText(`\n📊 STEP 1: CHECKING ORDER BOOK STATE`, colors.brightCyan)
    );

    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Best Bid: ${bestBid > 0n ? `$${formatPrice(bestBid)}` : "None"}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Best Ask: ${
          bestAsk < ethers.MaxUint256 ? `$${formatPrice(bestAsk)}` : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(`   Mark Price: $${formatPrice(markPrice)}`, colors.white)
    );

    if (bestBid === 0n || bestAsk === ethers.MaxUint256) {
      console.log(
        colorText(
          `   ❌ Order book is empty! Please run fill-orderbook script first.`,
          colors.red
        )
      );
      return;
    }

    // Step 2: Check position holder's collateral
    console.log(
      colorText(
        `\n📊 STEP 2: CHECKING POSITION HOLDER'S COLLATERAL`,
        colors.brightCyan
      )
    );

    const initialCollateral = await vault.getAvailableCollateral(
      positionHolder.address
    );
    console.log(
      colorText(
        `   Available Collateral: $${formatPrice(initialCollateral)}`,
        colors.white
      )
    );

    if (initialCollateral === 0n) {
      console.log(
        colorText(
          `   ❌ Position holder has no collateral! Please fund the account first.`,
          colors.red
        )
      );
      return;
    }

    // Step 3: Create a long position
    console.log(
      colorText(`\n📊 STEP 3: CREATING LONG POSITION`, colors.brightCyan)
    );

    const positionSize = ethers.parseUnits("5.0", 18); // 5.0 ALU
    console.log(
      colorText(
        `   Creating long position: ${formatAmount(positionSize)} ALU`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook.connect(positionHolder).placeMarginMarketOrder(
        positionSize,
        true // isBuy
      );
      const receipt = await tx.wait();
      console.log(
        colorText(`   ✅ Long position created successfully`, colors.green)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Long position creation failed: ${error.message}`,
          colors.red
        )
      );
      return;
    }

    // Step 4: Check position state
    console.log(
      colorText(`\n📊 STEP 4: CHECKING POSITION STATE`, colors.brightCyan)
    );

    const position = await orderBook.getUserPosition(positionHolder.address);
    const collateral = await vault.getAvailableCollateral(
      positionHolder.address
    );
    const currentMarkPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(`   Position: ${formatAmount(position)} ALU`, colors.white)
    );
    console.log(
      colorText(`   Collateral: $${formatPrice(collateral)}`, colors.white)
    );
    console.log(
      colorText(
        `   Mark Price: $${formatPrice(currentMarkPrice)}`,
        colors.white
      )
    );

    if (position === 0n) {
      console.log(
        colorText(
          `   ❌ No position created, cannot test liquidation`,
          colors.red
        )
      );
      return;
    }

    // Step 5: Calculate liquidation threshold
    console.log(
      colorText(
        `\n📊 STEP 5: CALCULATING LIQUIDATION THRESHOLD`,
        colors.brightCyan
      )
    );

    const positionValue =
      Math.abs(parseFloat(ethers.formatUnits(position, 18))) *
      parseFloat(ethers.formatUnits(currentMarkPrice, 6));
    const collateralValue = parseFloat(ethers.formatUnits(collateral, 6));

    // For 1:1 margin, liquidation happens when position value > collateral
    const liquidationThreshold = collateralValue;
    const shouldLiquidate = positionValue > liquidationThreshold;

    console.log(
      colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
    );
    console.log(
      colorText(
        `   Collateral Value: $${collateralValue.toFixed(2)}`,
        colors.white
      )
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

    // Step 6: Force liquidation by reducing collateral
    console.log(
      colorText(`\n📊 STEP 6: FORCING LIQUIDATION`, colors.brightCyan)
    );

    if (!shouldLiquidate) {
      console.log(
        colorText(
          `   Reducing collateral to force liquidation...`,
          colors.yellow
        )
      );

      // Withdraw most of the collateral to make position underwater
      const withdrawAmount = ethers.parseUnits("900", 6); // Withdraw $900, leaving minimal collateral

      try {
        const withdrawTx = await vault
          .connect(positionHolder)
          .withdrawCollateral(withdrawAmount);
        await withdrawTx.wait();
        console.log(
          colorText(
            `   ✅ Withdrew $${formatPrice(withdrawAmount)} collateral`,
            colors.green
          )
        );
      } catch (error) {
        console.log(
          colorText(
            `   ❌ Failed to withdraw collateral: ${error.message}`,
            colors.red
          )
        );
      }

      // Check new collateral amount
      const newCollateral = await vault.getAvailableCollateral(
        positionHolder.address
      );
      console.log(
        colorText(
          `   New Collateral: $${formatPrice(newCollateral)}`,
          colors.white
        )
      );

      // Recalculate liquidation criteria
      const newLiquidationThreshold = parseFloat(
        ethers.formatUnits(newCollateral, 6)
      );
      const shouldLiquidateNow = positionValue > newLiquidationThreshold;

      console.log(
        colorText(
          `   New Liquidation Threshold: $${newLiquidationThreshold.toFixed(
            2
          )}`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Should Liquidate Now: ${shouldLiquidateNow ? "YES" : "NO"}`,
          shouldLiquidateNow ? colors.red : colors.green
        )
      );
    }

    // Step 7: Attempt liquidation
    console.log(
      colorText(`\n📊 STEP 7: ATTEMPTING LIQUIDATION`, colors.brightCyan)
    );

    try {
      const tx = await orderBook
        .connect(liquidator)
        .checkAndLiquidatePosition(positionHolder.address, 0);
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
    }

    // Step 8: Check final state
    console.log(
      colorText(`\n📊 STEP 8: CHECKING FINAL STATE`, colors.brightCyan)
    );

    const finalPosition = await orderBook.getUserPosition(
      positionHolder.address
    );
    const finalCollateral = await vault.getAvailableCollateral(
      positionHolder.address
    );

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

    // Step 9: Test short position liquidation
    console.log(
      colorText(
        `\n📊 STEP 9: TESTING SHORT POSITION LIQUIDATION`,
        colors.brightCyan
      )
    );

    // Create a short position
    const shortSize = ethers.parseUnits("3.0", 18); // 3.0 ALU short
    console.log(
      colorText(
        `   Creating short position: ${formatAmount(shortSize)} ALU`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook.connect(positionHolder).placeMarginMarketOrder(
        shortSize,
        false // isBuy
      );
      await tx.wait();
      console.log(
        colorText(`   ✅ Short position created successfully`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Short position creation failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Check short position
    const shortPosition = await orderBook.getUserPosition(
      positionHolder.address
    );
    console.log(
      colorText(
        `   Short Position: ${formatAmount(shortPosition)} ALU`,
        colors.white
      )
    );

    if (shortPosition !== 0n) {
      // Force liquidation of short position
      console.log(
        colorText(`   Attempting to liquidate short position...`, colors.yellow)
      );

      try {
        const tx = await orderBook
          .connect(liquidator)
          .checkAndLiquidatePosition(positionHolder.address, 0);
        await tx.wait();
        console.log(
          colorText(`   ✅ Short position liquidation successful`, colors.green)
        );
      } catch (error) {
        console.log(
          colorText(
            `   ❌ Short position liquidation failed: ${error.message}`,
            colors.red
          )
        );
      }
    }

    // Step 10: Final analysis
    console.log(colorText(`\n📊 STEP 10: FINAL ANALYSIS`, colors.brightCyan));

    const finalPositionAfterShort = await orderBook.getUserPosition(
      positionHolder.address
    );
    const finalCollateralAfterShort = await vault.getAvailableCollateral(
      positionHolder.address
    );

    console.log(
      colorText(
        `   Final Position: ${formatAmount(finalPositionAfterShort)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Final Collateral: $${formatPrice(finalCollateralAfterShort)}`,
        colors.white
      )
    );

    const positionLiquidated = finalPositionAfterShort === 0n;
    const collateralLost = finalCollateralAfterShort < initialCollateral;

    if (positionLiquidated) {
      console.log(
        colorText(`   ✅ Position was successfully liquidated`, colors.green)
      );
    } else {
      console.log(
        colorText(`   ⚠️  Position was not liquidated`, colors.yellow)
      );
    }

    if (collateralLost) {
      const lossAmount = parseFloat(
        ethers.formatUnits(initialCollateral - finalCollateralAfterShort, 6)
      );
      console.log(
        colorText(
          `   ✅ Collateral was lost: $${lossAmount.toFixed(2)}`,
          colors.green
        )
      );
    } else {
      console.log(
        colorText(`   ⚠️  Collateral was not affected`, colors.yellow)
      );
    }

    if (positionLiquidated && collateralLost) {
      console.log(
        colorText(`\n🎉 LIQUIDATION TEST SUCCESSFUL!`, colors.brightGreen)
      );
      console.log(colorText(`   • Position was closed`, colors.white));
      console.log(colorText(`   • User lost collateral`, colors.white));
      console.log(
        colorText(`   • Liquidation system is working correctly`, colors.white)
      );
    } else {
      console.log(
        colorText(`\n⚠️  LIQUIDATION TEST INCOMPLETE`, colors.yellow)
      );
      console.log(
        colorText(
          `   • Position liquidated: ${positionLiquidated}`,
          colors.white
        )
      );
      console.log(
        colorText(`   • Collateral lost: ${collateralLost}`, colors.white)
      );
    }
  } catch (error) {
    console.log(
      colorText("❌ Error testing liquidation: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the test
testLiquidationWithFilledBook().catch(console.error);
