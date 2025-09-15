#!/usr/bin/env node

// show-orderbook-simple.js - Simple order book viewer using Hardhat
//
// This script shows the order book using the proper Hardhat network configuration

const { ethers } = require("hardhat");

async function showOrderBook() {
  console.log("📊 Order Book Viewer - ALU/USDC");
  console.log("═".repeat(60));

  try {
    // Get the OrderBook contract using Hardhat
    const orderBookAddress = "0x75537828f2ce51be7289709686A69CbFDbB714F1";
    const orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);

    console.log("✅ OrderBook contract loaded");
    console.log(`📍 Address: ${orderBookAddress}`);

    // Get market data
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();
    const lastTradePrice = await orderBook.lastTradePrice();

    console.log("\n📊 Market Information:");
    console.log("─".repeat(40));
    console.log(`Active Orders: ${buyCount} buys, ${sellCount} sells`);
    console.log(`Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
    console.log(`Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);
    console.log(`Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
    console.log(`Last Trade: $${ethers.formatUnits(lastTradePrice, 6)}`);

    // Get order book depth
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await orderBook.getOrderBookDepth(5);

    console.log("\n📋 Order Book Depth:");
    console.log("─".repeat(40));

    console.log("BIDS (Buy Orders):");
    for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
      const price = ethers.formatUnits(bidPrices[i], 6);
      const amount = ethers.formatUnits(bidAmounts[i], 18);
      console.log(`  $${price} × ${amount} ALU`);
    }

    console.log("\nASKS (Sell Orders):");
    for (let i = 0; i < askPrices.length && askPrices[i] > 0; i++) {
      const price = ethers.formatUnits(askPrices[i], 6);
      const amount = ethers.formatUnits(askAmounts[i], 18);
      console.log(`  $${price} × ${amount} ALU`);
    }

    // Get user orders
    const signers = await ethers.getSigners();
    const userAddress = signers[0].address;
    const userOrders = await orderBook.getUserOrders(userAddress);

    console.log(`\n👤 Your Orders (${userAddress}):`);
    console.log("─".repeat(40));

    if (userOrders.length === 0) {
      console.log("No active orders found");
    } else {
      for (const orderId of userOrders) {
        const order = await orderBook.getOrder(orderId);
        const price = ethers.formatUnits(order.price, 6);
        const amount = ethers.formatUnits(order.amount, 18);
        const side = order.isBuy ? "BUY" : "SELL";
        const type = order.isMarginOrder ? "MARGIN" : "SPOT";

        console.log(
          `  Order ${orderId}: ${side} ${amount} ALU @ $${price} (${type})`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// Run the script
showOrderBook().catch(console.error);
