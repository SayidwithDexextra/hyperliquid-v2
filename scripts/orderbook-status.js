#!/usr/bin/env node

// orderbook-status.js - Check Order Book Status
//
// 🎯 PURPOSE:
//   Check the current status of the order book and provide next steps
//
// 🚀 USAGE:
//   npx hardhat run scripts/orderbook-status.js --network localhost

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

async function checkOrderBookStatus() {
  console.log(colorText("\n📊 ORDER BOOK STATUS CHECK", colors.brightYellow));
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");

    // Check order book state
    console.log(colorText(`\n📊 CURRENT ORDER BOOK STATE:`, colors.brightCyan));

    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Best Bid: ${bestBid > 0n ? `$${formatPrice(bestBid)}` : "None"}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Best Ask: ${
          bestAsk < ethers.MaxUint256 ? `$${formatPrice(bestAsk)}` : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(`   Mark Price: $${formatPrice(markPrice)}`, colors.white)
    );

    // Get order book depth
    console.log(colorText(`\n📊 ORDER BOOK DEPTH:`, colors.brightCyan));

    try {
      const depth = await orderBook.getOrderBookDepth(20);

      console.log(colorText(`   Buy Orders (Top 15):`, colors.white));
      if (depth.buyOrders && depth.buyOrders.length > 0) {
        depth.buyOrders.slice(0, 15).forEach((order, i) => {
          console.log(
            colorText(
              `     ${i + 1}. $${formatPrice(order.price)} - ${formatAmount(
                order.amount
              )} ALU`,
              colors.white
            )
          );
        });
        console.log(
          colorText(
            `     ... and ${depth.buyOrders.length - 15} more buy orders`,
            colors.dim
          )
        );
      } else {
        console.log(colorText(`     No buy orders found`, colors.dim));
      }

      console.log(colorText(`   Sell Orders (Top 15):`, colors.white));
      if (depth.sellOrders && depth.sellOrders.length > 0) {
        depth.sellOrders.slice(0, 15).forEach((order, i) => {
          console.log(
            colorText(
              `     ${i + 1}. $${formatPrice(order.price)} - ${formatAmount(
                order.amount
              )} ALU`,
              colors.white
            )
          );
        });
        console.log(
          colorText(
            `     ... and ${depth.sellOrders.length - 15} more sell orders`,
            colors.dim
          )
        );
      } else {
        console.log(colorText(`     No sell orders found`, colors.dim));
      }
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Could not get order book depth: ${error.message}`,
          colors.red
        )
      );
    }

    // Check active orders count
    try {
      const [buyOrderCount, sellOrderCount] =
        await orderBook.getActiveOrdersCount();
      console.log(colorText(`\n📊 ORDER COUNTS:`, colors.brightCyan));
      console.log(
        colorText(`   Active Buy Orders: ${buyOrderCount}`, colors.white)
      );
      console.log(
        colorText(`   Active Sell Orders: ${sellOrderCount}`, colors.white)
      );
      console.log(
        colorText(
          `   Total Active Orders: ${buyOrderCount + sellOrderCount}`,
          colors.white
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Could not get order counts: ${error.message}`,
          colors.red
        )
      );
    }

    // Check if we can test liquidation
    console.log(
      colorText(`\n🎯 LIQUIDATION TESTING READINESS:`, colors.brightYellow)
    );

    if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
      console.log(colorText(`   ✅ Order book has liquidity`, colors.green));
      console.log(
        colorText(`   ✅ Ready for liquidation testing`, colors.green)
      );

      console.log(colorText(`\n🚀 NEXT STEPS:`, colors.brightCyan));
      console.log(
        colorText(
          `   1. Test liquidation with filled order book:`,
          colors.white
        )
      );
      console.log(
        colorText(
          `      npx hardhat run scripts/test-liquidation-with-filled-book.js --network localhost`,
          colors.dim
        )
      );
      console.log(
        colorText(`   2. View order book in real-time:`, colors.white)
      );
      console.log(
        colorText(
          `      npx hardhat run scripts/simple-orderbook-viewer.js --network localhost`,
          colors.dim
        )
      );
      console.log(
        colorText(`   3. Run complete liquidation test:`, colors.white)
      );
      console.log(
        colorText(
          `      npx hardhat run scripts/complete-liquidation-test.js --network localhost`,
          colors.dim
        )
      );
    } else {
      console.log(
        colorText(`   ❌ Order book is empty or incomplete`, colors.red)
      );
      console.log(
        colorText(`   🔧 Try filling the order book first:`, colors.yellow)
      );
      console.log(
        colorText(
          `      npx hardhat run scripts/fill-orderbook-non-margin.js --network localhost`,
          colors.dim
        )
      );
    }

    console.log(colorText(`\n📝 NOTES:`, colors.brightYellow));
    console.log(
      colorText(`   • Buy orders work with regular limit orders`, colors.white)
    );
    console.log(
      colorText(
        `   • Sell orders require margin orders for futures markets`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   • Current setup has buy liquidity from $1.00 to $4.50`,
        colors.white
      )
    );
    console.log(
      colorText(`   • Sell liquidity is limited to $5.00 level`, colors.white)
    );
    console.log(
      colorText(
        `   • This is sufficient for testing liquidation scenarios`,
        colors.white
      )
    );
  } catch (error) {
    console.log(
      colorText(
        "❌ Error checking order book status: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the status check
checkOrderBookStatus().catch(console.error);
