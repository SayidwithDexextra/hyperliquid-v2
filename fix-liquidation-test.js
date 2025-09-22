#!/usr/bin/env node

// fix-liquidation-test.js - Add liquidity and test liquidation
const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("🔧 FIXING LIQUIDATION TEST - ADDING LIQUIDITY");
  console.log("═".repeat(50));

  const [deployer, user1, user2, user3] = await ethers.getSigners();
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const coreVault = await getContract("CORE_VAULT");
  const mockUSDC = await getContract("MOCK_USDC");

  // Check current liquidatable user's position
  console.log("📊 Checking liquidatable user's position...");
  const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));

  // Check User3's position (assuming they have a short to liquidate)
  const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
    user3.address,
    marketId
  );

  console.log(`Position: ${ethers.formatUnits(size, 18)} ALU`);
  console.log(`Entry Price: $${ethers.formatUnits(entryPrice, 6)}`);
  console.log(`Margin Locked: $${ethers.formatUnits(marginLocked, 6)}`);

  const isShort = size < 0;
  const isLong = size > 0;

  if (size === 0n) {
    console.log("❌ User has no position to liquidate");
    return;
  }

  // Get current mark price and check liquidation status
  const markPrice = await orderBook.getMarkPrice();
  console.log(`Current Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

  const isLiquidatable = await coreVault.isLiquidatable(
    user3.address,
    marketId,
    markPrice
  );
  console.log(`Is Liquidatable: ${isLiquidatable}`);

  // Add liquidity for liquidation to work
  console.log("\n💧 ADDING LIQUIDATION LIQUIDITY");
  console.log("-".repeat(30));

  if (isShort) {
    console.log(
      "🟢 Short position detected - Adding ASK liquidity for liquidation BUY orders"
    );

    // For short liquidation, we need SELL orders (asks) that liquidation can buy against
    // Add multiple ask levels around and above current mark price
    const basePrice = markPrice;
    const liquidationAmountNeeded = ethers.parseUnits(
      ethers.formatUnits(-size, 18),
      18
    ); // Convert to positive

    // Add asks at various price levels (slightly above mark price)
    const askPrices = [
      basePrice + ethers.parseUnits("0.10", 6), // +$0.10
      basePrice + ethers.parseUnits("0.20", 6), // +$0.20
      basePrice + ethers.parseUnits("0.30", 6), // +$0.30
      basePrice + ethers.parseUnits("0.50", 6), // +$0.50
    ];

    for (let i = 0; i < askPrices.length; i++) {
      const askPrice = askPrices[i];
      const askAmount = liquidationAmountNeeded / BigInt(askPrices.length); // Split across levels

      console.log(
        `Adding ask: ${ethers.formatUnits(
          askAmount,
          18
        )} ALU @ $${ethers.formatUnits(askPrice, 6)}`
      );

      await orderBook.connect(user1).placeMarginLimitOrder(
        askPrice,
        askAmount,
        false // isBuy = false (sell order)
      );
    }
  } else if (isLong) {
    console.log(
      "🔴 Long position detected - Adding BID liquidity for liquidation SELL orders"
    );

    // For long liquidation, we need BUY orders (bids) that liquidation can sell against
    const basePrice = markPrice;
    const liquidationAmountNeeded = ethers.parseUnits(
      ethers.formatUnits(size, 18),
      18
    );

    // Add bids at various price levels (slightly below mark price)
    const bidPrices = [
      basePrice - ethers.parseUnits("0.10", 6), // -$0.10
      basePrice - ethers.parseUnits("0.20", 6), // -$0.20
      basePrice - ethers.parseUnits("0.30", 6), // -$0.30
      basePrice - ethers.parseUnits("0.50", 6), // -$0.50
    ];

    for (let i = 0; i < bidPrices.length; i++) {
      const bidPrice = bidPrices[i];
      const bidAmount = liquidationAmountNeeded / BigInt(bidPrices.length); // Split across levels

      console.log(
        `Adding bid: ${ethers.formatUnits(
          bidAmount,
          18
        )} ALU @ $${ethers.formatUnits(bidPrice, 6)}`
      );

      await orderBook.connect(user2).placeMarginLimitOrder(
        bidPrice,
        bidAmount,
        true // isBuy = true (buy order)
      );
    }
  }

  // Check order book depth
  console.log("\n📖 ORDER BOOK AFTER ADDING LIQUIDITY");
  console.log("-".repeat(30));
  const depth = await orderBook.getOrderBookDepth(5);
  console.log("Bids:");
  for (let i = 0; i < depth.bidPrices.length; i++) {
    console.log(
      `  $${ethers.formatUnits(depth.bidPrices[i], 6)} x ${ethers.formatUnits(
        depth.bidAmounts[i],
        18
      )}`
    );
  }
  console.log("Asks:");
  for (let i = 0; i < depth.askPrices.length; i++) {
    console.log(
      `  $${ethers.formatUnits(depth.askPrices[i], 6)} x ${ethers.formatUnits(
        depth.askAmounts[i],
        18
      )}`
    );
  }

  // Set up event listeners
  console.log("\n📡 SETTING UP EVENT LISTENERS");
  console.log("-".repeat(30));

  const events = [];

  // OrderBook liquidation events
  orderBook.on("LiquidationMarketOrderAttempt", (...args) => {
    events.push(`🎯 Market Order Attempt: ${args}`);
  });

  orderBook.on("LiquidationMarketOrderResult", (trader, success, reason) => {
    events.push(
      `📊 Market Order Result: ${success ? "SUCCESS" : "FAILED"} - ${reason}`
    );
  });

  // CoreVault liquidation events
  coreVault.on("LiquidationExecuted", (...args) => {
    events.push(`🔥 LiquidationExecuted: ${args}`);
  });

  coreVault.on("PositionUpdated", (...args) => {
    events.push(`📈 PositionUpdated: ${args}`);
  });

  coreVault.on(
    "LiquidationDebug_FunctionEntry",
    (user, marketId, liquidator, functionName) => {
      events.push(
        `🔍 DEBUG: ${functionName} called for ${user.slice(0, 8)}...`
      );
    }
  );

  // Trigger liquidation
  console.log("\n🚀 TRIGGERING LIQUIDATION WITH LIQUIDITY");
  console.log("-".repeat(30));

  const liquidationTx = await orderBook.triggerLiquidationScan();
  await liquidationTx.wait();

  // Wait for events
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n📋 LIQUIDATION EVENTS");
  console.log("-".repeat(30));
  events.forEach((event, i) => {
    console.log(`${i + 1}. ${event}`);
  });

  console.log("\n✅ Liquidation test completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
