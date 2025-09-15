#!/usr/bin/env node

// test-trade-js.js - Test trade.js Order Book Display
//
// 🎯 PURPOSE:
//   Test the trade.js order book display functionality
//
// 🚀 USAGE:
//   npx hardhat run scripts/test-trade-js.js --network localhost

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(2);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(2);
}

async function testTradeJs() {
  console.log(
    colorText("\n🧪 TESTING TRADE.JS ORDER BOOK DISPLAY", colors.brightYellow)
  );
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Test getOrderBookDepth directly
    console.log(
      colorText(`\n📊 TESTING getOrderBookDepth DIRECTLY:`, colors.brightCyan)
    );

    const depth = await orderBook.getOrderBookDepth(5);
    console.log(colorText(`   Raw result type: ${typeof depth}`, colors.white));
    console.log(
      colorText(`   Is array: ${Array.isArray(depth)}`, colors.white)
    );
    console.log(colorText(`   Length: ${depth.length}`, colors.white));

    if (Array.isArray(depth) && depth.length >= 4) {
      const [bidPrices, bidAmounts, askPrices, askAmounts] = depth;

      console.log(
        colorText(`   bidPrices: ${bidPrices.length} items`, colors.white)
      );
      console.log(
        colorText(`   bidAmounts: ${bidAmounts.length} items`, colors.white)
      );
      console.log(
        colorText(`   askPrices: ${askPrices.length} items`, colors.white)
      );
      console.log(
        colorText(`   askAmounts: ${askAmounts.length} items`, colors.white)
      );

      if (bidPrices.length > 0) {
        console.log(
          colorText(
            `   First bid price: $${formatPrice(bidPrices[0])}`,
            colors.green
          )
        );
        console.log(
          colorText(
            `   First bid amount: ${formatAmount(bidAmounts[0])}`,
            colors.green
          )
        );
      }

      if (askPrices.length > 0) {
        console.log(
          colorText(
            `   First ask price: $${formatPrice(askPrices[0])}`,
            colors.red
          )
        );
        console.log(
          colorText(
            `   First ask amount: ${formatAmount(askAmounts[0])}`,
            colors.red
          )
        );
      }
    }

    // Test the enhanced order book depth function
    console.log(
      colorText(`\n📊 TESTING ENHANCED ORDER BOOK DEPTH:`, colors.brightCyan)
    );

    // Simulate the getEnhancedOrderBookDepth function
    const [bidPrices, bidAmounts, askPrices, askAmounts] = depth;
    const bids = [];
    const asks = [];

    // Get detailed bid information
    for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
      const price = bidPrices[i];
      const totalAmount = bidAmounts[i];

      // Get the first order at this price level to show as representative trader
      try {
        const buyLevel = await orderBook.buyLevels(price);
        if (buyLevel.exists && buyLevel.firstOrderId > 0) {
          const firstOrder = await orderBook.getOrder(buyLevel.firstOrderId);
          bids.push({
            price: price,
            amount: totalAmount,
            trader: firstOrder.trader,
            orderId: buyLevel.firstOrderId,
          });
        }
      } catch (error) {
        // Fallback if we can't get order details
        bids.push({
          price: price,
          amount: totalAmount,
          trader: ethers.ZeroAddress,
          orderId: 0,
        });
      }
    }

    // Get detailed ask information
    for (let i = 0; i < askPrices.length && askPrices[i] > 0; i++) {
      const price = askPrices[i];
      const totalAmount = askAmounts[i];

      // Get the first order at this price level to show as representative trader
      try {
        const sellLevel = await orderBook.sellLevels(price);
        if (sellLevel.exists && sellLevel.firstOrderId > 0) {
          const firstOrder = await orderBook.getOrder(sellLevel.firstOrderId);
          asks.push({
            price: price,
            amount: totalAmount,
            trader: firstOrder.trader,
            orderId: sellLevel.firstOrderId,
          });
        }
      } catch (error) {
        // Fallback if we can't get order details
        asks.push({
          price: price,
          amount: totalAmount,
          trader: ethers.ZeroAddress,
          orderId: 0,
        });
      }
    }

    const enhancedBookData = { bids, asks };

    console.log(colorText(`   Enhanced book data:`, colors.white));
    console.log(
      colorText(
        `   - bids.length: ${enhancedBookData.bids.length}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   - asks.length: ${enhancedBookData.asks.length}`,
        colors.white
      )
    );

    if (enhancedBookData.bids.length > 0) {
      const firstBid = enhancedBookData.bids[0];
      console.log(
        colorText(
          `   - First bid: $${formatPrice(firstBid.price)} ${formatAmount(
            firstBid.amount
          )}`,
          colors.green
        )
      );
    }

    if (enhancedBookData.asks.length > 0) {
      const firstAsk = enhancedBookData.asks[0];
      console.log(
        colorText(
          `   - First ask: $${formatPrice(firstAsk.price)} ${formatAmount(
            firstAsk.amount
          )}`,
          colors.red
        )
      );
    }

    // Test the display logic
    console.log(colorText(`\n📊 TESTING DISPLAY LOGIC:`, colors.brightCyan));

    const maxRows = Math.max(
      enhancedBookData.bids.length,
      enhancedBookData.asks.length,
      3
    );

    console.log(colorText(`   Max rows to display: ${maxRows}`, colors.white));

    for (let i = 0; i < Math.min(maxRows, 5); i++) {
      let bidInfo = "                              ";
      let askInfo = "                              ";

      if (i < enhancedBookData.bids.length) {
        const bid = enhancedBookData.bids[i];
        const price = Number(ethers.formatUnits(bid.price, 6)).toFixed(4);
        const amount = Number(ethers.formatUnits(bid.amount, 18)).toFixed(4);
        const user = bid.trader.substring(2, 6).toUpperCase();
        bidInfo = `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(
          8
        )}`;
      }

      if (i < enhancedBookData.asks.length) {
        const ask = enhancedBookData.asks[i];
        const price = Number(ethers.formatUnits(ask.price, 6)).toFixed(4);
        const amount = Number(ethers.formatUnits(ask.amount, 18)).toFixed(4);
        const user = ask.trader.substring(2, 6).toUpperCase();
        askInfo = `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(
          8
        )}`;
      }

      console.log(
        colorText(`   Row ${i}: ${bidInfo} | ${askInfo}`, colors.white)
      );
    }
  } catch (error) {
    console.log(
      colorText("❌ Error testing trade.js: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the test
testTradeJs().catch(console.error);
