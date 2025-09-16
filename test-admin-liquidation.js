#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("\n🔥 TESTING ADMIN LIQUIDATION & MARGIN CLEARING BUG");
  console.log("═".repeat(80));

  const signers = await ethers.getSigners();
  const user3 = signers[3]; // User with the short position
  const deployer = signers[0]; // Admin with proper roles

  try {
    // Load contracts
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Read market ID from deployment file
    const fs = require("fs");
    const deployment = JSON.parse(
      fs.readFileSync("./deployments/localhost-deployment.json", "utf8")
    );
    const marketId = deployment.aluminumMarket.marketId;

    console.log(`\n📋 USER3: ${user3.address}`);
    console.log(`🏭 Market: ${deployment.aluminumMarket.symbol} (${marketId})`);

    // STEP 1: Current state (should show 150% loss)
    console.log("\n📊 PRE-LIQUIDATION STATE");
    console.log("─".repeat(40));

    let marginSummary = await vault.getMarginSummary(user3.address);
    let positions = await vault.getUserPositions(user3.address);
    let obPosition = await orderBook.userPositions(user3.address);
    let markPrice = await vault.getMarkPrice(marketId);

    console.log(
      `💰 Margin Locked: ${ethers.formatUnits(
        marginSummary.marginUsed,
        6
      )} USDC`
    );
    console.log(
      `📊 Positions: ${positions.length} (Vault) | ${ethers.formatUnits(
        obPosition,
        18
      )} ALU (OrderBook)`
    );
    console.log(`💲 Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

    if (positions.length > 0) {
      const pos = positions[0];
      const loss = ((markPrice - pos.entryPrice) * 10000n) / pos.entryPrice;
      console.log(
        `📉 Position Loss: ${Number(loss) / 100}% (${ethers.formatUnits(
          pos.size,
          18
        )} ALU @ $${ethers.formatUnits(pos.entryPrice, 6)})`
      );
    }

    // STEP 2: Try liquidation with proper admin role
    console.log("\n⚡ TRIGGERING LIQUIDATION (Admin)");
    console.log("─".repeat(40));

    try {
      // Method 1: Direct liquidation via Vault using deployer (should have ORDERBOOK_ROLE)
      console.log("🎯 Attempting liquidation via deployer...");

      const liquidationTx = await vault.connect(deployer).liquidateShort(
        user3.address,
        marketId,
        deployer.address // deployer as liquidator
      );
      await liquidationTx.wait();
      console.log("✅ LIQUIDATION SUCCESSFUL via deployer!");
    } catch (error) {
      console.log(`❌ Deployer liquidation failed: ${error.message}`);

      // Method 2: Try granting ORDERBOOK_ROLE to deployer first
      console.log("\n🔧 Trying to grant ORDERBOOK_ROLE to deployer...");
      try {
        const ORDERBOOK_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("ORDERBOOK_ROLE")
        );
        const grantTx = await vault
          .connect(deployer)
          .grantRole(ORDERBOOK_ROLE, deployer.address);
        await grantTx.wait();
        console.log("✅ ORDERBOOK_ROLE granted to deployer");

        // Now try liquidation again
        console.log("🎯 Re-attempting liquidation with ORDERBOOK_ROLE...");
        const liquidationTx2 = await vault
          .connect(deployer)
          .liquidateShort(user3.address, marketId, deployer.address);
        await liquidationTx2.wait();
        console.log("✅ LIQUIDATION SUCCESSFUL with ORDERBOOK_ROLE!");
      } catch (error2) {
        console.log(`❌ Role-based liquidation also failed: ${error2.message}`);

        // Method 3: Check if OrderBook can trigger it
        console.log("\n🔧 Trying liquidation through OrderBook contract...");
        try {
          // Some OrderBook contracts have a manual liquidation trigger
          const liquidationTx3 = await orderBook
            .connect(deployer)
            .liquidatePosition(user3.address);
          await liquidationTx3.wait();
          console.log("✅ LIQUIDATION SUCCESSFUL via OrderBook!");
        } catch (error3) {
          console.log(`❌ OrderBook liquidation failed: ${error3.message}`);
          console.log(
            "   All liquidation methods failed - this indicates a deeper issue"
          );
        }
      }
    }

    // STEP 3: Check post-liquidation state
    console.log("\n📊 POST-LIQUIDATION STATE");
    console.log("─".repeat(40));

    marginSummary = await vault.getMarginSummary(user3.address);
    positions = await vault.getUserPositions(user3.address);
    obPosition = await orderBook.userPositions(user3.address);
    const liquidatedCount = await vault.getUserLiquidatedPositionsCount(
      user3.address
    );

    console.log(
      `💰 Margin Locked: ${ethers.formatUnits(
        marginSummary.marginUsed,
        6
      )} USDC`
    );
    console.log(
      `📊 Positions: ${positions.length} (Vault) | ${ethers.formatUnits(
        obPosition,
        18
      )} ALU (OrderBook)`
    );
    console.log(`🔥 Liquidated Positions: ${liquidatedCount}`);

    // STEP 4: THE MARGIN CLEARING BUG CHECK
    console.log("\n🔍 MARGIN CLEARING BUG ANALYSIS");
    console.log("─".repeat(40));

    if (liquidatedCount > 0) {
      console.log("✅ LIQUIDATION OCCURRED!");

      // Show liquidation details
      const liquidatedPositions = await vault.getUserLiquidatedPositions(
        user3.address
      );
      console.log(`📋 Liquidation Details:`);
      const pos = liquidatedPositions[0];
      console.log(`   Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(
        `   Margin Lost: ${ethers.formatUnits(pos.marginLost, 6)} USDC`
      );
      console.log(`   Liquidator: ${pos.liquidator}`);

      // 🎯 THE BUG CHECK - This is what you reported
      if (marginSummary.marginUsed > 0 && positions.length === 0) {
        console.log(
          "\n🔴 BUG CONFIRMED: MARGIN STILL LOCKED AFTER LIQUIDATION!"
        );
        console.log(
          `   Margin Locked: ${ethers.formatUnits(
            marginSummary.marginUsed,
            6
          )} USDC`
        );
        console.log(`   Active Positions: ${positions.length}`);
        console.log(
          `   OrderBook Position: ${ethers.formatUnits(obPosition, 18)} ALU`
        );
        console.log("   🎯 THIS IS THE EXACT ISSUE YOU REPORTED!");

        // Debug the root cause
        console.log("\n🔍 ROOT CAUSE ANALYSIS:");

        // Check specific market margin
        const marginForMarket = await vault.userMarginByMarket(
          user3.address,
          marketId
        );
        console.log(
          `   userMarginByMarket: ${ethers.formatUnits(
            marginForMarket,
            6
          )} USDC`
        );

        if (marginForMarket > 0) {
          console.log(
            "   🔴 PROBLEM: userMarginByMarket not cleared in liquidation"
          );
        }

        // Check if market still tracked
        try {
          const firstMarket = await vault.userMarketIds(user3.address, 0);
          console.log(
            `   🔴 PROBLEM: User still has market in tracking: ${firstMarket}`
          );

          if (firstMarket === marketId) {
            console.log(
              "   🔴 PROBLEM: Liquidated market not removed from userMarketIds"
            );
          }
        } catch (error) {
          console.log("   ✅ No markets in tracking (this is correct)");
        }

        console.log("\n💡 CONCLUSION:");
        console.log("   The liquidation functions are not properly clearing:");
        console.log("   - userMarginByMarket mapping");
        console.log("   - userMarketIds array");
        console.log(
          "   - This causes getTotalMarginUsed() to return stale data"
        );
      } else if (marginSummary.marginUsed === 0n && positions.length === 0) {
        console.log("\n✅ PERFECT: MARGIN PROPERLY CLEARED AFTER LIQUIDATION!");
        console.log(
          "   No bug detected - liquidation cleanup worked correctly"
        );
      } else {
        console.log("\n🟡 PARTIAL OR INCOMPLETE LIQUIDATION");
        console.log(`   Positions remaining: ${positions.length}`);
      }
    } else {
      console.log("❌ NO LIQUIDATION OCCURRED");
      console.log("   Unable to reproduce the margin clearing bug");
      console.log(
        "   The liquidation system appears to have fundamental issues"
      );

      console.log("\n💡 NEXT STEPS:");
      console.log("   1. Check liquidation conditions logic");
      console.log("   2. Verify automatic liquidation triggers");
      console.log("   3. Test liquidation with extreme price movements");
    }
  } catch (error) {
    console.error("❌ Error during admin liquidation test:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
