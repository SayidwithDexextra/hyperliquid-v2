#!/usr/bin/env node

/**
 * Debug OrderBook Configuration
 *
 * This script checks the current OrderBook configuration to identify
 * why placeMarginLimitOrder is failing
 */

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function debugOrderBook() {
  console.log("🔍 DEBUGGING ORDERBOOK CONFIGURATION");
  console.log("═".repeat(60));

  try {
    // Get contracts
    const orderBook = await getContract("ORDERBOOK");
    const vault = await getContract("CORE_VAULT");

    console.log(
      `📍 OrderBook Address: ${orderBook.target || orderBook.address}`
    );
    console.log(`📍 CoreVault Address: ${vault.target || vault.address}`);

    // Check leverage configuration
    console.log("\n🔧 LEVERAGE CONFIGURATION:");
    console.log("-".repeat(30));

    const leverageEnabled = await orderBook.leverageEnabled();
    console.log(`✅ Leverage Enabled: ${leverageEnabled}`);

    const marginRequirementBps = await orderBook.marginRequirementBps();
    console.log(`✅ Margin Requirement (BPS): ${marginRequirementBps}`);

    // Check if margin orders are allowed
    const marginOrdersAllowed =
      leverageEnabled || marginRequirementBps.toString() === "10000";
    console.log(`✅ Margin Orders Allowed: ${marginOrdersAllowed}`);

    // Check market authorization
    console.log("\n🏪 MARKET AUTHORIZATION:");
    console.log("-".repeat(30));

    const marketId = await orderBook.marketId();
    console.log(`✅ Market ID: ${marketId}`);

    // Check if market is authorized in vault
    const isAuthorized = await vault.authorizedMarkets(marketId);
    console.log(`✅ Market Authorized in Vault: ${isAuthorized}`);

    // Get signers for testing
    const [deployer, user1] = await ethers.getSigners();
    console.log("\n👤 TEST USER INFO:");
    console.log("-".repeat(30));
    console.log(`✅ User Address: ${user1.address}`);

    // Check user collateral
    const userCollateral = await vault.userCollateral(user1.address);
    console.log(
      `✅ User Collateral: ${ethers.formatUnits(userCollateral, 6)} USDC`
    );

    // Check user position
    try {
      const userPosition = await vault.getUserPosition(user1.address, marketId);
      console.log(`✅ User Position Size: ${userPosition.size}`);
      console.log(`✅ User Position Entry Price: ${userPosition.entryPrice}`);
    } catch (error) {
      console.log(`⚠️  Could not get user position: ${error.message}`);
    }

    // Recommendations
    console.log("\n💡 RECOMMENDATIONS:");
    console.log("-".repeat(30));

    if (!leverageEnabled && marginRequirementBps.toString() !== "10000") {
      console.log("🚨 ISSUE: Margin orders are not allowed!");
      console.log(
        "   Solution 1: Enable leverage with orderBook.enableLeverage()"
      );
      console.log("   Solution 2: Set margin requirement to 100% (10000 BPS)");
    }

    if (!isAuthorized) {
      console.log("🚨 ISSUE: Market is not authorized in CoreVault!");
      console.log("   Solution: Authorize market in CoreVault");
    }

    if (userCollateral.toString() === "0") {
      console.log("🚨 ISSUE: User has no collateral!");
      console.log("   Solution: Deposit collateral first");
    }

    console.log("\n✅ Debugging complete!");
  } catch (error) {
    console.error("❌ Error during debugging:", error.message);
    console.error(error);
  }
}

async function fixOrderBookConfig() {
  console.log("\n🔧 ATTEMPTING TO FIX ORDERBOOK CONFIGURATION");
  console.log("═".repeat(60));

  try {
    const orderBook = await getContract("ORDERBOOK");
    const [deployer] = await ethers.getSigners();

    // Check if we need to enable leverage
    const leverageEnabled = await orderBook.leverageEnabled();
    const marginRequirementBps = await orderBook.marginRequirementBps();

    if (!leverageEnabled && marginRequirementBps.toString() !== "10000") {
      console.log("🔧 Enabling leverage to allow margin orders...");

      try {
        const tx = await orderBook.connect(deployer).enableLeverage();
        await tx.wait();
        console.log("✅ Leverage enabled successfully!");
      } catch (error) {
        console.log("❌ Failed to enable leverage:", error.message);
        console.log("   Trying to set margin requirement to 100% instead...");

        try {
          const tx2 = await orderBook
            .connect(deployer)
            .setMarginRequirement(10000);
          await tx2.wait();
          console.log("✅ Margin requirement set to 100% (no leverage)!");
        } catch (error2) {
          console.log("❌ Failed to set margin requirement:", error2.message);
        }
      }
    } else {
      console.log("✅ OrderBook configuration already allows margin orders");
    }
  } catch (error) {
    console.error("❌ Error fixing configuration:", error.message);
  }
}

async function main() {
  await debugOrderBook();
  await fixOrderBookConfig();

  console.log("\n🔄 Re-checking configuration after fixes...");
  await debugOrderBook();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { debugOrderBook, fixOrderBookConfig };
