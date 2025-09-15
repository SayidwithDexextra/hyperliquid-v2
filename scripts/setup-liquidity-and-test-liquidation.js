#!/usr/bin/env node

// setup-liquidity-and-test-liquidation.js - Setup Liquidity and Test Liquidation
//
// 🎯 PURPOSE:
//   Create liquidity in the order book, then test liquidation
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

async function setupLiquidityAndTestLiquidation() {
  console.log(
    colorText(
      "\n🔧 SETTING UP LIQUIDITY AND TESTING LIQUIDATION",
      colors.brightYellow
    )
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user1 = signers[1]; // User 1 - will provide buy liquidity
    const user2 = signers[2]; // User 2 - will create short position
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

    // Step 1: Create liquidity by placing buy and sell orders
    console.log(
      colorText(`\n📊 STEP 1: CREATING LIQUIDITY`, colors.brightCyan)
    );

    const basePrice = ethers.parseUnits("10", 6); // $10
    const orderSize = ethers.parseUnits("100", 18); // 100 ALU

    // User 1 places buy orders at different price levels
    console.log(colorText(`   User 1 placing buy orders...`, colors.yellow));

    const buyPrices = [
      ethers.parseUnits("9.5", 6), // $9.50
      ethers.parseUnits("9.0", 6), // $9.00
      ethers.parseUnits("8.5", 6), // $8.50
    ];

    for (let i = 0; i < buyPrices.length; i++) {
      try {
        const tx = await orderBook.connect(user1).placeMarginLimitOrder(
          buyPrices[i],
          orderSize,
          true // isBuy
        );
        await tx.wait();
        console.log(
          colorText(
            `     ✅ Buy order at $${formatPrice(buyPrices[i])}`,
            colors.green
          )
        );
      } catch (error) {
        console.log(
          colorText(
            `     ❌ Buy order at $${formatPrice(buyPrices[i])} failed: ${
              error.message
            }`,
            colors.red
          )
        );
      }
    }

    // User 1 places sell orders at different price levels
    console.log(colorText(`   User 1 placing sell orders...`, colors.yellow));

    const sellPrices = [
      ethers.parseUnits("10.5", 6), // $10.50
      ethers.parseUnits("11.0", 6), // $11.00
      ethers.parseUnits("11.5", 6), // $11.50
    ];

    for (let i = 0; i < sellPrices.length; i++) {
      try {
        const tx = await orderBook.connect(user1).placeMarginLimitOrder(
          sellPrices[i],
          orderSize,
          false // isBuy
        );
        await tx.wait();
        console.log(
          colorText(
            `     ✅ Sell order at $${formatPrice(sellPrices[i])}`,
            colors.green
          )
        );
      } catch (error) {
        console.log(
          colorText(
            `     ❌ Sell order at $${formatPrice(sellPrices[i])} failed: ${
              error.message
            }`,
            colors.red
          )
        );
      }
    }

    // Step 2: Check order book state
    console.log(
      colorText(`\n📊 STEP 2: CHECKING ORDER BOOK STATE`, colors.brightCyan)
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

    // Step 3: User 2 creates a short position
    console.log(
      colorText(`\n📊 STEP 3: CREATING SHORT POSITION`, colors.brightCyan)
    );

    const shortSize = ethers.parseUnits("50", 18); // 50 ALU short

    console.log(
      colorText(
        `   User 2 placing market sell order for ${formatAmount(
          shortSize
        )} ALU...`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook
        .connect(user2)
        .placeMarginMarketOrder(shortSize, false);
      const receipt = await tx.wait();
      console.log(
        colorText(`   ✅ Short position created successfully`, colors.green)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Short position creation failed: ${error.message}`,
          colors.red
        )
      );
      return;
    }

    // Step 4: Check position and collateral
    console.log(
      colorText(`\n📊 STEP 4: CHECKING POSITION STATE`, colors.brightCyan)
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

    // Step 5: Check liquidation criteria
    console.log(
      colorText(`\n📊 STEP 5: CHECKING LIQUIDATION CRITERIA`, colors.brightCyan)
    );

    const positionValue =
      Math.abs(parseFloat(ethers.formatUnits(position, 18))) *
      parseFloat(ethers.formatUnits(currentMarkPrice, 6));
    const liquidationThreshold =
      parseFloat(ethers.formatUnits(collateral, 6)) * 10; // 10x collateral

    console.log(
      colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
    );
    console.log(
      colorText(
        `   Collateral: $${parseFloat(
          ethers.formatUnits(collateral, 6)
        ).toFixed(2)}`,
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
        `   Should Liquidate: ${
          positionValue > liquidationThreshold ? "YES" : "NO"
        }`,
        positionValue > liquidationThreshold ? colors.red : colors.green
      )
    );

    // Step 6: Force liquidation by temporarily reducing collateral
    console.log(
      colorText(`\n📊 STEP 6: FORCING LIQUIDATION`, colors.brightCyan)
    );

    // Temporarily reduce user's collateral to force liquidation
    console.log(
      colorText(
        `   Reducing user's collateral to force liquidation...`,
        colors.yellow
      )
    );

    // Withdraw most of the collateral to make position underwater
    const withdrawAmount = ethers.parseUnits("950", 6); // Withdraw $950, leaving $50

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

    // Recalculate liquidation criteria
    const newLiquidationThreshold =
      parseFloat(ethers.formatUnits(newCollateral, 6)) * 10;
    const shouldLiquidateNow = positionValue > newLiquidationThreshold;

    console.log(
      colorText(
        `   New Liquidation Threshold: $${newLiquidationThreshold.toFixed(2)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Should Liquidate Now: ${shouldLiquidateNow ? "YES" : "NO"}`,
        shouldLiquidateNow ? colors.red : colors.green
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
setupLiquidityAndTestLiquidation().catch(console.error);


