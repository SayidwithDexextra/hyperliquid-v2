#!/usr/bin/env node

// check-order-book.js - Check order book state and liquidity

const { ethers } = require("ethers");

async function main() {
  console.log("📊 ORDER BOOK LIQUIDITY CHECK");
  console.log("=".repeat(40));

  // Connect directly to localhost
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

  // Load contract artifacts
  const orderBookArtifact = require("./artifacts/src/OrderBook.sol/OrderBook.json");
  const orderBook = new ethers.Contract(
    "0xF8A8B047683062B5BBbbe9D104C9177d6b6cC086",
    orderBookArtifact.abi,
    provider
  );

  try {
    console.log(`OrderBook: ${await orderBook.getAddress()}`);

    // Check best bid and ask
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    console.log(`\n💰 Current Order Book:`);
    console.log(
      `Best Bid: $${
        bestBid > 0 ? ethers.formatUnits(bestBid, 6) : "0 (no bids)"
      }`
    );
    console.log(
      `Best Ask: $${
        bestAsk < ethers.MaxUint256
          ? ethers.formatUnits(bestAsk, 6)
          : "∞ (no asks)"
      }`
    );

    // Check if there's any liquidity
    if (bestBid == 0 && bestAsk == ethers.MaxUint256) {
      console.log("❌ No liquidity in the order book!");
      console.log("   This explains why market orders don't execute.");
    } else if (bestAsk == ethers.MaxUint256) {
      console.log("❌ No ASK orders (sell orders) in the book!");
      console.log("   Market BUY orders cannot execute without ASK liquidity.");
    } else if (bestBid == 0) {
      console.log("❌ No BID orders (buy orders) in the book!");
      console.log(
        "   Market SELL orders cannot execute without BID liquidity."
      );
    } else {
      console.log("✅ Order book has liquidity on both sides!");
    }

    // Let's check some price levels
    console.log(`\n🔍 Checking specific price levels:`);

    // Check price levels that should have liquidity from deployment
    const pricesToCheck = [
      ethers.parseUnits("1.0", 6), // $1.00
      ethers.parseUnits("2.5", 6), // $2.50
      ethers.parseUnits("1.5", 6), // $1.50
    ];

    for (const price of pricesToCheck) {
      try {
        // Check buy levels (should be empty after the deployment trade)
        const buyLevel = await orderBook.buyLevels(price);
        console.log(
          `$${ethers.formatUnits(price, 6)} BUY: ${
            buyLevel.exists
              ? `${ethers.formatUnits(buyLevel.totalAmount, 18)} ALU`
              : "empty"
          }`
        );

        // Check sell levels
        const sellLevel = await orderBook.sellLevels(price);
        console.log(
          `$${ethers.formatUnits(price, 6)} ASK: ${
            sellLevel.exists
              ? `${ethers.formatUnits(sellLevel.totalAmount, 18)} ALU`
              : "empty"
          }`
        );
      } catch (error) {
        console.log(`$${ethers.formatUnits(price, 6)}: Error checking level`);
      }
    }

    // Check total trade count
    const totalTrades = await orderBook.totalTradeCount();
    console.log(`\n📈 Total trades executed: ${totalTrades}`);

    if (totalTrades == 0) {
      console.log("❌ No trades have been executed yet!");
    }

    // Get recent trade info if any
    if (totalTrades > 0) {
      console.log(`\n📊 Recent trades:`);
      for (let i = 1; i <= Math.min(totalTrades, 3); i++) {
        try {
          const trade = await orderBook.trades(i);
          console.log(`Trade ${i}:`);
          console.log(`  Buyer: ${trade.buyer}`);
          console.log(`  Seller: ${trade.seller}`);
          console.log(`  Amount: ${ethers.formatUnits(trade.amount, 18)} ALU`);
          console.log(`  Price: $${ethers.formatUnits(trade.price, 6)}`);
        } catch (error) {
          console.log(`Trade ${i}: Error retrieving`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error checking order book:", error.message);
  }

  console.log("\n🏁 ORDER BOOK CHECK COMPLETED!");
  process.exit(0);
}

main().catch((error) => {
  console.error("💥 Check failed:", error);
  process.exit(1);
});
