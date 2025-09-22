#!/usr/bin/env node

// test-liquidation-now.js - Test liquidation with fixed liquidity setup
const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔥 TESTING LIQUIDATION WITH FIXED LIQUIDITY");
  console.log("═".repeat(50));

  const [deployer, user1, user2, user3] = await ethers.getSigners();
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const coreVault = await getContract("CORE_VAULT");
  const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));

  // Check User3's current position
  console.log("📊 Current State:");
  const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
    user3.address,
    marketId
  );

  console.log(
    `• User3 Position: ${ethers.formatUnits(
      size,
      18
    )} ALU @ $${ethers.formatUnits(entryPrice, 6)}`
  );
  console.log(`• Margin Locked: $${ethers.formatUnits(marginLocked, 6)}`);

  if (size === 0n) {
    console.log("❌ User3 has no position. Run deploy.js first!");
    return;
  }

  // Check current mark price
  const currentMarkPrice = await orderBook.getMarkPrice();
  console.log(
    `• Current Mark Price: $${ethers.formatUnits(currentMarkPrice, 6)}`
  );

  // Get liquidation price
  const [liquidationPrice, hasPosition] = await coreVault.getLiquidationPrice(
    user3.address,
    marketId
  );

  if (!hasPosition) {
    console.log("❌ No liquidatable position found");
    return;
  }

  console.log(
    `• Liquidation Price: $${ethers.formatUnits(liquidationPrice, 6)}`
  );

  // Check order book liquidity
  console.log("\n📖 Order Book Liquidity:");
  const depth = await orderBook.getOrderBookDepth(10);
  console.log("Asks (for liquidation buying):");
  if (depth.askPrices.length === 0) {
    console.log("  ❌ No ASK liquidity available!");
  } else {
    for (let i = 0; i < depth.askPrices.length; i++) {
      console.log(
        `  $${ethers.formatUnits(depth.askPrices[i], 6)} x ${ethers.formatUnits(
          depth.askAmounts[i],
          18
        )} ALU`
      );
    }
  }

  // Set mark price to trigger liquidation
  console.log("\n🚀 Triggering Liquidation:");
  const triggerPrice = liquidationPrice + ethers.parseUnits("0.05", 6); // +$0.05 above liquidation
  console.log(
    `• Setting mark price to: $${ethers.formatUnits(triggerPrice, 6)}`
  );

  await coreVault.connect(deployer).updateMarkPrice(marketId, triggerPrice);

  // Check if now liquidatable
  const isLiquidatable = await coreVault.isLiquidatable(
    user3.address,
    marketId,
    triggerPrice
  );
  console.log(`• Is now liquidatable: ${isLiquidatable}`);

  if (!isLiquidatable) {
    console.log(
      "❌ Position still not liquidatable. Price may need to be higher."
    );
    return;
  }

  // Set up event listeners
  const events = [];

  // OrderBook events
  orderBook.on(
    "LiquidationMarketOrderAttempt",
    (trader, amount, isBuy, markPrice) => {
      events.push(
        `🎯 Market Order Attempt: ${ethers.formatUnits(
          amount,
          18
        )} ALU, isBuy=${isBuy}, @$${ethers.formatUnits(markPrice, 6)}`
      );
    }
  );

  orderBook.on("LiquidationMarketOrderResult", (trader, success, reason) => {
    events.push(
      `📊 Market Order Result: ${
        success ? "SUCCESS ✅" : "FAILED ❌"
      } - ${reason}`
    );
  });

  // CoreVault events
  coreVault.on(
    "LiquidationExecuted",
    (user, marketId, liquidator, totalLoss, remainingCollateral) => {
      events.push(
        `🔥 LiquidationExecuted: Loss=$${ethers.formatUnits(
          totalLoss,
          6
        )}, Remaining=$${ethers.formatUnits(remainingCollateral, 6)}`
      );
    }
  );

  coreVault.on(
    "PositionUpdated",
    (user, marketId, oldSize, newSize, entryPrice, marginLocked) => {
      events.push(
        `📈 PositionUpdated: ${ethers.formatUnits(
          oldSize,
          18
        )} → ${ethers.formatUnits(newSize, 18)} ALU`
      );
    }
  );

  coreVault.on(
    "LiquidationDebug_FunctionEntry",
    (user, marketId, liquidator, functionName) => {
      events.push(`🔍 DEBUG: ${functionName} called`);
    }
  );

  coreVault.on(
    "LiquidationDebug_PositionFound",
    (user, marketId, size, marginLocked, entryPrice) => {
      events.push(
        `🔍 DEBUG: Position found - ${ethers.formatUnits(
          size,
          18
        )} ALU @ $${ethers.formatUnits(entryPrice, 6)}`
      );
    }
  );

  coreVault.on(
    "LiquidationDebug_LossCalculation",
    (user, tradingLoss, penalty, actualLoss, userCollateral) => {
      events.push(
        `🔍 DEBUG: Loss calc - Trading=$${ethers.formatUnits(
          tradingLoss,
          6
        )}, Penalty=$${ethers.formatUnits(
          penalty,
          6
        )}, Total=$${ethers.formatUnits(actualLoss, 6)}`
      );
    }
  );

  // Execute liquidation
  console.log("\n⚡ Executing Liquidation Scan:");
  const liquidationTx = await orderBook.triggerLiquidationScan();
  await liquidationTx.wait();
  console.log("• Liquidation scan completed");

  // Wait for events and display them
  console.log("• Waiting for events...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("\n📋 LIQUIDATION EVENTS:");
  if (events.length === 0) {
    console.log("❌ No events captured - check event filters");
  } else {
    events.forEach((event, i) => {
      console.log(`${i + 1}. ${event}`);
    });
  }

  // Check final state
  console.log("\n📊 Final State:");
  const [finalSize, finalEntryPrice, finalMarginLocked] =
    await coreVault.getPositionSummary(user3.address, marketId);

  console.log(
    `• User3 Final Position: ${ethers.formatUnits(
      finalSize,
      18
    )} ALU @ $${ethers.formatUnits(finalEntryPrice, 6)}`
  );
  console.log(
    `• Final Margin Locked: $${ethers.formatUnits(finalMarginLocked, 6)}`
  );

  const finalCollateral = await coreVault.userCollateral(user3.address);
  console.log(`• Final Collateral: $${ethers.formatUnits(finalCollateral, 6)}`);

  if (
    finalSize === 0n &&
    events.some((e) => e.includes("LiquidationExecuted"))
  ) {
    console.log("✅ LIQUIDATION SUCCESSFUL!");
  } else if (finalSize === 0n) {
    console.log("⚠️  Position closed but may not have been liquidated");
  } else {
    console.log("❌ Position still open - liquidation may have failed");
  }

  console.log("\n✅ Test completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
