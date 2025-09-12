// simple-orderbook-viewer.js - Simplified orderbook viewer using existing functions
const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("../config");

// ANSI Color Codes for beautiful output
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
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(
    colorText("🔥 HYPERLIQUID SIMPLE ORDERBOOK VIEWER 🔥", colors.magenta)
  );
  console.log("═".repeat(60));

  try {
    // Get contracts from config
    const router = await getContract("TRADING_ROUTER");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const marketId = MARKET_INFO.ALUMINUM.marketId;

    console.log("📋 Connection Status:");
    console.log("  TradingRouter:", router.address);
    console.log("  Aluminum OrderBook:", orderBook.address);
    console.log("  Market ID:", marketId);

    // Test basic contract connectivity
    console.log("\n🔍 Testing Contract Functions:");

    try {
      const bestBid = await orderBook.bestBid();
      const bestAsk = await orderBook.bestAsk();
      console.log(
        "  ✅ Best Bid:",
        ethers.utils.formatUnits(bestBid, 6),
        "USDC"
      );
      console.log(
        "  ✅ Best Ask:",
        ethers.utils.formatUnits(bestAsk, 6),
        "USDC"
      );
    } catch (error) {
      console.log("  ❌ Could not get best prices:", error.message);
    }

    try {
      const nextOrderId = await orderBook.nextOrderId();
      console.log("  ✅ Next Order ID:", nextOrderId.toString());
    } catch (error) {
      console.log("  ❌ Could not get next order ID:", error.message);
    }

    // Try to get orderbook depth using existing function
    try {
      console.log("\n📊 Order Book Depth:");
      const depth = await orderBook.getOrderBookDepth(10);
      const [bidPrices, bidAmounts, askPrices, askAmounts] = depth;

      console.log("  📈 BUY ORDERS (Bids):");
      for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
        const price = ethers.utils.formatUnits(bidPrices[i], 6);
        const amount = ethers.utils.formatUnits(bidAmounts[i], 18);
        console.log(colorText(`    $${price} × ${amount} ALU`, colors.green));
      }

      console.log("  📉 SELL ORDERS (Asks):");
      for (let i = 0; i < askPrices.length && askPrices[i] > 0; i++) {
        const price = ethers.utils.formatUnits(askPrices[i], 6);
        const amount = ethers.utils.formatUnits(askAmounts[i], 18);
        console.log(colorText(`    $${price} × ${amount} ALU`, colors.red));
      }
    } catch (depthError) {
      console.log("  ❌ Order book depth failed:", depthError.message);

      // Fallback: try to get individual orders
      console.log("\n🔄 Fallback: Checking individual user orders...");
      const [deployer, user1, user2, user3] = await ethers.getSigners();
      const users = [deployer, user1, user2, user3];

      for (let i = 0; i < users.length; i++) {
        try {
          const userOrderIds = await orderBook.getUserOrders(users[i].address);
          if (userOrderIds.length > 0) {
            console.log(`  👤 User ${i} has ${userOrderIds.length} orders`);

            for (const orderId of userOrderIds.slice(0, 3)) {
              // Show first 3 orders
              try {
                const order = await orderBook.getOrder(orderId);
                const price = ethers.utils.formatUnits(order.priceTick, 6);
                const amount = ethers.utils.formatUnits(order.amount, 18);
                const side = order.side === 0 ? "BUY" : "SELL";
                const sideColor = order.side === 0 ? colors.green : colors.red;

                console.log(
                  colorText(`    ${side} $${price} × ${amount} ALU`, sideColor)
                );
              } catch (orderError) {
                console.log(`    ⚠️  Could not get order ${orderId}`);
              }
            }
          }
        } catch (userError) {
          // Skip users with no orders
        }
      }
    }

    // Show market summary
    console.log("\n📊 MARKET SUMMARY:");
    console.log("═".repeat(40));
    console.log("  Market: ALU/USDC Aluminum Futures");
    console.log("  Symbol: ALU/USDC");
    console.log("  Type: Custom Metric");
    console.log("  OrderBook:", orderBook.address);
    console.log("  Market ID:", marketId.slice(0, 20) + "...");

    try {
      const spread = await orderBook.getSpread();
      if (spread < ethers.constants.MaxUint256) {
        console.log("  Spread:", ethers.utils.formatUnits(spread, 6), "USDC");
      } else {
        console.log("  Spread: No spread (empty side)");
      }
    } catch (spreadError) {
      console.log("  Spread: Could not calculate");
    }

    console.log("═".repeat(60));
    console.log(
      colorText("✨ Updated at: " + new Date().toLocaleString(), colors.cyan)
    );
    console.log("═".repeat(60));
  } catch (error) {
    console.error(colorText("❌ Viewer failed:", colors.red), error.message);

    // Try basic connectivity test
    console.log("\n🔍 Basic connectivity test:");
    try {
      const router = await getContract("TRADING_ROUTER");
      console.log("  ✅ TradingRouter accessible:", router.address);
    } catch (routerError) {
      console.log("  ❌ TradingRouter not accessible:", routerError.message);
    }
  }
}

main().catch(console.error);
