#!/usr/bin/env node

/**
 * Test Trade Debug Script
 *
 * This script executes a single market buy order to test the debugging system.
 * Run this in one terminal while running debug-trade-execution.js in another.
 *
 * Pattern matches deploy.js for contract connection and order placement.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🧪 TRADE DEBUG TESTER");
  console.log("═".repeat(50));

  // Load deployment info (same pattern as deploy.js)
  const deploymentPath = path.join(
    __dirname,
    "../deployments/localhost-deployment.json"
  );
  if (!fs.existsSync(deploymentPath)) {
    console.log("❌ No deployment found. Please run deploy.js first.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const contracts = deployment.contracts;

  // Get signers (same pattern as deploy.js)
  const signers = await ethers.getSigners();
  const [deployer, user1, user2, user3] = signers;

  console.log(`📋 OrderBook: ${contracts.ALUMINUM_ORDERBOOK}`);
  console.log(`👤 User1: ${user1.address}`);
  console.log(`👤 User2: ${user2.address}`);
  console.log(`👤 User3: ${user3.address}\n`);

  try {
    // Connect to OrderBook contract (same pattern as deploy.js)
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      contracts.ALUMINUM_ORDERBOOK
    );

    // Single market buy order for 1 ALU from User2
    console.log("🧪 Single Market Buy Order Test");
    console.log("  🔸 Placing market buy order from User2...");
    console.log("     Amount: 1 ALU");
    console.log("     Side: BUY (market order)");

    const amount = ethers.parseUnits("1", 18); // 1 ALU (18 decimals)

    const tx = await orderBook.connect(user2).placeMarginMarketOrder(
      amount,
      true // isBuy = true for buy order
    );

    console.log(`     ✅ Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log("     ✅ Market buy order executed successfully!");
    console.log(`     💰 User2 bought: 1 ALU (market order)`);
    console.log(`     📊 Transaction mined in block: ${receipt.blockNumber}`);
    console.log(`     📊 Gas used: ${receipt.gasUsed.toString()}`);

    // Check for debug events in the transaction
    console.log(`     🔍 Checking for debug events...`);
    let debugEventCount = 0;

    if (receipt.logs && receipt.logs.length > 0) {
      receipt.logs.forEach((log, i) => {
        try {
          const parsed = orderBook.interface.parseLog(log);
          if (parsed.name.startsWith("Trade")) {
            debugEventCount++;
            console.log(
              `     🎯 DEBUG EVENT ${debugEventCount}: ${parsed.name}`
            );
          }
        } catch (e) {
          // Ignore non-OrderBook events
        }
      });
    }

    if (debugEventCount > 0) {
      console.log(`     ✅ Found ${debugEventCount} debug events!`);
    } else {
      console.log(`     ⚠️  No debug events found in transaction`);
    }

    console.log("\n🎉 Trade debug test completed!");
    console.log("   Check the debug monitor for detailed execution flow.");
  } catch (error) {
    console.error("❌ Test failed:", error.message);

    // Enhanced error handling (same pattern as deploy.js)
    if (error.reason) {
      console.error("   Revert reason:", error.reason);
    }

    if (error.data) {
      console.error("   Error data:", error.data);
    }

    // Additional error context
    if (error.code) {
      console.error("   Error code:", error.code);
    }
  }
}

main().catch((error) => {
  console.error("❌ Script error:", error);
  process.exit(1);
});
