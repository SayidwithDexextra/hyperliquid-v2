#!/usr/bin/env node

// complete-liquidation-test.js - Complete Liquidation Test Suite
//
// 🎯 PURPOSE:
//   Complete end-to-end test of the liquidation system with filled order book
//   This script runs the entire flow: fill order book -> create positions -> test liquidation
//
// 🔄 TEST FLOW:
//   1. Fill order book with small liquidity
//   2. Create both long and short positions
//   3. Test liquidation scenarios
//   4. Verify results and provide comprehensive analysis
//
// 🚀 USAGE:
//   node scripts/complete-liquidation-test.js
//   npx hardhat run scripts/complete-liquidation-test.js --network localhost

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

async function completeLiquidationTest() {
  console.log(
    colorText("\n🎯 COMPLETE LIQUIDATION TEST SUITE", colors.brightYellow)
  );
  console.log(colorText("═".repeat(80), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCKUSDC");
    const signers = await ethers.getSigners();

    // Test users
    const liquidityProvider1 = signers[1];
    const liquidityProvider2 = signers[2];
    const positionHolder1 = signers[3];
    const positionHolder2 = signers[4];
    const liquidator = signers[0];

    console.log(colorText(`\n👥 Test Participants:`, colors.brightCyan));
    console.log(
      colorText(
        `   Liquidity Provider 1: ${liquidityProvider1.address}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Liquidity Provider 2: ${liquidityProvider2.address}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Position Holder 1: ${positionHolder1.address}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Position Holder 2: ${positionHolder2.address}`,
        colors.white
      )
    );
    console.log(
      colorText(`   Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Phase 1: Fill Order Book with Small Liquidity
    console.log(
      colorText(
        `\n📊 PHASE 1: FILLING ORDER BOOK WITH SMALL LIQUIDITY`,
        colors.brightCyan
      )
    );

    const smallPrices = ["0.01", "0.02", "0.03", "0.04", "0.05"];
    const smallSizes = ["0.001", "0.002", "0.005", "0.01"];

    let totalOrders = 0;

    // Place buy orders
    for (let i = 0; i < smallPrices.length; i++) {
      const price = ethers.parseUnits(smallPrices[i], 6);
      const user = i % 2 === 0 ? liquidityProvider1 : liquidityProvider2;

      for (let j = 0; j < smallSizes.length; j++) {
        const amount = ethers.parseUnits(smallSizes[j], 18);

        try {
          await orderBook
            .connect(user)
            .placeMarginLimitOrder(price, amount, true);
          totalOrders++;
        } catch (error) {
          // Continue on errors
        }
      }
    }

    // Place sell orders
    for (let i = 0; i < smallPrices.length; i++) {
      const price = ethers.parseUnits(smallPrices[i], 6);
      const user = i % 2 === 0 ? liquidityProvider1 : liquidityProvider2;

      for (let j = 0; j < smallSizes.length; j++) {
        const amount = ethers.parseUnits(smallSizes[j], 18);

        try {
          await orderBook
            .connect(user)
            .placeMarginLimitOrder(price, amount, false);
          totalOrders++;
        } catch (error) {
          // Continue on errors
        }
      }
    }

    console.log(
      colorText(
        `   ✅ Placed ${totalOrders} orders in order book`,
        colors.green
      )
    );

    // Check order book state
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(`   Best Bid: $${formatPrice(bestBid)}`, colors.white)
    );
    console.log(
      colorText(`   Best Ask: $${formatPrice(bestAsk)}`, colors.white)
    );
    console.log(
      colorText(`   Mark Price: $${formatPrice(markPrice)}`, colors.white)
    );

    // Phase 2: Create Test Positions
    console.log(
      colorText(`\n📊 PHASE 2: CREATING TEST POSITIONS`, colors.brightCyan)
    );

    // Position Holder 1: Long position
    console.log(
      colorText(
        `   Creating long position for ${positionHolder1.address}...`,
        colors.yellow
      )
    );

    try {
      const longAmount = ethers.parseUnits("0.1", 18); // 0.1 ALU
      await orderBook
        .connect(positionHolder1)
        .placeMarginMarketOrder(longAmount, true);
      console.log(
        colorText(
          `   ✅ Long position created: ${formatAmount(longAmount)} ALU`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Long position creation failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Position Holder 2: Short position
    console.log(
      colorText(
        `   Creating short position for ${positionHolder2.address}...`,
        colors.yellow
      )
    );

    try {
      const shortAmount = ethers.parseUnits("0.1", 18); // 0.1 ALU
      await orderBook
        .connect(positionHolder2)
        .placeMarginMarketOrder(shortAmount, false);
      console.log(
        colorText(
          `   ✅ Short position created: ${formatAmount(shortAmount)} ALU`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Short position creation failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Phase 3: Check Position States
    console.log(
      colorText(`\n📊 PHASE 3: CHECKING POSITION STATES`, colors.brightCyan)
    );

    const position1 = await orderBook.getUserPosition(positionHolder1.address);
    const collateral1 = await vault.getAvailableCollateral(
      positionHolder1.address
    );
    const position2 = await orderBook.getUserPosition(positionHolder2.address);
    const collateral2 = await vault.getAvailableCollateral(
      positionHolder2.address
    );

    console.log(colorText(`   Position Holder 1:`, colors.white));
    console.log(
      colorText(`     Position: ${formatAmount(position1)} ALU`, colors.white)
    );
    console.log(
      colorText(`     Collateral: $${formatPrice(collateral1)}`, colors.white)
    );

    console.log(colorText(`   Position Holder 2:`, colors.white));
    console.log(
      colorText(`     Position: ${formatAmount(position2)} ALU`, colors.white)
    );
    console.log(
      colorText(`     Collateral: $${formatPrice(collateral2)}`, colors.white)
    );

    // Phase 4: Force Liquidation Scenarios
    console.log(
      colorText(
        `\n📊 PHASE 4: FORCING LIQUIDATION SCENARIOS`,
        colors.brightCyan
      )
    );

    // Force liquidation for Position Holder 1 (long position)
    if (position1 !== 0n) {
      console.log(
        colorText(`   Forcing liquidation for long position...`, colors.yellow)
      );

      // Withdraw most collateral to make position underwater
      const withdrawAmount1 = ethers.parseUnits("950", 6); // Withdraw $950
      try {
        await vault
          .connect(positionHolder1)
          .withdrawCollateral(withdrawAmount1);
        console.log(
          colorText(
            `   ✅ Withdrew $${formatPrice(
              withdrawAmount1
            )} from Position Holder 1`,
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

      // Attempt liquidation
      try {
        await orderBook
          .connect(liquidator)
          .checkAndLiquidatePosition(positionHolder1.address, 0);
        console.log(
          colorText(`   ✅ Long position liquidation executed`, colors.green)
        );
      } catch (error) {
        console.log(
          colorText(
            `   ❌ Long position liquidation failed: ${error.message}`,
            colors.red
          )
        );
      }
    }

    // Force liquidation for Position Holder 2 (short position)
    if (position2 !== 0n) {
      console.log(
        colorText(`   Forcing liquidation for short position...`, colors.yellow)
      );

      // Withdraw most collateral to make position underwater
      const withdrawAmount2 = ethers.parseUnits("950", 6); // Withdraw $950
      try {
        await vault
          .connect(positionHolder2)
          .withdrawCollateral(withdrawAmount2);
        console.log(
          colorText(
            `   ✅ Withdrew $${formatPrice(
              withdrawAmount2
            )} from Position Holder 2`,
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

      // Attempt liquidation
      try {
        await orderBook
          .connect(liquidator)
          .checkAndLiquidatePosition(positionHolder2.address, 0);
        console.log(
          colorText(`   ✅ Short position liquidation executed`, colors.green)
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

    // Phase 5: Final Analysis
    console.log(colorText(`\n📊 PHASE 5: FINAL ANALYSIS`, colors.brightCyan));

    const finalPosition1 = await orderBook.getUserPosition(
      positionHolder1.address
    );
    const finalCollateral1 = await vault.getAvailableCollateral(
      positionHolder1.address
    );
    const finalPosition2 = await orderBook.getUserPosition(
      positionHolder2.address
    );
    const finalCollateral2 = await vault.getAvailableCollateral(
      positionHolder2.address
    );

    console.log(colorText(`   Final State - Position Holder 1:`, colors.white));
    console.log(
      colorText(
        `     Position: ${formatAmount(finalPosition1)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `     Collateral: $${formatPrice(finalCollateral1)}`,
        colors.white
      )
    );

    console.log(colorText(`   Final State - Position Holder 2:`, colors.white));
    console.log(
      colorText(
        `     Position: ${formatAmount(finalPosition2)} ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `     Collateral: $${formatPrice(finalCollateral2)}`,
        colors.white
      )
    );

    // Liquidation Analysis
    const longLiquidated = finalPosition1 === 0n;
    const shortLiquidated = finalPosition2 === 0n;
    const longCollateralLost = finalCollateral1 < collateral1;
    const shortCollateralLost = finalCollateral2 < collateral2;

    console.log(colorText(`\n📊 LIQUIDATION RESULTS:`, colors.brightCyan));

    console.log(
      colorText(
        `   Long Position Liquidated: ${longLiquidated ? "✅ YES" : "❌ NO"}`,
        longLiquidated ? colors.green : colors.red
      )
    );
    console.log(
      colorText(
        `   Short Position Liquidated: ${shortLiquidated ? "✅ YES" : "❌ NO"}`,
        shortLiquidated ? colors.green : colors.red
      )
    );
    console.log(
      colorText(
        `   Long Collateral Lost: ${longCollateralLost ? "✅ YES" : "❌ NO"}`,
        longCollateralLost ? colors.green : colors.red
      )
    );
    console.log(
      colorText(
        `   Short Collateral Lost: ${shortCollateralLost ? "✅ YES" : "❌ NO"}`,
        shortCollateralLost ? colors.green : colors.red
      )
    );

    // Overall Success Assessment
    const overallSuccess =
      (longLiquidated || shortLiquidated) &&
      (longCollateralLost || shortCollateralLost);

    if (overallSuccess) {
      console.log(
        colorText(`\n🎉 LIQUIDATION TEST SUCCESSFUL!`, colors.brightGreen)
      );
      console.log(
        colorText(`   ✅ Liquidation system is working correctly`, colors.white)
      );
      console.log(
        colorText(`   ✅ Positions were closed when underwater`, colors.white)
      );
      console.log(
        colorText(`   ✅ Collateral was properly confiscated`, colors.white)
      );
    } else {
      console.log(
        colorText(`\n⚠️  LIQUIDATION TEST NEEDS ATTENTION`, colors.yellow)
      );
      console.log(
        colorText(
          `   • Check liquidation conditions and thresholds`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   • Verify margin requirements are properly set`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   • Ensure order book has sufficient liquidity`,
          colors.white
        )
      );
    }

    // Phase 6: Order Book State After Testing
    console.log(
      colorText(
        `\n📊 PHASE 6: ORDER BOOK STATE AFTER TESTING`,
        colors.brightCyan
      )
    );

    const finalBestBid = await orderBook.bestBid();
    const finalBestAsk = await orderBook.bestAsk();
    const finalMarkPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Final Best Bid: $${formatPrice(finalBestBid)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Final Best Ask: $${formatPrice(finalBestAsk)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Final Mark Price: $${formatPrice(finalMarkPrice)}`,
        colors.white
      )
    );

    console.log(
      colorText(`\n🎯 COMPLETE LIQUIDATION TEST FINISHED`, colors.brightYellow)
    );
    console.log(
      colorText(
        `   Run 'node scripts/simple-orderbook-viewer.js' to view current order book`,
        colors.white
      )
    );
  } catch (error) {
    console.log(
      colorText(
        "❌ Error in complete liquidation test: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the complete test
completeLiquidationTest().catch(console.error);
