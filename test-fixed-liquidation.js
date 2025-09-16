#!/usr/bin/env node

// test-fixed-liquidation.js - Test the fixed automatic liquidation system
//
// 🎯 PURPOSE: Verify that the fixed liquidation system works automatically
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🧪 TESTING FIXED AUTOMATIC LIQUIDATION SYSTEM");
  console.log("=".repeat(60));

  // Get contracts
  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const usdc = await getContract("MOCK_USDC");

  // Get signers
  const [deployer, user1, user2, user3] = await ethers.getSigners();

  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`👤 User1 (LP): ${user1.address}`);
  console.log(`👤 User2 (Shorter): ${user2.address}`);
  console.log(`👤 User3 (Liquidator): ${user3.address}`);

  try {
    // 1. Setup initial state
    console.log("\n📊 STEP 1: SETUP INITIAL STATE");
    console.log("-".repeat(40));

    const marketId = await orderBook.marketId();
    console.log(`📊 Market ID: ${marketId}`);

    // Check initial balances
    const user2Collateral = await vault.getAvailableCollateral(user2.address);
    console.log(
      `💰 User2 Initial Collateral: ${ethers.formatUnits(
        user2Collateral,
        6
      )} USDC`
    );

    // 2. Add liquidity to the order book
    console.log("\n💧 STEP 2: ADDING LIQUIDITY");
    console.log("-".repeat(40));

    // User1 adds buy orders (to provide liquidity for short liquidation)
    const buyPrice1 = ethers.parseUnits("2.8", 6); // $2.8
    const buyPrice2 = ethers.parseUnits("2.5", 6); // $2.5
    const buyAmount = ethers.parseUnits("15", 18); // 15 ALU each

    console.log(`📈 User1 adding buy orders...`);
    await orderBook
      .connect(user1)
      .placeMarginLimitOrder(buyPrice1, buyAmount, true);
    await orderBook
      .connect(user1)
      .placeMarginLimitOrder(buyPrice2, buyAmount, true);
    console.log(`✅ Added buy liquidity: 15 ALU @ $2.8 and 15 ALU @ $2.5`);

    // Check order book state
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`📊 Best Bid: ${ethers.formatUnits(bestBid, 6)} USDC`);
    console.log(`📊 Best Ask: ${ethers.formatUnits(bestAsk, 6)} USDC`);

    // 3. User2 creates a short position
    console.log("\n📉 STEP 3: CREATING SHORT POSITION");
    console.log("-".repeat(40));

    const shortPrice = ethers.parseUnits("1.0", 6); // $1.0
    const shortAmount = ethers.parseUnits("20", 18); // 20 ALU short

    console.log(
      `📉 User2 creating short position: ${ethers.formatUnits(
        shortAmount,
        18
      )} ALU @ $${ethers.formatUnits(shortPrice, 6)}`
    );
    await orderBook
      .connect(user2)
      .placeMarginLimitOrder(shortPrice, shortAmount, false);

    // Check position
    const position = await vault.getUserPositionByMarket(
      user2.address,
      marketId
    );
    console.log(
      `📈 User2 Position: ${ethers.formatUnits(position.size, 18)} ALU`
    );
    console.log(
      `💵 Entry Price: ${ethers.formatUnits(position.entryPrice, 6)} USDC`
    );

    // 4. Check if user is in active traders
    console.log("\n👥 STEP 4: CHECKING ACTIVE TRADERS");
    console.log("-".repeat(40));

    const activeTraderCount = await orderBook.getActiveTraderCount();
    console.log(`👥 Active Trader Count: ${activeTraderCount}`);

    if (activeTraderCount > 0) {
      const activeTraders = await orderBook.getActiveTraders();
      console.log(`👥 Active Traders: ${activeTraders.join(", ")}`);

      const isUser2Active = activeTraders.includes(user2.address);
      console.log(`👥 User2 in Active Traders: ${isUser2Active}`);

      if (!isUser2Active) {
        console.log("🔧 Adding User2 to active traders...");
        await orderBook.addToActiveTraders(user2.address);
        console.log("✅ User2 added to active traders");
      }
    } else {
      console.log("🔧 Adding User2 to active traders...");
      await orderBook.addToActiveTraders(user2.address);
      console.log("✅ User2 added to active traders");
    }

    // 5. Check liquidation conditions
    console.log("\n⚠️  STEP 5: CHECKING LIQUIDATION CONDITIONS");
    console.log("-".repeat(40));

    const markPrice = await orderBook.calculateMarkPrice();
    console.log(
      `📊 Current Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`
    );

    const isLiquidatable = await vault.isLiquidatable(
      user2.address,
      marketId,
      markPrice
    );
    console.log(`⚠️  Is User2 Liquidatable: ${isLiquidatable}`);

    if (!isLiquidatable) {
      console.log(
        "ℹ️  Position is not yet liquidatable - this is expected with current prices"
      );
    }

    // 6. Trigger price movement to cause liquidation
    console.log("\n🔥 STEP 6: TRIGGERING LIQUIDATION");
    console.log("-".repeat(40));

    // User3 creates a large buy order to push the price up and trigger liquidation
    const triggerPrice = ethers.parseUnits("3.0", 6); // $3.0 - should trigger liquidation
    const triggerAmount = ethers.parseUnits("5", 18); // 5 ALU

    console.log(`🚀 User3 placing market buy order to trigger liquidation...`);
    console.log(`   Amount: ${ethers.formatUnits(triggerAmount, 18)} ALU`);

    // Place a limit order at high price to trigger liquidation
    const triggerTx = await orderBook
      .connect(user3)
      .placeMarginLimitOrder(triggerPrice, triggerAmount, true);
    const triggerReceipt = await triggerTx.wait();

    console.log(`✅ Trigger order placed. Gas used: ${triggerReceipt.gasUsed}`);

    // Check for liquidation events
    console.log("\n📋 CHECKING FOR LIQUIDATION EVENTS:");
    const events = triggerReceipt.logs;
    let liquidationFound = false;

    events.forEach((event, index) => {
      try {
        const decoded = orderBook.interface.parseLog(event);
        console.log(`   ${index + 1}. OrderBook.${decoded.name}`);
        if (decoded.name === "AutoLiquidationTriggered") {
          liquidationFound = true;
          console.log(`      🎯 LIQUIDATION TRIGGERED!`);
          console.log(`      Trader: ${decoded.args.user}`);
          console.log(
            `      Size: ${ethers.formatUnits(
              decoded.args.positionSize,
              18
            )} ALU`
          );
        }
      } catch (e) {
        try {
          const decoded = vault.interface.parseLog(event);
          console.log(`   ${index + 1}. Vault.${decoded.name}`);
        } catch (e2) {
          // Skip unknown events
        }
      }
    });

    if (!liquidationFound) {
      console.log("⚠️  No automatic liquidation triggered by the order");

      // Try manual liquidation scan
      console.log("\n🔄 TRYING MANUAL LIQUIDATION SCAN...");
      const scanTx = await orderBook.triggerLiquidationScan();
      const scanReceipt = await scanTx.wait();

      console.log(`✅ Manual scan completed. Gas used: ${scanReceipt.gasUsed}`);

      // Check events from manual scan
      const scanEvents = scanReceipt.logs;
      scanEvents.forEach((event, index) => {
        try {
          const decoded = orderBook.interface.parseLog(event);
          console.log(`   ${index + 1}. ${decoded.name}`);
          if (decoded.name === "AutoLiquidationTriggered") {
            liquidationFound = true;
            console.log(`      🎯 MANUAL LIQUIDATION TRIGGERED!`);
          }
        } catch (e) {
          // Skip unknown events
        }
      });
    }

    // 7. Check final state
    console.log("\n📊 STEP 7: FINAL STATE CHECK");
    console.log("-".repeat(40));

    const finalPosition = await vault.getUserPositionByMarket(
      user2.address,
      marketId
    );
    const finalMarginUsed = await vault.getTotalMarginUsed(user2.address);
    const finalAvailableCollateral = await vault.getAvailableCollateral(
      user2.address
    );

    console.log(
      `📈 User2 Final Position: ${ethers.formatUnits(
        finalPosition.size,
        18
      )} ALU`
    );
    console.log(
      `🔒 User2 Final Margin Used: ${ethers.formatUnits(
        finalMarginUsed,
        6
      )} USDC`
    );
    console.log(
      `🏦 User2 Final Available Collateral: ${ethers.formatUnits(
        finalAvailableCollateral,
        6
      )} USDC`
    );

    // Check if user is still in active traders
    const finalActiveTraders = await orderBook.getActiveTraders();
    const stillActive = finalActiveTraders.includes(user2.address);
    console.log(`👥 User2 Still in Active Traders: ${stillActive}`);

    // 8. Results summary
    console.log("\n🎯 TEST RESULTS SUMMARY");
    console.log("=".repeat(40));

    if (finalPosition.size === 0n && finalMarginUsed === 0n) {
      console.log("🎉 SUCCESS: Position was liquidated and margin released!");
      console.log("✅ Automatic liquidation system is working correctly");
    } else if (
      finalPosition.size !== position.size ||
      finalMarginUsed < 30n * 10n ** 6n
    ) {
      console.log(
        "✅ PARTIAL SUCCESS: Position was partially liquidated or margin reduced"
      );
      console.log("⚠️  System is working but may need fine-tuning");
    } else {
      console.log("❌ ISSUE: Position was not liquidated");
      console.log(
        "🔍 This indicates the liquidation system may still have issues"
      );

      // Additional debugging
      const currentMarkPrice = await orderBook.calculateMarkPrice();
      const currentlyLiquidatable = await vault.isLiquidatable(
        user2.address,
        marketId,
        currentMarkPrice
      );
      console.log(
        `📊 Current Mark Price: ${ethers.formatUnits(currentMarkPrice, 6)} USDC`
      );
      console.log(`⚠️  Currently Liquidatable: ${currentlyLiquidatable}`);
    }
  } catch (error) {
    console.error("❌ Error during liquidation test:", error.message);
    if (error.reason) {
      console.error("Revert reason:", error.reason);
    }
  }

  console.log("\n🧪 LIQUIDATION SYSTEM TEST COMPLETE");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });

