#!/usr/bin/env node

// debug-orderbook-depth.js - Debug Order Book Depth Function
//
// 🎯 PURPOSE:
//   Debug why getOrderBookDepth is returning empty arrays
//
// 🚀 USAGE:
//   npx hardhat run scripts/debug-orderbook-depth.js --network localhost

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

async function debugOrderBookDepth() {
  console.log(
    colorText("\n🔍 DEBUGGING ORDER BOOK DEPTH FUNCTION", colors.brightYellow)
  );
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Check basic order book state
    console.log(colorText(`\n📊 BASIC ORDER BOOK STATE:`, colors.brightCyan));

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

    // Check order counts
    const [buyOrderCount, sellOrderCount] =
      await orderBook.getActiveOrdersCount();
    console.log(
      colorText(`   Active Buy Orders: ${buyOrderCount}`, colors.white)
    );
    console.log(
      colorText(`   Active Sell Orders: ${sellOrderCount}`, colors.white)
    );

    // Test getOrderBookDepth function
    console.log(
      colorText(`\n📊 TESTING getOrderBookDepth FUNCTION:`, colors.brightCyan)
    );

    try {
      const depth = await orderBook.getOrderBookDepth(10);
      console.log(colorText(`   getOrderBookDepth returned:`, colors.white));
      console.log(
        colorText(
          `   - bidPrices length: ${
            depth.bidPrices ? depth.bidPrices.length : "undefined"
          }`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   - bidAmounts length: ${
            depth.bidAmounts ? depth.bidAmounts.length : "undefined"
          }`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   - askPrices length: ${
            depth.askPrices ? depth.askPrices.length : "undefined"
          }`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   - askAmounts length: ${
            depth.askAmounts ? depth.askAmounts.length : "undefined"
          }`,
          colors.white
        )
      );

      if (depth.bidPrices && depth.bidPrices.length > 0) {
        console.log(
          colorText(
            `   - First bid price: $${formatPrice(depth.bidPrices[0])}`,
            colors.green
          )
        );
      }
      if (depth.askPrices && depth.askPrices.length > 0) {
        console.log(
          colorText(
            `   - First ask price: $${formatPrice(depth.askPrices[0])}`,
            colors.green
          )
        );
      }
    } catch (error) {
      console.log(
        colorText(
          `   ❌ getOrderBookDepth failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Check if the function returns arrays or objects
    console.log(
      colorText(`\n📊 CHECKING FUNCTION RETURN TYPE:`, colors.brightCyan)
    );

    try {
      const depth = await orderBook.getOrderBookDepth(5);
      console.log(colorText(`   Return type: ${typeof depth}`, colors.white));
      console.log(
        colorText(`   Is array: ${Array.isArray(depth)}`, colors.white)
      );

      if (Array.isArray(depth)) {
        console.log(
          colorText(`   Array length: ${depth.length}`, colors.white)
        );
        depth.forEach((item, index) => {
          console.log(
            colorText(
              `   [${index}]: ${typeof item} (length: ${
                item ? item.length : "N/A"
              })`,
              colors.white
            )
          );
        });
      } else if (depth && typeof depth === "object") {
        console.log(
          colorText(
            `   Object keys: ${Object.keys(depth).join(", ")}`,
            colors.white
          )
        );
      }
    } catch (error) {
      console.log(
        colorText(`   ❌ Type check failed: ${error.message}`, colors.red)
      );
    }

    // Try to get individual orders
    console.log(
      colorText(`\n📊 CHECKING INDIVIDUAL ORDERS:`, colors.brightCyan)
    );

    try {
      // Get user orders to see if we can access individual orders
      const signers = await ethers.getSigners();
      const userAddress = signers[0].address;
      const userOrders = await orderBook.getUserOrders(userAddress);

      console.log(
        colorText(
          `   User ${userAddress.substring(0, 8)}... has ${
            userOrders.length
          } orders`,
          colors.white
        )
      );

      if (userOrders.length > 0) {
        const firstOrderId = userOrders[0];
        const order = await orderBook.getOrder(firstOrderId);

        console.log(colorText(`   First order details:`, colors.white));
        console.log(colorText(`   - Order ID: ${firstOrderId}`, colors.white));
        console.log(
          colorText(`   - Price: $${formatPrice(order.price)}`, colors.white)
        );
        console.log(
          colorText(`   - Amount: ${formatAmount(order.amount)}`, colors.white)
        );
        console.log(colorText(`   - Is Buy: ${order.isBuy}`, colors.white));
        console.log(
          colorText(`   - Is Margin: ${order.isMarginOrder}`, colors.white)
        );
      }
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Individual order check failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Check if there's a different function to get order book data
    console.log(
      colorText(`\n📊 CHECKING ALTERNATIVE FUNCTIONS:`, colors.brightCyan)
    );

    try {
      // Check if there are other functions that might work
      const contractInterface = orderBook.interface;
      const functions = contractInterface.fragments.filter(
        (f) => f.type === "function"
      );

      console.log(
        colorText(`   Available functions related to order book:`, colors.white)
      );

      const orderBookFunctions = functions.filter(
        (f) =>
          f.name.toLowerCase().includes("order") ||
          f.name.toLowerCase().includes("book") ||
          f.name.toLowerCase().includes("depth") ||
          f.name.toLowerCase().includes("level")
      );

      orderBookFunctions.forEach((func) => {
        console.log(colorText(`   - ${func.name}`, colors.white));
      });
    } catch (error) {
      console.log(
        colorText(`   ❌ Function listing failed: ${error.message}`, colors.red)
      );
    }
  } catch (error) {
    console.log(
      colorText(
        "❌ Error debugging order book depth: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the debug script
debugOrderBookDepth().catch(console.error);
