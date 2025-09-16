#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract, ADDRESSES } = require("./config/contracts");

async function checkContracts() {
  console.log("🔍 CHECKING CONTRACT DEPLOYMENT");
  console.log("═".repeat(50));

  try {
    console.log("📋 Contract Addresses from Config:");
    for (const [name, address] of Object.entries(ADDRESSES)) {
      console.log(`  ${name}: ${address}`);

      // Check if there's code at this address
      try {
        const code = await ethers.provider.getCode(address);
        const hasCode = code !== "0x";
        console.log(`    Status: ${hasCode ? "✅ Has code" : "❌ No code"}`);

        if (hasCode) {
          console.log(`    Code length: ${code.length} characters`);
        }
      } catch (error) {
        console.log(`    Status: ❌ Error - ${error.message}`);
      }
    }

    console.log("\n🔗 Network Info:");
    const network = await ethers.provider.getNetwork();
    console.log(`  Chain ID: ${network.chainId}`);
    console.log(`  Name: ${network.name}`);

    const blockNumber = await ethers.provider.getBlockNumber();
    console.log(`  Block Number: ${blockNumber}`);

    // Try to interact with the vault
    console.log("\n🏦 Testing Vault Contract:");
    try {
      const vault = await getContract("CENTRALIZED_VAULT");
      console.log(`  Address: ${await vault.getAddress()}`);

      // Try a simple read-only function that should always work
      try {
        const totalCollateralDeposited = await vault.totalCollateralDeposited();
        console.log(
          `  Total Collateral: ${ethers.formatUnits(
            totalCollateralDeposited,
            6
          )} USDC`
        );
        console.log("  ✅ Vault contract is responsive");
      } catch (error) {
        console.log(`  ❌ Vault contract error: ${error.message}`);
      }
    } catch (error) {
      console.log(`  ❌ Failed to get vault contract: ${error.message}`);
    }

    // Test OrderBook
    console.log("\n📚 Testing OrderBook Contract:");
    try {
      const orderBook = await getContract("ALUMINUM_ORDERBOOK");
      console.log(`  Address: ${await orderBook.getAddress()}`);

      try {
        const bestBid = await orderBook.bestBid();
        const bestAsk = await orderBook.bestAsk();
        console.log(`  Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
        console.log(`  Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);
        console.log("  ✅ OrderBook contract is responsive");
      } catch (error) {
        console.log(`  ❌ OrderBook contract error: ${error.message}`);
      }
    } catch (error) {
      console.log(`  ❌ Failed to get orderbook contract: ${error.message}`);
    }
  } catch (error) {
    console.error("❌ Check failed:", error.message);
  }
}

checkContracts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
