#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("\n🔥 TESTING LIQUIDATION FIX - PROPER TRADING LOSS APPLICATION");
  console.log("═".repeat(80));

  const signers = await ethers.getSigners();
  const user3 = signers[3]; // User with the short position
  const user1 = signers[1]; // User to trigger price movement
  const deployer = signers[0]; // Admin

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

    console.log(
      `\n📋 Market: ${deployment.aluminumMarket.symbol} (${marketId})`
    );
    console.log(`👤 User3: ${user3.address}`);

    // STEP 1: Check User3's initial state after opening short position
    console.log("\n📊 STEP 1: PRE-LIQUIDATION STATE");
    console.log("─".repeat(50));

    let marginSummary = await vault.getMarginSummary(user3.address);
    let positions = await vault.getUserPositions(user3.address);

    console.log(
      `💰 Initial Collateral: ${ethers.formatUnits(
        marginSummary.totalCollateral,
        6
      )} USDC`
    );
    console.log(
      `🔒 Margin Locked: ${ethers.formatUnits(
        marginSummary.marginUsed,
        6
      )} USDC`
    );
    console.log(`📊 Position Count: ${positions.length}`);

    if (positions.length > 0) {
      const pos = positions[0];
      console.log(
        `📈 Position: ${ethers.formatUnits(
          pos.size,
          18
        )} ALU @ $${ethers.formatUnits(pos.entryPrice, 6)}`
      );
    }

    // STEP 2: User1 places market buy to trigger price increase (as per your instruction)
    console.log("\n🔥 STEP 2: TRIGGERING PRICE INCREASE");
    console.log("─".repeat(50));

    console.log(
      "💡 User1 placing market buy for 5 ALU (will execute at $2.50)"
    );
    const buyAmount = ethers.parseUnits("5", 18);

    const marketBuyTx = await orderBook.connect(user1).placeMarginMarketOrder(
      buyAmount,
      true // isBuy = true
    );
    await marketBuyTx.wait();
    console.log("✅ Market buy executed - price should be $2.50 now");

    const newMarkPrice = await vault.getMarkPrice(marketId);
    console.log(`💲 New Mark Price: $${ethers.formatUnits(newMarkPrice, 6)}`);

    // Calculate expected losses for User3
    if (positions.length > 0) {
      const pos = positions[0];
      const entryPrice = pos.entryPrice;
      const lossPerUnit = newMarkPrice - entryPrice;
      const totalTradingLoss =
        (lossPerUnit *
          BigInt(Math.abs(Number(ethers.formatUnits(pos.size, 18))))) /
        BigInt(10 ** 12); // Adjust for precision

      console.log(
        `📉 Expected Trading Loss: ${ethers.formatUnits(
          totalTradingLoss,
          6
        )} USDC`
      );
      console.log(
        `   (${ethers.formatUnits(lossPerUnit, 6)} USDC per ALU × ${Math.abs(
          Number(ethers.formatUnits(pos.size, 18))
        )} ALU)`
      );
    }

    // STEP 3: Trigger liquidation manually
    console.log("\n⚡ STEP 3: TRIGGERING LIQUIDATION");
    console.log("─".repeat(50));

    // Grant ORDERBOOK_ROLE to deployer if needed
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );
    await vault.connect(deployer).grantRole(ORDERBOOK_ROLE, deployer.address);

    console.log("🎯 Liquidating User3's short position...");
    const liquidationTx = await vault
      .connect(deployer)
      .liquidateShort(user3.address, marketId, deployer.address);
    await liquidationTx.wait();
    console.log("✅ Liquidation executed!");

    // STEP 4: Check post-liquidation state - THE CRITICAL TEST
    console.log("\n📊 STEP 4: POST-LIQUIDATION STATE (THE FIX TEST)");
    console.log("─".repeat(50));

    marginSummary = await vault.getMarginSummary(user3.address);
    positions = await vault.getUserPositions(user3.address);
    const liquidatedCount = await vault.getUserLiquidatedPositionsCount(
      user3.address
    );

    console.log(
      `💰 Final Collateral: ${ethers.formatUnits(
        marginSummary.totalCollateral,
        6
      )} USDC`
    );
    console.log(`📊 Position Count: ${positions.length}`);
    console.log(`🔥 Liquidated Positions: ${liquidatedCount}`);

    if (liquidatedCount > 0) {
      const liquidatedPositions = await vault.getUserLiquidatedPositions(
        user3.address
      );
      const liquidation = liquidatedPositions[0];

      console.log(`\n📋 Liquidation Details:`);
      console.log(
        `   Position: ${ethers.formatUnits(liquidation.size, 18)} ALU`
      );
      console.log(
        `   Entry Price: $${ethers.formatUnits(liquidation.entryPrice, 6)}`
      );
      console.log(
        `   Liquidation Price: $${ethers.formatUnits(
          liquidation.liquidationPrice,
          6
        )}`
      );
      console.log(
        `   Total Loss Applied: ${ethers.formatUnits(
          liquidation.marginLost,
          6
        )} USDC`
      );
    }

    // STEP 5: Verify the fix worked
    console.log("\n🔍 STEP 5: FIX VERIFICATION");
    console.log("─".repeat(50));

    const initialCollateral = 1000; // User started with 1000 USDC
    const finalCollateral = Number(
      ethers.formatUnits(marginSummary.totalCollateral, 6)
    );
    const totalLoss = initialCollateral - finalCollateral;

    console.log(`📊 Financial Impact Analysis:`);
    console.log(`   Started with: ${initialCollateral} USDC`);
    console.log(`   Ended with: ${finalCollateral} USDC`);
    console.log(`   Total Loss: ${totalLoss.toFixed(2)} USDC`);

    // Expected loss calculation
    const expectedTradingLoss = 1.5 * 10; // $1.50 per unit × 10 units
    const expectedPenalty = 0.75; // ~5% of 15 USDC margin
    const expectedTotalLoss = expectedTradingLoss + expectedPenalty;

    console.log(`\n💡 Expected vs Actual:`);
    console.log(`   Expected Trading Loss: ~${expectedTradingLoss} USDC`);
    console.log(`   Expected Penalty: ~${expectedPenalty} USDC`);
    console.log(`   Expected Total: ~${expectedTotalLoss} USDC`);
    console.log(`   Actual Total: ${totalLoss.toFixed(2)} USDC`);

    if (totalLoss >= 14 && totalLoss <= 17) {
      console.log(`\n✅ FIX SUCCESSFUL!`);
      console.log(
        `   Trading losses are now properly applied during liquidation`
      );
      console.log(
        `   User lost ~${totalLoss.toFixed(
          2
        )} USDC as expected (trading loss + penalty)`
      );
    } else if (totalLoss < 5) {
      console.log(`\n🔴 FIX FAILED!`);
      console.log(
        `   Only lost ${totalLoss.toFixed(
          2
        )} USDC - trading losses still not applied`
      );
      console.log(`   The bug persists - liquidation only applying penalties`);
    } else {
      console.log(`\n🟡 PARTIAL FIX OR UNEXPECTED RESULT:`);
      console.log(
        `   Lost ${totalLoss.toFixed(2)} USDC - verify calculation logic`
      );
    }
  } catch (error) {
    console.error("❌ Error during liquidation test:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
