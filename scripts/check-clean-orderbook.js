#!/usr/bin/env node

// check-clean-orderbook.js - Simple script to verify orderbook is empty

const { ethers } = require("hardhat");
const { ADDRESSES } = require("../config/contracts");

async function main() {
  console.log("\n🔍 CHECKING ORDERBOOK STATE");
  console.log("=".repeat(60));

  try {
    const [deployer, user1, user2, user3] = await ethers.getSigners();
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      ADDRESSES.ALUMINUM_ORDERBOOK
    );

    // Check for any orders from users
    console.log("\n📋 Checking user orders:");
    const users = [
      { signer: deployer, name: "Deployer" },
      { signer: user1, name: "User 1" },
      { signer: user2, name: "User 2" },
      { signer: user3, name: "User 3" },
    ];

    let totalOrders = 0;
    for (const user of users) {
      try {
        const orderIds = await orderBook.getUserOrders(user.signer.address);
        console.log(`  ${user.name}: ${orderIds.length} orders`);
        totalOrders += orderIds.length;
      } catch (error) {
        console.log(`  ${user.name}: No orders`);
      }
    }

    // Check positions in vault
    console.log("\n📊 Checking positions:");
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      ADDRESSES.CENTRALIZED_VAULT
    );
    const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));

    for (const user of users) {
      try {
        const positions = await vault.getUserPositions(user.signer.address);
        const aluPosition = positions.find((p) => p.marketId === marketId);

        if (aluPosition && aluPosition.size !== 0n) {
          const size = aluPosition.size;
          const absSize = size < 0n ? -size : size;
          const isLong = size > 0n;
          console.log(
            `  ${user.name}: ${isLong ? "LONG" : "SHORT"} ${ethers.formatUnits(
              absSize,
              18
            )} ALU`
          );
        } else {
          console.log(`  ${user.name}: No position`);
        }
      } catch (error) {
        console.log(`  ${user.name}: No position`);
      }
    }

    // Check collateral
    console.log("\n💰 Checking collateral:");
    for (const user of users) {
      try {
        const collateral = await vault.userCollateral(user.signer.address);
        console.log(
          `  ${user.name}: ${ethers.formatUnits(collateral, 6)} USDC`
        );
      } catch (error) {
        console.log(`  ${user.name}: Error checking collateral`);
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    if (totalOrders === 0) {
      console.log("✅ ORDERBOOK IS CLEAN - No active orders!");
    } else {
      console.log(`⚠️  ORDERBOOK HAS ${totalOrders} ACTIVE ORDERS`);
    }
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Check failed:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
