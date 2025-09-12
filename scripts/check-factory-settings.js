#!/usr/bin/env node

// check-factory-settings.js - Check FuturesMarketFactory settings
//
// 🎯 PURPOSE:
//   Check if public market creation is enabled and who the admin is
//

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

async function main() {
  console.log("\n🔍 CHECKING FUTURES MARKET FACTORY SETTINGS");
  console.log("═".repeat(60));

  try {
    const [deployer] = await ethers.getSigners();
    const factory = await getContract("FUTURES_MARKET_FACTORY");

    console.log("📋 Factory Address:", await factory.getAddress());
    console.log("📋 Current User:", deployer.address);

    // Check admin
    const admin = await factory.admin();
    console.log("\n👤 Factory Admin:", admin);
    console.log(
      `   Is deployer admin? ${admin === deployer.address ? "✅ YES" : "❌ NO"}`
    );

    // Check public market creation
    const publicMarketCreation = await factory.publicMarketCreation();
    console.log(
      "\n🌐 Public Market Creation:",
      publicMarketCreation ? "✅ ENABLED" : "❌ DISABLED"
    );

    // Check market creation fee
    const creationFee = await factory.marketCreationFee();
    console.log(
      "\n💰 Market Creation Fee:",
      ethers.formatUnits(creationFee, 6),
      "USDC"
    );

    // Check fee recipient
    const feeRecipient = await factory.feeRecipient();
    console.log("💸 Fee Recipient:", feeRecipient);

    // Check default parameters
    const marginReq = await factory.defaultMarginRequirementBps();
    const tradingFee = await factory.defaultTradingFee();
    const leverageEnabled = await factory.defaultLeverageEnabled();

    console.log("\n📊 Default Market Parameters:");
    console.log(`   Margin Requirement: ${marginReq / 100}%`);
    console.log(`   Trading Fee: ${tradingFee / 100}%`);
    console.log(`   Leverage Enabled: ${leverageEnabled ? "✅" : "❌"}`);

    console.log("\n💡 SOLUTION:");
    if (!publicMarketCreation && admin !== deployer.address) {
      console.log("   Option 1: Enable public market creation (admin only)");
      console.log("   Option 2: Set deployer as admin (current admin only)");
      console.log("   Option 3: Have the admin create the market");
    } else if (publicMarketCreation) {
      console.log(
        "   ✅ Public market creation is enabled - anyone can create markets!"
      );
    } else if (admin === deployer.address) {
      console.log("   ✅ You are the admin - you can create markets!");
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
