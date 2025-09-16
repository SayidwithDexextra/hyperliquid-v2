#!/usr/bin/env node

// investigate-short-liquidation.js - Deep investigation of short liquidation logic
//
// 🎯 PURPOSE: Investigate short position liquidation logic specifically
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔍 INVESTIGATING SHORT LIQUIDATION LOGIC");
  console.log("=".repeat(60));

  // Get contracts
  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");

  // Get signers
  const [deployer, user1, user2] = await ethers.getSigners();

  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`👤 User1: ${user1.address}`);
  console.log(`👤 User2: ${user2.address}`);

  try {
    const marketId = await orderBook.marketId();
    console.log(`📊 Market ID: ${marketId}`);

    // 1. Check if there are any existing short positions
    console.log("\n📊 STEP 1: CHECKING EXISTING SHORT POSITIONS");
    console.log("-".repeat(50));

    const deployerPosition = await vault.getUserPositionByMarket(
      deployer.address,
      marketId
    );
    const user1Position = await vault.getUserPositionByMarket(
      user1.address,
      marketId
    );
    const user2Position = await vault.getUserPositionByMarket(
      user2.address,
      marketId
    );

    console.log(
      `👤 Deployer Position: ${ethers.formatUnits(
        deployerPosition.size,
        18
      )} ALU`
    );
    console.log(
      `👤 User1 Position: ${ethers.formatUnits(user1Position.size, 18)} ALU`
    );
    console.log(
      `👤 User2 Position: ${ethers.formatUnits(user2Position.size, 18)} ALU`
    );

    // Find the user with a short position
    let shortUser = null;
    let shortPosition = null;

    if (deployerPosition.size < 0) {
      shortUser = deployer.address;
      shortPosition = deployerPosition;
      console.log(`📉 Found SHORT position: Deployer`);
    } else if (user1Position.size < 0) {
      shortUser = user1.address;
      shortPosition = user1Position;
      console.log(`📉 Found SHORT position: User1`);
    } else if (user2Position.size < 0) {
      shortUser = user2.address;
      shortPosition = user2Position;
      console.log(`📉 Found SHORT position: User2`);
    }

    if (!shortUser) {
      console.log("❌ No short positions found - creating one for testing...");

      // Create a short position for testing
      const shortPrice = ethers.parseUnits("3.0", 6); // $3.0
      const shortAmount = ethers.parseUnits("10", 18); // 10 ALU short

      console.log(
        `📉 Creating short position: ${ethers.formatUnits(
          shortAmount,
          18
        )} ALU @ $${ethers.formatUnits(shortPrice, 6)}`
      );
      await orderBook
        .connect(user2)
        .placeMarginLimitOrder(shortPrice, shortAmount, false);

      shortUser = user2.address;
      shortPosition = await vault.getUserPositionByMarket(
        user2.address,
        marketId
      );
      console.log(
        `✅ Created short position: ${ethers.formatUnits(
          shortPosition.size,
          18
        )} ALU`
      );
    }

    // 2. Analyze the short liquidation logic
    console.log("\n🔍 STEP 2: ANALYZING SHORT LIQUIDATION LOGIC");
    console.log("-".repeat(50));

    const entryPrice = shortPosition.entryPrice;
    const positionSize = shortPosition.size;
    const marginLocked = shortPosition.marginLocked;

    console.log(`📉 Short Position Details:`);
    console.log(`   Size: ${ethers.formatUnits(positionSize, 18)} ALU`);
    console.log(`   Entry Price: ${ethers.formatUnits(entryPrice, 6)} USDC`);
    console.log(
      `   Margin Locked: ${ethers.formatUnits(marginLocked, 6)} USDC`
    );

    // 3. Test liquidation logic at different mark prices
    console.log("\n🧪 STEP 3: TESTING LIQUIDATION AT DIFFERENT MARK PRICES");
    console.log("-".repeat(50));

    const currentMarkPrice = await orderBook.calculateMarkPrice();
    console.log(
      `📊 Current Mark Price: ${ethers.formatUnits(currentMarkPrice, 6)} USDC`
    );

    // Test the smart contract's liquidation logic
    const isCurrentlyLiquidatable = await vault.isLiquidatable(
      shortUser,
      marketId,
      currentMarkPrice
    );
    console.log(`⚠️  Currently Liquidatable: ${isCurrentlyLiquidatable}`);

    // Manual calculation of liquidation price based on the smart contract logic
    // From _isShortLiquidatable: P = (2.5E)/(1+m) where m = maintenanceMarginBps/10000
    const maintenanceMarginBps = 1000; // 10% default
    const m = maintenanceMarginBps / 10000; // 0.1

    // P = (2.5E)/(1+m) = (2.5 * entryPrice) / (1 + 0.1) = (2.5 * entryPrice) / 1.1
    const liquidationPriceCalculated =
      (BigInt(25) * entryPrice) / (BigInt(11) * BigInt(10)); // 2.5/1.1

    console.log(
      `🎯 Calculated Liquidation Price: ${ethers.formatUnits(
        liquidationPriceCalculated,
        6
      )} USDC`
    );
    console.log(
      `📊 Mark vs Liquidation: ${ethers.formatUnits(
        currentMarkPrice,
        6
      )} vs ${ethers.formatUnits(liquidationPriceCalculated, 6)}`
    );
    console.log(
      `🔥 Should be liquidated: ${
        currentMarkPrice >= liquidationPriceCalculated
      }`
    );

    // Test at various mark prices to understand the liquidation threshold
    const testPrices = [
      ethers.parseUnits("1.0", 6),
      ethers.parseUnits("2.0", 6),
      ethers.parseUnits("3.0", 6),
      ethers.parseUnits("4.0", 6),
      ethers.parseUnits("5.0", 6),
      liquidationPriceCalculated,
      liquidationPriceCalculated + ethers.parseUnits("0.1", 6),
    ];

    console.log("\n📊 LIQUIDATION TESTING AT DIFFERENT PRICES:");
    for (const testPrice of testPrices) {
      const isLiquidatableAtPrice = await vault.isLiquidatable(
        shortUser,
        marketId,
        testPrice
      );
      console.log(
        `   $${ethers.formatUnits(testPrice, 6).padEnd(8)} -> ${
          isLiquidatableAtPrice ? "✅ LIQUIDATABLE" : "❌ Safe"
        }`
      );
    }

    // 4. Check the actual liquidation execution logic
    console.log("\n🔥 STEP 4: CHECKING LIQUIDATION EXECUTION LOGIC");
    console.log("-".repeat(50));

    // Check if user is in active traders (required for automatic liquidation)
    const activeTraders = await orderBook.getActiveTraders();
    const isInActiveTraders = activeTraders.includes(shortUser);
    console.log(`👥 Short user in active traders: ${isInActiveTraders}`);

    if (!isInActiveTraders) {
      console.log("🔧 Adding short user to active traders...");
      await orderBook.addToActiveTraders(shortUser);
      console.log("✅ Added to active traders");
    }

    // Check order book liquidity for short liquidation (needs ask orders)
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`📈 Best Bid: ${ethers.formatUnits(bestBid, 6)} USDC`);
    console.log(
      `📉 Best Ask: ${
        bestAsk === 0n ? "No asks" : ethers.formatUnits(bestAsk, 6) + " USDC"
      }`
    );

    // For short liquidation, we need ask orders (sell orders) to buy against
    if (bestAsk === 0n) {
      console.log(
        "🚨 CRITICAL: No ask liquidity for short liquidation market orders!"
      );
      console.log(
        "   Short liquidation requires ask orders to execute buy orders against"
      );
    } else {
      console.log("✅ Ask liquidity available for short liquidation");
    }

    // 5. Test manual liquidation if position is liquidatable
    if (isCurrentlyLiquidatable) {
      console.log("\n🔥 STEP 5: TESTING MANUAL LIQUIDATION");
      console.log("-".repeat(50));

      console.log("🚀 Triggering manual liquidation scan...");
      try {
        const liquidationTx = await orderBook.triggerLiquidationScan();
        const receipt = await liquidationTx.wait();

        console.log(`✅ Liquidation scan executed. Gas: ${receipt.gasUsed}`);

        // Check events
        let liquidationTriggered = false;
        receipt.logs.forEach((log, index) => {
          try {
            const decoded = orderBook.interface.parseLog(log);
            console.log(`   ${index + 1}. OrderBook.${decoded.name}`);
            if (decoded.name === "AutoLiquidationTriggered") {
              liquidationTriggered = true;
              console.log(
                `      🎯 Liquidation triggered for: ${decoded.args.user}`
              );
              console.log(
                `      Size: ${ethers.formatUnits(
                  decoded.args.positionSize,
                  18
                )} ALU`
              );
            }
          } catch (e) {
            try {
              const decoded = vault.interface.parseLog(log);
              console.log(`   ${index + 1}. Vault.${decoded.name}`);
            } catch (e2) {
              // Skip unknown events
            }
          }
        });

        if (!liquidationTriggered) {
          console.log(
            "⚠️  Manual liquidation scan completed but no liquidation was triggered"
          );
        }
      } catch (error) {
        console.log(`❌ Manual liquidation failed: ${error.message}`);
        if (error.reason) {
          console.log(`   Revert reason: ${error.reason}`);
        }
      }
    } else {
      console.log("\n⚠️  STEP 5: POSITION NOT LIQUIDATABLE");
      console.log("-".repeat(50));
      console.log(
        "Position is not liquidatable at current mark price - this may be correct"
      );
    }

    // 6. Final position check
    console.log("\n📊 STEP 6: FINAL POSITION STATE");
    console.log("-".repeat(50));

    const finalPosition = await vault.getUserPositionByMarket(
      shortUser,
      marketId
    );
    const finalMarginUsed = await vault.getTotalMarginUsed(shortUser);
    const finalAvailableCollateral = await vault.getAvailableCollateral(
      shortUser
    );

    console.log(
      `📈 Final Position: ${ethers.formatUnits(finalPosition.size, 18)} ALU`
    );
    console.log(
      `🔒 Final Margin Used: ${ethers.formatUnits(finalMarginUsed, 6)} USDC`
    );
    console.log(
      `🏦 Final Available Collateral: ${ethers.formatUnits(
        finalAvailableCollateral,
        6
      )} USDC`
    );

    // 7. Summary and diagnosis
    console.log("\n🎯 DIAGNOSIS SUMMARY");
    console.log("=".repeat(50));

    if (finalPosition.size === 0n) {
      console.log("✅ SUCCESS: Short position was liquidated");
    } else if (finalPosition.size !== shortPosition.size) {
      console.log("✅ PARTIAL: Short position was partially liquidated");
    } else if (!isCurrentlyLiquidatable) {
      console.log(
        "ℹ️  EXPECTED: Short position is not liquidatable at current prices"
      );
      console.log(
        `   Current mark price (${ethers.formatUnits(
          currentMarkPrice,
          6
        )}) < Liquidation price (${ethers.formatUnits(
          liquidationPriceCalculated,
          6
        )})`
      );
    } else {
      console.log(
        "🚨 ISSUE: Short position should be liquidatable but wasn't liquidated"
      );

      const issues = [];
      if (!isInActiveTraders) issues.push("User not in active traders list");
      if (bestAsk === 0n)
        issues.push("No ask liquidity for market order execution");

      if (issues.length > 0) {
        console.log("   Potential issues:");
        issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
      }
    }
  } catch (error) {
    console.error("❌ Error during investigation:", error.message);
    if (error.reason) {
      console.error("Revert reason:", error.reason);
    }
    console.error("Stack trace:", error.stack);
  }

  console.log("\n🔍 SHORT LIQUIDATION INVESTIGATION COMPLETE");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Investigation failed:", error);
    process.exit(1);
  });

