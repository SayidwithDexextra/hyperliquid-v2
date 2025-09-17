#!/usr/bin/env node

/**
 * Fix Leverage Issue
 *
 * This script fixes the leverage configuration to allow margin orders
 */

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function fixLeverageConfiguration() {
  console.log("🔧 FIXING LEVERAGE CONFIGURATION");
  console.log("═".repeat(60));

  try {
    const orderBook = await getContract("ORDERBOOK");
    const [deployer] = await ethers.getSigners();

    console.log(
      `📍 OrderBook Address: ${orderBook.target || orderBook.address}`
    );
    console.log(`📍 Deployer Address: ${deployer.address}`);

    // Try to get leverage info using the compound function
    console.log("\n🔍 Checking current leverage configuration...");
    try {
      const leverageInfo = await orderBook.getLeverageInfo();
      console.log(`✅ Current Leverage Info:`, leverageInfo);
    } catch (error) {
      console.log(`❌ Could not get leverage info:`, error.message);
    }

    // Try to enable leverage
    console.log("\n🔧 Attempting to enable leverage...");
    try {
      const tx = await orderBook.connect(deployer).enableLeverage(10, 1000); // 10x max leverage, 10% margin requirement
      const receipt = await tx.wait();
      console.log(`✅ Leverage enabled! Transaction: ${tx.hash}`);
      console.log(`✅ Gas used: ${receipt.gasUsed}`);
    } catch (error) {
      console.log(`❌ Failed to enable leverage:`, error.message);

      // Try setting margin requirement to 100% (10000 BPS) for 1:1 margin
      console.log("   Trying to set margin requirement to 100% instead...");
      try {
        const tx2 = await orderBook
          .connect(deployer)
          .setMarginRequirement(10000);
        const receipt2 = await tx2.wait();
        console.log(
          `✅ Margin requirement set to 100%! Transaction: ${tx2.hash}`
        );
        console.log(`✅ Gas used: ${receipt2.gasUsed}`);
      } catch (error2) {
        console.log(`❌ Failed to set margin requirement:`, error2.message);
      }
    }

    // Verify the fix worked
    console.log("\n✅ Verifying configuration...");
    try {
      const leverageInfo = await orderBook.getLeverageInfo();
      console.log(`✅ Updated Leverage Info:`, leverageInfo);

      const [
        leverageEnabled,
        maxLeverage,
        marginRequirementBps,
        leverageController,
      ] = leverageInfo;
      console.log(`   - Leverage Enabled: ${leverageEnabled}`);
      console.log(`   - Max Leverage: ${maxLeverage}`);
      console.log(
        `   - Margin Requirement: ${marginRequirementBps} BPS (${
          Number(marginRequirementBps) / 100
        }%)`
      );
      console.log(`   - Leverage Controller: ${leverageController}`);

      // Check if margin orders should now be allowed
      const marginAllowed =
        leverageEnabled || marginRequirementBps.toString() === "10000";
      console.log(`✅ Margin Orders Allowed: ${marginAllowed}`);

      if (marginAllowed) {
        console.log(
          "🎉 SUCCESS: OrderBook is now configured to allow margin orders!"
        );
      } else {
        console.log("❌ ISSUE: Margin orders are still not allowed");
      }
    } catch (error) {
      console.log(`❌ Could not verify configuration:`, error.message);
    }
  } catch (error) {
    console.error("❌ Error during configuration:", error.message);
  }
}

async function main() {
  await fixLeverageConfiguration();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { fixLeverageConfiguration };
