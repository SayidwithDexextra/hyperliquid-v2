#!/usr/bin/env node

// debug-position.js - Debug User3's position storage
const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔍 DEBUGGING USER3 POSITION STORAGE");
  console.log("═".repeat(50));

  const [deployer, user1, user2, user3] = await ethers.getSigners();
  const coreVault = await getContract("CORE_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));

  console.log("📊 User Addresses:");
  console.log(`• User3: ${user3.address}`);
  console.log(`• Market ID: ${marketId}`);

  // Try different ways to check User3's position
  console.log("\n🔍 Method 1: getPositionSummary (legacy)");
  try {
    const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
      user3.address, 
      marketId
    );
    console.log(`✅ Position: ${ethers.formatUnits(size, 18)} ALU @ $${ethers.formatUnits(entryPrice, 6)}`);
    console.log(`✅ Margin: $${ethers.formatUnits(marginLocked, 6)}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n🔍 Method 2: getUserEnhancedPositions (new system)");
  try {
    const positions = await coreVault.getUserEnhancedPositions(user3.address);
    console.log(`✅ Found ${positions.length} enhanced positions`);
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      console.log(`  Position ${i}:`);
      console.log(`    Market ID: ${pos.marketId}`);
      console.log(`    Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(`    Entry Price: $${ethers.formatUnits(pos.avgEntryPrice, 6)}`);
      console.log(`    Margin Posted: $${ethers.formatUnits(pos.totalMarginPosted, 6)}`);
      console.log(`    Last Update: ${new Date(Number(pos.lastUpdateTime) * 1000)}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n🔍 Method 3: Check user collateral");
  try {
    const collateral = await coreVault.userCollateral(user3.address);
    console.log(`✅ User3 collateral: $${ethers.formatUnits(collateral, 6)}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n🔍 Method 4: Check position count");
  try {
    const count = await coreVault.getUserPositionCount(user3.address);
    console.log(`✅ User3 position count: ${count}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n🔍 Method 5: Check if liquidatable");
  try {
    const markPrice = await orderBook.getMarkPrice();
    const isLiquidatable = await coreVault.isLiquidatable(
      user3.address,
      marketId, 
      markPrice
    );
    console.log(`✅ Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
    console.log(`✅ Is liquidatable: ${isLiquidatable}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n🔍 Method 6: Check unified margin summary");
  try {
    const summary = await coreVault.getUnifiedMarginSummary(user3.address);
    console.log(`✅ Total Collateral: $${ethers.formatUnits(summary.totalCollateral, 6)}`);
    console.log(`✅ Margin Used: $${ethers.formatUnits(summary.marginUsedInPositions, 6)}`);
    console.log(`✅ Available Margin: $${ethers.formatUnits(summary.availableMargin, 6)}`);
    console.log(`✅ Realized P&L: $${ethers.formatUnits(summary.realizedPnL, 6)}`);
    console.log(`✅ Unrealized P&L: $${ethers.formatUnits(summary.unrealizedPnL, 6)}`);
    console.log(`✅ Is Healthy: ${summary.isMarginHealthy}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n✅ Debug completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
