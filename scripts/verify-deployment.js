#!/usr/bin/env node

// verify-deployment.js - Simple script to verify contracts are deployed and accessible

const { ethers } = require("hardhat");
const { ADDRESSES } = require("../config/contracts");

async function main() {
  console.log("\n🔍 VERIFYING DEPLOYMENT");
  console.log("=".repeat(60));

  try {
    // Get signers
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // Check each contract
    console.log("\n📋 Checking contracts:");

    for (const [name, address] of Object.entries(ADDRESSES)) {
      try {
        // Check if contract exists
        const code = await ethers.provider.getCode(address);
        if (code === "0x") {
          console.log(`❌ ${name}: No contract at ${address}`);
        } else {
          console.log(`✅ ${name}: Contract exists at ${address}`);
        }
      } catch (error) {
        console.log(`❌ ${name}: Error checking ${address} - ${error.message}`);
      }
    }

    // Try to interact with OrderBook
    console.log("\n📊 Testing OrderBook interaction:");
    try {
      const orderBook = await ethers.getContractAt(
        "OrderBook",
        ADDRESSES.ALUMINUM_ORDERBOOK
      );

      // Try to get order counts using a more basic method
      const buyOrderCount = await orderBook.buyOrderCount();
      const sellOrderCount = await orderBook.sellOrderCount();

      console.log(`  Buy orders: ${buyOrderCount}`);
      console.log(`  Sell orders: ${sellOrderCount}`);

      // Try to get user orders for deployer
      const userOrders = await orderBook.getUserOrders(deployer.address);
      console.log(`  Deployer orders: ${userOrders.length}`);
    } catch (error) {
      console.log(`❌ OrderBook interaction failed: ${error.message}`);
    }

    // Try to interact with Vault
    console.log("\n💰 Testing Vault interaction:");
    try {
      const vault = await ethers.getContractAt(
        "CentralizedVault",
        ADDRESSES.CENTRALIZED_VAULT
      );

      // Check user collateral
      const collateral = await vault.userCollateral(deployer.address);
      console.log(
        `  Deployer collateral: ${ethers.formatUnits(collateral, 6)} USDC`
      );
    } catch (error) {
      console.log(`❌ Vault interaction failed: ${error.message}`);
    }

    console.log("\n✅ Verification complete!");
  } catch (error) {
    console.error("\n❌ Verification failed:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
