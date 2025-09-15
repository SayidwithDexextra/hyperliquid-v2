#!/usr/bin/env node

// simple-liquidation-test.js - Simple Liquidation Test
//
// 🎯 PURPOSE:
//   Test liquidation with smaller orders and adequate collateral
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

async function simpleLiquidationTest() {
  console.log(colorText("\n🔧 SIMPLE LIQUIDATION TEST", colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user1 = signers[1]; // User 1 - will provide liquidity
    const user2 = signers[2]; // User 2 - will create position
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(
      colorText(
        `\n👤 User 1 (Liquidity Provider): ${user1.address}`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `👤 User 2 (Position Holder): ${user2.address}`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Step 1: Add more collateral to users
    console.log(colorText(`\n📊 STEP 1: ADDING COLLATERAL`, colors.brightCyan));

    const additionalCollateral = ethers.parseUnits("5000", 6); // $5000 more

    // Add collateral to user1
    try {
      const depositTx1 = await vault
        .connect(user1)
        .depositCollateral(additionalCollateral);
      await depositTx1.wait();
      console.log(
        colorText(
          `   ✅ User 1 deposited $${formatPrice(additionalCollateral)}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ User 1 deposit failed: ${error.message}`, colors.red)
      );
    }

    // Add collateral to user2
    try {
      const depositTx2 = await vault
        .connect(user2)
        .depositCollateral(additionalCollateral);
      await depositTx2.wait();
      console.log(
        colorText(
          `   ✅ User 2 deposited $${formatPrice(additionalCollateral)}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ User 2 deposit failed: ${error.message}`, colors.red)
      );
    }

    // Step 2: Create liquidity with smaller orders
    console.log(
      colorText(`\n📊 STEP 2: CREATING LIQUIDITY`, colors.brightCyan)
    );

    const smallOrderSize = ethers.parseUnits("1", 18); // 1 ALU
    const buyPrice = ethers.parseUnits("5", 6); // $5
    const sellPrice = ethers.parseUnits("15", 6); // $15

    // User 1 places a small buy order
    try {
      const buyTx = await orderBook.connect(user1).placeMarginLimitOrder(
        buyPrice,
        smallOrderSize,
        true // isBuy
      );
      await buyTx.wait();
      console.log(
        colorText(
          `   ✅ Buy order at $${formatPrice(buyPrice)} for ${formatAmount(
            smallOrderSize
          )} ALU`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Buy order failed: ${error.message}`, colors.red)
      );
    }

    // User 1 places a small sell order
    try {
      const sellTx = await orderBook.connect(user1).placeMarginLimitOrder(
        sellPrice,
        smallOrderSize,
        false // isBuy
      );
      await sellTx.wait();
      console.log(
        colorText(
          `   ✅ Sell order at $${formatPrice(sellPrice)} for ${formatAmount(
            smallOrderSize
          )} ALU`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Sell order failed: ${error.message}`, colors.red)
      );
    }

    // Step 3: Check order book state
    console.log(
      colorText(`\n📊 STEP 3: CHECKING ORDER BOOK STATE`, colors.brightCyan)
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

    // Step 4: User 2 creates a position
    console.log(colorText(`\n📊 STEP 4: CREATING POSITION`, colors.brightCyan));

    const positionSize = ethers.parseUnits("1", 18); // 1 ALU

    try {
      const tx = await orderBook
        .connect(user2)
        .placeMarginMarketOrder(positionSize, false); // Short
      const receipt = await tx.wait();
      console.log(
        colorText(`   ✅ Short position created successfully`, colors.green)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Position creation failed: ${error.message}`,
          colors.red
        )
      );
      return;
    }

    // Step 5: Check position state
    console.log(
      colorText(`\n📊 STEP 5: CHECKING POSITION STATE`, colors.brightCyan)
    );

    const position = await orderBook.getUserPosition(user2.address);
    const collateral = await vault.getAvailableCollateral(user2.address);
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
          `   ⚠️  No position created, cannot test liquidation`,
          colors.yellow
        )
      );
      return;
    }

    // Step 6: Force liquidation by reducing collateral significantly
    console.log(
      colorText(`\n📊 STEP 6: FORCING LIQUIDATION`, colors.brightCyan)
    );

    // Withdraw almost all collateral to make position underwater
    const withdrawAmount = ethers.parseUnits("5900", 6); // Withdraw $5900, leaving $100

    try {
      const withdrawTx = await vault
        .connect(user2)
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
    const newCollateral = await vault.getAvailableCollateral(user2.address);
    console.log(
      colorText(
        `   New Collateral: $${formatPrice(newCollateral)}`,
        colors.white
      )
    );

    // Calculate liquidation criteria using industry-standard maintenance margin approach
    const positionValue =
      Math.abs(parseFloat(ethers.formatUnits(position, 18))) *
      parseFloat(ethers.formatUnits(currentMarkPrice, 6));

    // Calculate maintenance margin (5% of collateral)
    const maintenanceMargin =
      parseFloat(ethers.formatUnits(newCollateral, 6)) * 0.05;

    // Calculate liquidation price for short position
    // Liquidation price = current price + (maintenance margin / position size)
    const liquidationPrice =
      parseFloat(ethers.formatUnits(currentMarkPrice, 6)) +
      maintenanceMargin /
        Math.abs(parseFloat(ethers.formatUnits(position, 18)));

    // Position should be liquidated if current price >= liquidation price (for short)
    const shouldLiquidate =
      parseFloat(ethers.formatUnits(currentMarkPrice, 6)) >= liquidationPrice;

    console.log(
      colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
    );
    console.log(
      colorText(
        `   Maintenance Margin: $${maintenanceMargin.toFixed(2)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Liquidation Price: $${liquidationPrice.toFixed(4)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Current Price: $${parseFloat(
          ethers.formatUnits(currentMarkPrice, 6)
        ).toFixed(4)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Should Liquidate: ${shouldLiquidate ? "YES" : "NO"}`,
        shouldLiquidate ? colors.red : colors.green
      )
    );

    // Step 7: Attempt liquidation
    console.log(
      colorText(`\n📊 STEP 7: ATTEMPTING LIQUIDATION`, colors.brightCyan)
    );

    try {
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
    }

    // Step 8: Check final state
    console.log(
      colorText(`\n📊 STEP 8: CHECKING FINAL STATE`, colors.brightCyan)
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

    // Step 9: Analysis
    console.log(
      colorText(`\n📊 STEP 9: LIQUIDATION ANALYSIS`, colors.brightCyan)
    );

    const positionLiquidated = finalPosition === 0n;
    const collateralLost = finalCollateral < newCollateral;

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
        ethers.formatUnits(newCollateral - finalCollateral, 6)
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
        colorText(`\n🎉 LIQUIDATION SUCCESSFUL!`, colors.brightGreen)
      );
      console.log(colorText(`   • Position was closed`, colors.white));
      console.log(colorText(`   • User lost collateral`, colors.white));
      console.log(
        colorText(
          `   • Position will not appear in "View Open Positions"`,
          colors.white
        )
      );
    } else {
      console.log(colorText(`\n⚠️  LIQUIDATION INCOMPLETE`, colors.yellow));
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
      colorText(
        "⚠️ Could not test liquidation flow: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the test
simpleLiquidationTest().catch(console.error);
