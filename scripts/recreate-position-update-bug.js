#!/usr/bin/env node

/**
 * 🐛 RECREATE POSITION UPDATE BUG
 *
 * This script recreates the exact scenario where:
 * 1. Deployer has a 30 ALU long position at $3
 * 2. User1 places a 50 ALU buy order at $2
 * 3. Deployer sells 50 ALU (should close 30 long, open 20 short)
 * 4. Trade executes but position doesn't update correctly
 */

const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(colorText("\n🐛 RECREATING POSITION UPDATE BUG", colors.bright));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");
    const [deployer, user1, user2] = await ethers.getSigners();

    // Step 1: Create deployer's initial position (30 ALU long at $3)
    console.log(
      colorText(
        "\n📊 STEP 1: Creating Deployer's Initial Position",
        colors.yellow
      )
    );
    console.log("Need to buy 30 ALU at $3 to establish long position...");

    // User2 places a sell order at $3
    console.log("\n  User2 placing sell order: 30 ALU @ $3");
    const sellTx = await orderBook.connect(user2).placeMarginLimitOrder(
      ethers.parseUnits("3", 6), // price
      ethers.parseUnits("30", 18), // amount
      false // sell
    );
    await sellTx.wait();
    console.log(colorText("  ✅ Sell order placed", colors.green));

    // Deployer buys at market (using margin order to create position)
    console.log("\n  Deployer buying 30 ALU at market");
    const buyTx = await orderBook.connect(deployer).placeMarginMarketOrder(
      ethers.parseUnits("30", 18), // amount
      true // buy
    );
    await buyTx.wait();
    console.log(colorText("  ✅ Market buy executed", colors.green));

    // Verify position
    const deployerPositions = await vault.getUserPositions(deployer.address);
    if (deployerPositions.length > 0) {
      const pos = deployerPositions[0];
      console.log(colorText("\n  ✅ Deployer position created:", colors.green));
      console.log(`     Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(`     Entry: $${ethers.formatUnits(pos.entryPrice, 6)}`);
      console.log(`     Margin: $${ethers.formatUnits(pos.marginLocked, 6)}`);
    }

    await sleep(1000);

    // Step 2: User1 places buy order
    console.log(
      colorText("\n📋 STEP 2: User1 Places Buy Order", colors.yellow)
    );
    console.log("User1 placing buy order: 50 ALU @ $2");

    const user1BuyTx = await orderBook.connect(user1).placeMarginLimitOrder(
      ethers.parseUnits("2", 6), // price
      ethers.parseUnits("50", 18), // amount
      true // buy
    );
    await user1BuyTx.wait();
    console.log(colorText("  ✅ Buy order placed", colors.green));

    // Check order book
    const [bestBid, bestAsk] = await orderBook.getBestPrices();
    console.log(`\n  Order Book State:`);
    console.log(`    Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
    console.log(
      `    Best Ask: ${
        bestAsk < ethers.MaxUint256
          ? "$" + ethers.formatUnits(bestAsk, 6)
          : "None"
      }`
    );

    await sleep(1000);

    // Step 3: Deployer sells 50 ALU
    console.log(
      colorText(
        "\n🔄 STEP 3: Deployer Sells 50 ALU (THE BUG TRIGGER)",
        colors.yellow
      )
    );
    console.log("Expected behavior:");
    console.log("  - Close 30 ALU long position");
    console.log("  - Open 20 ALU short position");
    console.log("  - Realize $30 loss on closing long");

    console.log("\nExecuting market sell...");

    // Capture state before
    const beforePositions = await vault.getUserPositions(deployer.address);
    const beforePos = beforePositions[0];
    console.log(`\nBefore Trade:`);
    console.log(`  Position: ${ethers.formatUnits(beforePos.size, 18)} ALU`);

    // Execute the sell (using margin order to update position)
    const sellMarketTx = await orderBook
      .connect(deployer)
      .placeMarginMarketOrder(
        ethers.parseUnits("50", 18), // amount
        false // sell
      );
    const receipt = await sellMarketTx.wait();
    console.log(colorText("  ✅ Market sell executed", colors.green));

    // Check trade events
    console.log("\n📜 Trade Events:");
    let tradeAmount = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = orderBook.interface.parseLog(log);
        if (parsed.name === "TradeExecuted") {
          tradeAmount = parsed.args.amount;
          console.log(
            `  Trade Executed: ${ethers.formatUnits(
              tradeAmount,
              18
            )} ALU @ $${ethers.formatUnits(parsed.args.price, 6)}`
          );
        }
      } catch (e) {}
    }

    await sleep(1000);

    // Step 4: Check final state
    console.log(colorText("\n🔍 STEP 4: Checking Final State", colors.yellow));

    // Check deployer's position
    const afterPositions = await vault.getUserPositions(deployer.address);
    if (afterPositions.length > 0) {
      const pos = afterPositions[0];
      const size = BigInt(pos.size.toString());
      const isLong = size > 0n;
      const absSize = size < 0n ? -size : size;

      console.log(colorText("\nDeployer's Position After Trade:", colors.cyan));
      console.log(
        `  Type: ${
          isLong
            ? colorText("LONG", colors.green)
            : colorText("SHORT", colors.red)
        }`
      );
      console.log(
        `  Size: ${isLong ? "+" : "-"}${ethers.formatUnits(absSize, 18)} ALU`
      );
      console.log(`  Entry: $${ethers.formatUnits(pos.entryPrice, 6)}`);
      console.log(`  Margin: $${ethers.formatUnits(pos.marginLocked, 6)}`);

      // Check if this is the bug
      if (isLong && absSize === ethers.parseUnits("30", 18)) {
        console.log(colorText("\n❌ BUG CONFIRMED!", colors.red));
        console.log("  Position didn't update despite 50 ALU trade execution!");
        console.log("  Expected: -20 ALU SHORT");
        console.log("  Actual: +30 ALU LONG (unchanged)");
      } else if (!isLong && absSize === ethers.parseUnits("20", 18)) {
        console.log(
          colorText("\n✅ Position updated correctly!", colors.green)
        );
        console.log("  Position flipped from long to short as expected");
      }
    } else {
      console.log(colorText("\n⚠️ No position found!", colors.yellow));
    }

    // Check User1's position
    console.log(colorText("\nUser1's Position:", colors.cyan));
    const user1Positions = await vault.getUserPositions(user1.address);
    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      console.log(`  Size: +${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(`  Entry: $${ethers.formatUnits(pos.entryPrice, 6)}`);
    }

    // Check last trade
    const totalTrades = await orderBook.totalTradeCount();
    const lastTrade = await orderBook.trades(Number(totalTrades) - 1);
    console.log(colorText("\nLast Trade Details:", colors.cyan));
    console.log(`  Amount: ${ethers.formatUnits(lastTrade.amount, 18)} ALU`);
    console.log(
      `  Buyer: ${
        lastTrade.buyer === user1.address ? "User1" : lastTrade.buyer
      }`
    );
    console.log(
      `  Seller: ${
        lastTrade.seller === deployer.address ? "Deployer" : lastTrade.seller
      }`
    );

    // Summary
    console.log(colorText("\n📊 SUMMARY", colors.bright));
    console.log("═".repeat(80));
    console.log(`Trade Amount: ${ethers.formatUnits(tradeAmount, 18)} ALU`);
    console.log(
      `Position Update: ${
        afterPositions[0]?.size === beforePositions[0]?.size
          ? "FAILED ❌"
          : "SUCCESS ✅"
      }`
    );
  } catch (error) {
    console.error(colorText("\n❌ Error:", colors.red), error.message);
    console.error(error.stack);
  }
}

main()
  .then(() => {
    console.log(colorText("\n✅ Bug recreation complete!", colors.green));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
