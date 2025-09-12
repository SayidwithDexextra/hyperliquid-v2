#!/usr/bin/env node

// fix-mark-price.js - Fix the mark price issue for existing deployment

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

async function main() {
  console.log("\n🔧 FIXING MARK PRICE ISSUE");
  console.log("═".repeat(60));

  try {
    const [deployer] = await ethers.getSigners();
    console.log("📋 Using account:", deployer.address);

    // Get contracts
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Get the market ID from actual positions
    const [_, user1] = await ethers.getSigners();
    const positions = await vault.getUserPositions(user1.address);

    if (positions.length === 0) {
      console.log("❌ No positions found");
      return;
    }

    const marketId = positions[0].marketId;
    console.log("  Found market ID from existing position");

    console.log("\n📊 Market Info:");
    console.log("  Market ID:", marketId);
    console.log("  Symbol: ALU-USD");

    // Check current mark price
    const currentMarkPrice = await vault.marketMarkPrices(marketId);
    console.log(
      `  Current Mark Price: ${ethers.formatUnits(currentMarkPrice, 6)} USDC`
    );

    // Get best bid/ask from orderbook
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(
      `  Best Bid: ${
        bestBid > 0 ? ethers.formatUnits(bestBid, 6) : "None"
      } USDC`
    );
    console.log(
      `  Best Ask: ${
        bestAsk < ethers.MaxUint256 ? ethers.formatUnits(bestAsk, 6) : "None"
      } USDC`
    );

    // Grant SETTLEMENT_ROLE to deployer temporarily
    console.log("\n🔒 Setting up authorization...");
    const SETTLEMENT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("SETTLEMENT_ROLE")
    );
    const hasRole = await vault.hasRole(SETTLEMENT_ROLE, deployer.address);

    if (!hasRole) {
      console.log("  Granting SETTLEMENT_ROLE to deployer...");
      await vault.grantRole(SETTLEMENT_ROLE, deployer.address);
      console.log("  ✅ Role granted");
    } else {
      console.log("  ✅ Already has SETTLEMENT_ROLE");
    }

    // Set a reasonable mark price
    // If there are orders, use mid-price; otherwise use initial price
    let newMarkPrice;
    if (bestBid > 0 && bestAsk < ethers.MaxUint256) {
      // Use mid-price
      newMarkPrice = (BigInt(bestBid) + BigInt(bestAsk)) / 2n;
      console.log(
        `\n📈 Using mid-price from order book: ${ethers.formatUnits(
          newMarkPrice,
          6
        )} USDC`
      );
    } else {
      // Use the initial market price of 2500 USDC
      newMarkPrice = ethers.parseUnits("2500", 6);
      console.log(
        `\n📈 Using initial market price: ${ethers.formatUnits(
          newMarkPrice,
          6
        )} USDC`
      );
    }

    // Update mark price
    console.log("\n🔄 Updating mark price...");
    const tx = await vault.updateMarkPrice(marketId, newMarkPrice);
    await tx.wait();
    console.log("  ✅ Mark price updated!");

    // Verify the update
    const updatedMarkPrice = await vault.marketMarkPrices(marketId);
    console.log(
      `  New Mark Price: ${ethers.formatUnits(updatedMarkPrice, 6)} USDC`
    );

    // Check P&L after fix
    console.log("\n📊 Checking P&L after fix:");
    const signers = await ethers.getSigners();

    for (const [user, name] of [
      [signers[0], "Deployer"],
      [signers[1], "User 1"],
    ]) {
      const marginSummary = await vault.getMarginSummary(user.address);
      const positions = await vault.getUserPositions(user.address);

      if (positions.length > 0) {
        console.log(`\n  ${name}:`);
        console.log(
          `    Unrealized P&L: ${ethers.formatUnits(
            marginSummary.unrealizedPnL,
            6
          )} USDC`
        );
        console.log(
          `    Portfolio Value: ${ethers.formatUnits(
            marginSummary.portfolioValue,
            6
          )} USDC`
        );
      }
    }

    console.log("\n✅ Mark price issue fixed!");
    console.log("  The huge P&L values should now be reasonable.");
  } catch (error) {
    console.error("\n❌ Fix failed:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
