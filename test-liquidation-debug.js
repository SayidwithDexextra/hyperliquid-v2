#!/usr/bin/env node

// test-liquidation-debug.js - Test liquidation debugging system
const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

async function main() {
  console.log("🔥 LIQUIDATION DEBUG TEST");
  console.log("═".repeat(50));

  // Get contracts
  const [deployer, user1, user2, user3] = await ethers.getSigners();
  const coreVault = await getContract("CORE_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const mockUSDC = await getContract("MOCK_USDC");

  console.log("📊 Initial State Check");
  console.log("-".repeat(30));

  // Check User3's current position using the legacy getUserPositions function
  try {
    const user3Positions = await coreVault.getUserPositions(user3.address);
    console.log(`User3 positions: ${user3Positions.length}`);

    if (user3Positions.length > 0) {
      const pos = user3Positions[0];
      console.log(
        `Position: ${ethers.formatUnits(
          pos.size,
          18
        )} ALU @ $${ethers.formatUnits(pos.entryPrice, 6)}`
      );
      console.log(`Margin: $${ethers.formatUnits(pos.marginLocked, 6)}`);
    }
  } catch (error) {
    console.log("⚠️ Could not get user positions:", error.message);
  }

  // Check current mark price
  const currentMarkPrice = await orderBook.getMarkPrice();
  console.log(
    `Current mark price: $${ethers.formatUnits(currentMarkPrice, 6)}`
  );

  // Check liquidation price
  const marketId = MARKET_INFO.ALUMINUM.marketId;
  const [liquidationPrice, hasPosition] = await coreVault.getLiquidationPrice(
    user3.address,
    marketId
  );
  console.log(`Liquidation price: $${ethers.formatUnits(liquidationPrice, 6)}`);
  console.log(`Has position: ${hasPosition}`);

  // Debug: Check if User3 has enhanced positions
  console.log("🔍 Debugging enhanced positions...");
  try {
    // Try to access the mapping directly (this might not work in tests)
    const enhancedPositions = await coreVault.userEnhancedPositions(
      user3.address,
      0
    );
    console.log(
      `Enhanced position 0: size=${ethers.formatUnits(
        enhancedPositions.size,
        18
      )}, entry=${ethers.formatUnits(enhancedPositions.avgEntryPrice, 6)}`
    );
  } catch (error) {
    console.log(
      "⚠️ Could not access enhanced positions directly:",
      error.message
    );
  }

  // Check if liquidatable at current price
  const isLiquidatable = await coreVault.isLiquidatable(
    user3.address,
    marketId,
    currentMarkPrice
  );
  console.log(`Currently liquidatable: ${isLiquidatable}`);

  console.log("\n🚀 Setting up liquidation scenario");
  console.log("-".repeat(30));

  // Set mark price to trigger liquidation (above liquidation price)
  const triggerPrice = liquidationPrice + ethers.parseUnits("0.5", 6); // Add 50 cents buffer
  console.log(`Setting mark price to: $${ethers.formatUnits(triggerPrice, 6)}`);

  await coreVault.connect(deployer).updateMarkPrice(marketId, triggerPrice);

  // Check if now liquidatable
  const nowLiquidatable = await coreVault.isLiquidatable(
    user3.address,
    marketId,
    triggerPrice
  );
  console.log(`Now liquidatable: ${nowLiquidatable}`);

  if (!nowLiquidatable) {
    console.log(
      "❌ Position is not liquidatable yet. Increasing price further..."
    );
    const higherPrice = ethers.parseUnits("3.0", 6); // $3.00
    await coreVault.connect(deployer).updateMarkPrice(marketId, higherPrice);
    const finalCheck = await coreVault.isLiquidatable(
      user3.address,
      marketId,
      higherPrice
    );
    console.log(`Liquidatable at $3.00: ${finalCheck}`);
  }

  console.log("\n🎯 Setting up event listeners");
  console.log("-".repeat(30));

  // Set up event listeners for debugging
  const events = [];

  // CoreVault debug events
  coreVault.on(
    "LiquidationDebug_FunctionEntry",
    (user, marketId, liquidator, functionName) => {
      events.push(
        `🔍 FUNCTION ENTRY: ${functionName} for ${user.slice(0, 8)}...`
      );
    }
  );

  coreVault.on(
    "LiquidationDebug_PositionFound",
    (user, marketId, size, marginLocked, entryPrice) => {
      events.push(
        `✅ POSITION FOUND: ${ethers.formatUnits(
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
        `💰 LOSS CALC: Trading=$${ethers.formatUnits(
          tradingLoss,
          6
        )}, Penalty=$${ethers.formatUnits(
          penalty,
          6
        )}, Total=$${ethers.formatUnits(actualLoss, 6)}`
      );
    }
  );

  coreVault.on(
    "LiquidationDebug_MarginConfiscation",
    (user, confiscated, remaining) => {
      events.push(
        `💸 CONFISCATED: $${ethers.formatUnits(
          confiscated,
          6
        )}, Remaining: $${ethers.formatUnits(remaining, 6)}`
      );
    }
  );

  coreVault.on(
    "LiquidationDebug_PositionClosed",
    (user, marketId, oldSize, marginReleased) => {
      events.push(
        `🔒 POSITION CLOSED: ${ethers.formatUnits(
          oldSize,
          18
        )} ALU, Margin Released: $${ethers.formatUnits(marginReleased, 6)}`
      );
    }
  );

  // OrderBook debug events
  orderBook.on(
    "LiquidationExecutionPriceUpdated",
    (trader, triggerPrice, executionPrice) => {
      events.push(
        `📊 EXECUTION PRICE: Trigger=$${ethers.formatUnits(
          triggerPrice,
          6
        )}, Execution=$${ethers.formatUnits(executionPrice, 6)}`
      );
    }
  );

  console.log("✅ Event listeners set up");

  console.log("\n🔥 TRIGGERING LIQUIDATION");
  console.log("-".repeat(30));

  // Place a buy order to provide liquidity for liquidation
  console.log("📈 Placing buy order for liquidation...");
  await orderBook.connect(user1).placeMarginLimitOrder(
    ethers.parseUnits("2.5", 6), // $2.50
    ethers.parseUnits("15", 18), // 15 ALU
    true // isBuy
  );

  // Wait a moment for events
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Trigger liquidation check manually
  console.log("⚡ Triggering liquidation check...");
  const currentPrice = await orderBook.getMarkPrice();
  await orderBook.connect(deployer).triggerLiquidationCheck(currentPrice);

  // Wait for events to be processed
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n📋 LIQUIDATION DEBUG EVENTS");
  console.log("-".repeat(30));
  events.forEach((event, i) => {
    console.log(`${i + 1}. ${event}`);
  });

  console.log("\n📊 Final State Check");
  console.log("-".repeat(30));

  // Check User3's position after liquidation
  try {
    const finalPositions = await coreVault.getUserPositions(user3.address);
    console.log(`User3 final positions: ${finalPositions.length}`);
  } catch (error) {
    console.log("⚠️ Could not get final positions:", error.message);
  }

  // Check User3's collateral
  const finalCollateral = await coreVault.getUserCollateral(user3.address);
  console.log(
    `User3 final collateral: $${ethers.formatUnits(finalCollateral, 6)}`
  );

  console.log("\n✅ Liquidation debug test completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
