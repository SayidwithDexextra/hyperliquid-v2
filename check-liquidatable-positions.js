#!/usr/bin/env node

// check-liquidatable-positions.js - Check for liquidatable positions that might interfere
//
// 🎯 PURPOSE: Check if there are liquidatable positions causing market order failures
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔍 CHECKING FOR LIQUIDATABLE POSITIONS");
  console.log("=".repeat(60));

  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");

  try {
    const marketId = await orderBook.marketId();
    const markPrice = await orderBook.calculateMarkPrice();
    const activeTraders = await orderBook.getActiveTraders();

    console.log(`📊 Market ID: ${marketId}`);
    console.log(`📊 Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`);
    console.log(`👥 Active Traders: ${activeTraders.length}`);

    let liquidatableCount = 0;
    let problematicUsers = [];

    console.log("\n🔍 CHECKING EACH ACTIVE TRADER:");
    console.log("-".repeat(50));

    for (let i = 0; i < activeTraders.length; i++) {
      const trader = activeTraders[i];

      try {
        const position = await vault.getUserPositionByMarket(trader, marketId);
        const availableCollateral = await vault.getAvailableCollateral(trader);
        const isLiquidatable = await vault.isLiquidatable(
          trader,
          marketId,
          markPrice
        );
        const portfolioValue = await vault.getPortfolioValue(trader);

        console.log(`\n👤 Trader ${i + 1}: ${trader}`);
        console.log(
          `   Position: ${ethers.formatUnits(position.size, 18)} ALU`
        );
        console.log(
          `   Entry Price: ${ethers.formatUnits(position.entryPrice, 6)} USDC`
        );
        console.log(
          `   Margin Locked: ${ethers.formatUnits(
            position.marginLocked,
            6
          )} USDC`
        );
        console.log(
          `   Available Collateral: ${ethers.formatUnits(
            availableCollateral,
            6
          )} USDC`
        );
        console.log(
          `   Portfolio Value: ${ethers.formatUnits(portfolioValue, 6)} USDC`
        );
        console.log(`   Liquidatable: ${isLiquidatable ? "🚨 YES" : "✅ No"}`);

        if (isLiquidatable) {
          liquidatableCount++;
        }

        // Check if user has very low available collateral relative to their position
        if (
          availableCollateral < ethers.parseUnits("100", 6) &&
          position.size !== 0n
        ) {
          problematicUsers.push({
            address: trader,
            availableCollateral: ethers.formatUnits(availableCollateral, 6),
            positionSize: ethers.formatUnits(position.size, 18),
            marginLocked: ethers.formatUnits(position.marginLocked, 6),
          });
        }
      } catch (error) {
        console.log(`❌ Error checking trader ${trader}: ${error.message}`);
      }
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   Liquidatable positions: ${liquidatableCount}`);
    console.log(
      `   Problematic users (low collateral): ${problematicUsers.length}`
    );

    if (liquidatableCount > 0) {
      console.log("\n🚨 LIQUIDATABLE POSITIONS FOUND!");
      console.log("   This could cause market order failures if:");
      console.log("   1. Your market order triggers liquidation checks");
      console.log("   2. Liquidation system creates market orders");
      console.log("   3. These orders match against existing limit orders");
      console.log("   4. The limit order owners need additional margin");

      console.log("\n💡 SOLUTION: Trigger manual liquidation first");
      console.log("   Run: orderBook.triggerLiquidationScan()");
    }

    if (problematicUsers.length > 0) {
      console.log("\n⚠️  USERS WITH LOW AVAILABLE COLLATERAL:");
      problematicUsers.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.address}`);
        console.log(`      Available: ${user.availableCollateral} USDC`);
        console.log(`      Position: ${user.positionSize} ALU`);
        console.log(`      Margin Locked: ${user.marginLocked} USDC`);
      });

      console.log(
        "\n💡 These users might cause margin update failures during trades"
      );
    }

    // Try to trigger a liquidation scan to clean up any liquidatable positions
    if (liquidatableCount > 0) {
      console.log("\n🧹 TRIGGERING LIQUIDATION SCAN...");
      try {
        const tx = await orderBook.triggerLiquidationScan();
        const receipt = await tx.wait();
        console.log(`✅ Liquidation scan completed. Gas: ${receipt.gasUsed}`);

        // Check events
        let liquidationsExecuted = 0;
        receipt.logs.forEach((log) => {
          try {
            const decoded = orderBook.interface.parseLog(log);
            if (decoded.name === "AutoLiquidationTriggered") {
              liquidationsExecuted++;
              console.log(`   🎯 Liquidated: ${decoded.args.user}`);
            }
          } catch (e) {
            // Skip unknown events
          }
        });

        console.log(`📊 Total liquidations executed: ${liquidationsExecuted}`);
      } catch (error) {
        console.log(`❌ Liquidation scan failed: ${error.message}`);
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });

