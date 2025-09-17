#!/usr/bin/env node

/**
 * Debug Trade Execution Script
 *
 * This script monitors the _executeTrade function in real-time by listening
 * to all the debug events we added. It will show you exactly where the
 * function breaks or gets stuck.
 *
 * Usage:
 *   node scripts/debug-trade-execution.js
 *
 * Then execute trades in another terminal and watch the debug output here.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { getContract, getAddress, MARKET_INFO } = require("../config/contracts");

// ANSI color codes for better readability
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function colorLog(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  console.log("\n🔍 TRADE EXECUTION DEBUGGER");
  console.log("═".repeat(60));
  colorLog(
    "cyan",
    "📡 Starting real-time monitoring of _executeTrade function..."
  );

  // Load contracts using the same method as interactive-trader.js
  colorLog("yellow", "🔧 Loading smart contracts...");

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const orderBookAddress = await orderBook.getAddress();

    colorLog("green", `✅ Connected to OrderBook at: ${orderBookAddress}`);
    colorLog("yellow", "🎯 Listening for trade execution events...\n");

    // Track active trades
    const activeTrades = new Map();

    // Event listeners for debugging _executeTrade
    orderBook.on(
      "TradeExecutionStarted",
      (buyer, seller, price, amount, buyerMargin, sellerMargin, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const timestamp = new Date().toISOString();

        activeTrades.set(tradeKey, {
          buyer,
          seller,
          price: ethers.formatUnits(price, 6), // USDC has 6 decimals
          amount: ethers.formatEther(amount),
          buyerMargin,
          sellerMargin,
          startTime: Date.now(),
          steps: ["started"],
        });

        colorLog("bright", `\n🚀 [${timestamp}] TRADE EXECUTION STARTED`);
        colorLog("white", `   Buyer: ${buyer}`);
        colorLog("white", `   Seller: ${seller}`);
        colorLog("white", `   Price: $${ethers.formatUnits(price, 6)} USDC`);
        colorLog("white", `   Amount: ${ethers.formatEther(amount)} ALU`);
        colorLog("white", `   Buyer Margin: ${buyerMargin}`);
        colorLog("white", `   Seller Margin: ${sellerMargin}`);
        colorLog("white", `   Tx Hash: ${event.transactionHash}`);
      }
    );

    orderBook.on(
      "TradeValueCalculated",
      (tradeValue, buyerFee, sellerFee, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("value_calculated");
          colorLog(
            "green",
            `   ✅ Trade value calculated: $${ethers.formatUnits(
              tradeValue,
              6
            )} USDC`
          );
          colorLog(
            "green",
            `   💰 Buyer fee: $${ethers.formatUnits(buyerFee, 6)} USDC`
          );
          colorLog(
            "green",
            `   💰 Seller fee: $${ethers.formatUnits(sellerFee, 6)} USDC`
          );
        }
      }
    );

    orderBook.on("TradeRecorded", (tradeId, event) => {
      const tradeKey = `${event.transactionHash}-${event.logIndex}`;
      const trade = activeTrades.get(tradeKey);
      if (trade) {
        trade.steps.push("recorded");
        trade.tradeId = tradeId.toString();
        colorLog("green", `   ✅ Trade recorded with ID: ${tradeId}`);
      }
    });

    orderBook.on("OrderMatched", (buyer, seller, price, amount, event) => {
      const tradeKey = `${event.transactionHash}-${event.logIndex}`;
      const trade = activeTrades.get(tradeKey);
      if (trade) {
        trade.steps.push("order_matched");
        colorLog("blue", `   🎯 Order matched in matching engine:`);
        colorLog("blue", `      Buyer: ${buyer}`);
        colorLog("blue", `      Seller: ${seller}`);
        colorLog("blue", `      Price: $${ethers.formatUnits(price, 6)} USDC`);
        colorLog("blue", `      Amount: ${ethers.formatEther(amount)} ALU`);
      }
    });

    orderBook.on(
      "PositionsRetrieved",
      (buyer, oldBuyerPosition, seller, oldSellerPosition, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("positions_retrieved");
          colorLog("blue", `   📊 Positions retrieved:`);
          colorLog(
            "blue",
            `      Buyer old position: ${ethers.formatEther(
              oldBuyerPosition
            )} ALU`
          );
          colorLog(
            "blue",
            `      Seller old position: ${ethers.formatEther(
              oldSellerPosition
            )} ALU`
          );
        }
      }
    );

    orderBook.on(
      "PositionsCalculated",
      (newBuyerPosition, newSellerPosition, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("positions_calculated");
          colorLog("blue", `   🧮 New positions calculated:`);
          colorLog(
            "blue",
            `      Buyer new position: ${ethers.formatEther(
              newBuyerPosition
            )} ALU`
          );
          colorLog(
            "blue",
            `      Seller new position: ${ethers.formatEther(
              newSellerPosition
            )} ALU`
          );
        }
      }
    );

    orderBook.on(
      "ActiveTradersUpdated",
      (buyer, buyerActive, seller, sellerActive, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("active_traders_updated");
          colorLog("cyan", `   👥 Active traders updated:`);
          colorLog("cyan", `      Buyer active: ${buyerActive}`);
          colorLog("cyan", `      Seller active: ${sellerActive}`);
        }
      }
    );

    orderBook.on(
      "MarginValidationPassed",
      (buyerMargin, sellerMargin, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("margin_validation_passed");
          colorLog(
            "green",
            `   ✅ Margin validation passed (buyer: ${buyerMargin}, seller: ${sellerMargin})`
          );
        }
      }
    );

    orderBook.on(
      "LiquidationTradeDetected",
      (
        isLiquidationTrade,
        liquidationTarget,
        liquidationClosesShort,
        event
      ) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("liquidation_detected");
          if (isLiquidationTrade) {
            colorLog("magenta", `   🔥 LIQUIDATION TRADE DETECTED!`);
            colorLog("magenta", `      Target: ${liquidationTarget}`);
            colorLog(
              "magenta",
              `      Closes short: ${liquidationClosesShort}`
            );
          } else {
            colorLog("green", `   ✅ Regular trade (not liquidation)`);
          }
        }
      }
    );

    orderBook.on("MarginUpdatesStarted", (isLiquidationTrade, event) => {
      const tradeKey = `${event.transactionHash}-${event.logIndex}`;
      const trade = activeTrades.get(tradeKey);
      if (trade) {
        trade.steps.push("margin_updates_started");
        colorLog(
          "yellow",
          `   🔄 Margin updates started (liquidation: ${isLiquidationTrade})`
        );
      }
    });

    orderBook.on("MarginUpdatesCompleted", (event) => {
      const tradeKey = `${event.transactionHash}-${event.logIndex}`;
      const trade = activeTrades.get(tradeKey);
      if (trade) {
        trade.steps.push("margin_updates_completed");
        colorLog("green", `   ✅ Margin updates completed`);
      }
    });

    orderBook.on(
      "FeesDeducted",
      (buyer, buyerFee, seller, sellerFee, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("fees_deducted");
          colorLog("yellow", `   💸 Fees deducted:`);
          colorLog(
            "yellow",
            `      Buyer: $${ethers.formatUnits(buyerFee, 6)} USDC`
          );
          colorLog(
            "yellow",
            `      Seller: $${ethers.formatUnits(sellerFee, 6)} USDC`
          );
        }
      }
    );

    orderBook.on("PriceUpdated", (lastTradePrice, currentMarkPrice, event) => {
      const tradeKey = `${event.transactionHash}-${event.logIndex}`;
      const trade = activeTrades.get(tradeKey);
      if (trade) {
        trade.steps.push("price_updated");
        colorLog("blue", `   📈 Price updated:`);
        colorLog(
          "blue",
          `      Last trade: $${ethers.formatUnits(lastTradePrice, 6)} USDC`
        );
        colorLog(
          "blue",
          `      Mark price: $${ethers.formatUnits(currentMarkPrice, 6)} USDC`
        );
      }
    });

    orderBook.on(
      "LiquidationCheckTriggered",
      (currentMark, lastMarkPrice, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("liquidation_check_triggered");
          colorLog("magenta", `   🔍 Liquidation check triggered:`);
          colorLog(
            "magenta",
            `      Current mark: $${ethers.formatUnits(currentMark, 6)} USDC`
          );
          colorLog(
            "magenta",
            `      Last mark: $${ethers.formatUnits(lastMarkPrice, 6)} USDC`
          );
        }
      }
    );

    orderBook.on(
      "TradeExecutionCompleted",
      (buyer, seller, price, amount, event) => {
        const tradeKey = `${event.transactionHash}-${event.logIndex}`;
        const trade = activeTrades.get(tradeKey);
        if (trade) {
          trade.steps.push("completed");
          const duration = Date.now() - trade.startTime;

          colorLog(
            "bright",
            `   🎉 TRADE EXECUTION COMPLETED! (${duration}ms)`
          );
          colorLog(
            "green",
            `   📋 Execution steps: ${trade.steps.join(" → ")}`
          );

          // Clean up completed trade
          activeTrades.delete(tradeKey);
        }
      }
    );

    // Note: Removed generic error listener as it's not a contract event

    // Monitor for stuck trades (trades that start but don't complete)
    setInterval(() => {
      const now = Date.now();
      for (const [tradeKey, trade] of activeTrades.entries()) {
        const duration = now - trade.startTime;
        if (duration > 30000) {
          // 30 seconds timeout
          colorLog("red", `⚠️  STUCK TRADE DETECTED!`);
          colorLog("red", `   Trade Key: ${tradeKey}`);
          colorLog("red", `   Duration: ${duration}ms`);
          colorLog(
            "red",
            `   Last step: ${trade.steps[trade.steps.length - 1]}`
          );
          colorLog("red", `   Steps completed: ${trade.steps.join(" → ")}`);

          // Remove stuck trade
          activeTrades.delete(tradeKey);
        }
      }
    }, 10000); // Check every 10 seconds

    colorLog(
      "green",
      "🎯 Debug monitor is running. Execute trades to see debug output."
    );
    colorLog("yellow", "   Press Ctrl+C to stop monitoring.\n");

    // Keep the script running
    process.on("SIGINT", () => {
      colorLog("yellow", "\n👋 Stopping trade execution debugger...");
      process.exit(0);
    });
  } catch (error) {
    colorLog("red", "❌ Failed to load contracts: " + error.message);
    console.log(colorLog("dim", "🔍 Debug info:"));
    console.log(colorLog("dim", `   Error: ${error.stack || error.message}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Debug script error:", error);
  process.exit(1);
});
