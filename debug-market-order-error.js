#!/usr/bin/env node

// debug-market-order-error.js - Debug the "insufficient collateral for position margin" error
//
// 🎯 PURPOSE: Understand why market orders are failing with insufficient collateral error
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔍 DEBUGGING MARKET ORDER ERROR");
  console.log("=".repeat(60));

  // Get contracts
  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const usdc = await getContract("MOCK_USDC");

  // Get signers
  const [deployer, user1, user2] = await ethers.getSigners();

  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`👤 User1: ${user1.address}`);
  console.log(`👤 User2: ${user2.address}`);

  try {
    const marketId = await orderBook.marketId();
    console.log(`📊 Market ID: ${marketId}`);

    // 1. Check current state of all users
    console.log("\n📊 STEP 1: CURRENT USER STATES");
    console.log("-".repeat(50));

    const users = [deployer, user1, user2];
    const userNames = ["Deployer", "User1", "User2"];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const name = userNames[i];

      const position = await vault.getUserPositionByMarket(
        user.address,
        marketId
      );
      const availableCollateral = await vault.getAvailableCollateral(
        user.address
      );
      const totalMarginUsed = await vault.getTotalMarginUsed(user.address);
      const portfolioValue = await vault.getPortfolioValue(user.address);

      console.log(`\n👤 ${name} (${user.address}):`);
      console.log(`   Position: ${ethers.formatUnits(position.size, 18)} ALU`);
      console.log(
        `   Entry Price: ${ethers.formatUnits(position.entryPrice, 6)} USDC`
      );
      console.log(
        `   Margin Locked: ${ethers.formatUnits(position.marginLocked, 6)} USDC`
      );
      console.log(
        `   Available Collateral: ${ethers.formatUnits(
          availableCollateral,
          6
        )} USDC`
      );
      console.log(
        `   Total Margin Used: ${ethers.formatUnits(totalMarginUsed, 6)} USDC`
      );
      console.log(
        `   Portfolio Value: ${ethers.formatUnits(portfolioValue, 6)} USDC`
      );

      // Check if liquidatable
      const markPrice = await orderBook.calculateMarkPrice();
      const isLiquidatable = await vault.isLiquidatable(
        user.address,
        marketId,
        markPrice
      );
      console.log(`   Liquidatable: ${isLiquidatable}`);
    }

    // 2. Check order book state
    console.log("\n📊 STEP 2: ORDER BOOK STATE");
    console.log("-".repeat(50));

    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.calculateMarkPrice();
    const spread = await orderBook.getSpread();

    console.log(
      `📈 Best Bid: ${
        bestBid === 0n ? "No bids" : ethers.formatUnits(bestBid, 6) + " USDC"
      }`
    );
    console.log(
      `📉 Best Ask: ${
        bestAsk === ethers.MaxUint256
          ? "No asks"
          : ethers.formatUnits(bestAsk, 6) + " USDC"
      }`
    );
    console.log(`📊 Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`);
    console.log(
      `📏 Spread: ${
        spread === ethers.MaxUint256
          ? "No spread"
          : ethers.formatUnits(spread, 6) + " USDC"
      }`
    );

    // 3. Check active traders
    console.log("\n📊 STEP 3: ACTIVE TRADERS");
    console.log("-".repeat(50));

    const activeTraders = await orderBook.getActiveTraders();
    console.log(`👥 Active Traders Count: ${activeTraders.length}`);
    for (let i = 0; i < activeTraders.length; i++) {
      const trader = activeTraders[i];
      const position = await vault.getUserPositionByMarket(trader, marketId);
      console.log(
        `   ${i + 1}. ${trader} -> ${ethers.formatUnits(position.size, 18)} ALU`
      );
    }

    // 4. Try to simulate a small market order to understand the error
    console.log("\n🧪 STEP 4: SIMULATING MARKET ORDER");
    console.log("-".repeat(50));

    // Find a user with available collateral to test with
    let testUser = null;
    let testUserSigner = null;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const availableCollateral = await vault.getAvailableCollateral(
        user.address
      );
      if (availableCollateral > ethers.parseUnits("10", 6)) {
        // At least $10 available
        testUser = user.address;
        testUserSigner = user;
        console.log(
          `✅ Found test user: ${userNames[i]} with ${ethers.formatUnits(
            availableCollateral,
            6
          )} USDC available`
        );
        break;
      }
    }

    if (!testUser) {
      console.log("❌ No users with sufficient collateral found for testing");
      return;
    }

    // Try a small market buy order
    const testAmount = ethers.parseUnits("1", 18); // 1 ALU
    console.log(
      `🔄 Attempting market buy order: ${ethers.formatUnits(
        testAmount,
        18
      )} ALU`
    );

    try {
      // Check what the margin requirement would be
      const currentPosition = await vault.getUserPositionByMarket(
        testUser,
        marketId
      );
      console.log(
        `📊 Current position: ${ethers.formatUnits(
          currentPosition.size,
          18
        )} ALU`
      );

      // Preview the netting result
      const nettingPreview = await vault.previewPositionNetting(
        testUser,
        marketId,
        testAmount,
        markPrice
      );
      console.log(`📊 Netting preview:`);
      console.log(
        `   New Size: ${ethers.formatUnits(nettingPreview.newSize, 18)} ALU`
      );
      console.log(
        `   New Entry Price: ${ethers.formatUnits(
          nettingPreview.newEntryPrice,
          6
        )} USDC`
      );
      console.log(`   Position Closed: ${nettingPreview.positionClosed}`);
      console.log(`   Position Flipped: ${nettingPreview.positionFlipped}`);

      // Calculate required margin for the new position
      if (!nettingPreview.positionClosed && nettingPreview.newSize !== 0n) {
        const isLong = nettingPreview.newSize > 0;
        const marginBps = isLong ? 10000 : 15000; // 100% for longs, 150% for shorts
        const absSize =
          nettingPreview.newSize >= 0
            ? nettingPreview.newSize
            : -nettingPreview.newSize;
        const notional =
          (absSize * nettingPreview.newEntryPrice) / ethers.parseUnits("1", 18);
        const requiredMargin = (notional * BigInt(marginBps)) / 10000n;

        console.log(`📊 Margin calculation:`);
        console.log(`   Position type: ${isLong ? "Long" : "Short"}`);
        console.log(
          `   Notional value: ${ethers.formatUnits(notional, 6)} USDC`
        );
        console.log(
          `   Required margin: ${ethers.formatUnits(requiredMargin, 6)} USDC`
        );

        const currentMargin = await vault.userMarginByMarket(
          testUser,
          marketId
        );
        const availableCollateral = await vault.getAvailableCollateral(
          testUser
        );

        console.log(
          `   Current margin: ${ethers.formatUnits(currentMargin, 6)} USDC`
        );
        console.log(
          `   Available collateral: ${ethers.formatUnits(
            availableCollateral,
            6
          )} USDC`
        );

        if (requiredMargin > currentMargin) {
          const additionalMargin = requiredMargin - currentMargin;
          console.log(
            `   Additional margin needed: ${ethers.formatUnits(
              additionalMargin,
              6
            )} USDC`
          );
          console.log(
            `   Can afford: ${availableCollateral >= additionalMargin}`
          );
        }
      }

      // Now try the actual market order
      console.log(`\n🚀 Executing market buy order...`);
      const tx = await orderBook
        .connect(testUserSigner)
        .placeMarginMarketOrder(testAmount, true);
      const receipt = await tx.wait();

      console.log(`✅ Market order successful! Gas used: ${receipt.gasUsed}`);

      // Check events
      receipt.logs.forEach((log, index) => {
        try {
          const decoded = orderBook.interface.parseLog(log);
          console.log(`   ${index + 1}. OrderBook.${decoded.name}`);
        } catch (e) {
          try {
            const decoded = vault.interface.parseLog(log);
            console.log(`   ${index + 1}. Vault.${decoded.name}`);
          } catch (e2) {
            // Skip unknown events
          }
        }
      });
    } catch (error) {
      console.log(`❌ Market order failed: ${error.message}`);
      if (error.reason) {
        console.log(`   Revert reason: ${error.reason}`);
      }

      // Check if this is the specific error we're investigating
      if (
        error.message.includes("insufficient collateral for position margin")
      ) {
        console.log("\n🔍 ANALYZING THE SPECIFIC ERROR:");
        console.log("-".repeat(30));

        // This error comes from CentralizedVault.sol line 580 in updatePosition()
        // Let's check what might be causing it during liquidation

        console.log(
          "❗ This error occurs in CentralizedVault.updatePosition() when:"
        );
        console.log("   1. A position update requires additional margin");
        console.log("   2. The user doesn't have enough available collateral");
        console.log("   3. This can happen during liquidation if:");
        console.log("      - The liquidation system creates market orders");
        console.log("      - These orders match against existing limit orders");
        console.log("      - The limit order owners need additional margin");
        console.log("      - But they don't have sufficient collateral");

        // Check if there are any pending liquidations
        const activeTraders = await orderBook.getActiveTraders();
        let liquidatableUsers = [];

        for (const trader of activeTraders) {
          const isLiquidatable = await vault.isLiquidatable(
            trader,
            marketId,
            markPrice
          );
          if (isLiquidatable) {
            liquidatableUsers.push(trader);
          }
        }

        if (liquidatableUsers.length > 0) {
          console.log(
            `\n🚨 FOUND ${liquidatableUsers.length} LIQUIDATABLE USERS:`
          );
          for (const user of liquidatableUsers) {
            const position = await vault.getUserPositionByMarket(
              user,
              marketId
            );
            const availableCollateral = await vault.getAvailableCollateral(
              user
            );
            console.log(
              `   ${user}: ${ethers.formatUnits(
                position.size,
                18
              )} ALU, ${ethers.formatUnits(
                availableCollateral,
                6
              )} USDC available`
            );
          }

          console.log("\n💡 LIKELY CAUSE:");
          console.log(
            "   When you place a market order, it might trigger liquidation checks"
          );
          console.log(
            "   The liquidation system creates market orders that match against existing orders"
          );
          console.log(
            "   If the existing order owners are under-margined, the trade fails"
          );
        }
      }
    }

    // 5. Final recommendations
    console.log("\n💡 STEP 5: RECOMMENDATIONS");
    console.log("-".repeat(50));

    console.log(
      "If market orders are failing with 'insufficient collateral for position margin':"
    );
    console.log(
      "1. 🔍 Check if there are liquidatable positions in the system"
    );
    console.log(
      "2. 🧹 Manually trigger liquidation scan: orderBook.triggerLiquidationScan()"
    );
    console.log(
      "3. 💰 Ensure all users have sufficient collateral for their positions"
    );
    console.log(
      "4. 🔄 Try smaller order sizes to avoid triggering liquidations"
    );
  } catch (error) {
    console.error("❌ Error during debugging:", error.message);
    if (error.reason) {
      console.error("Revert reason:", error.reason);
    }
    console.error("Stack trace:", error.stack);
  }

  console.log("\n🔍 MARKET ORDER ERROR DEBUGGING COMPLETE");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Debugging failed:", error);
    process.exit(1);
  });
