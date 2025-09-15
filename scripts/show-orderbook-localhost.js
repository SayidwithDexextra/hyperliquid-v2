#!/usr/bin/env node

// show-orderbook-localhost.js - Show Order Book with Localhost Network
//
// 🎯 PURPOSE:
//   Show the order book using the localhost network where contracts are deployed
//
// 🚀 USAGE:
//   npx hardhat run scripts/show-orderbook-localhost.js --network localhost

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
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(4);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function showOrderBookLocalhost() {
  console.log(
    colorText(
      "\n📊 ENHANCED ORDER BOOK - ALU/USDC (with Traders, Mark Price & Last Trade)",
      colors.brightYellow
    )
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Get basic order book state
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();
    const lastTradePrice = await orderBook.lastTradePrice();

    // Format prices for display
    const markPriceFormatted = formatPrice(markPrice);
    const lastTradePriceFormatted =
      lastTradePrice > 0 ? formatPrice(lastTradePrice) : "N/A";

    console.log(
      colorText(
        "┌─────────────────────────────────────────────────────────────────────────────┐",
        colors.white
      )
    );
    console.log(
      colorText(
        "│                        MARKET PRICE INFORMATION                             │",
        colors.bright
      )
    );
    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────┤",
        colors.white
      )
    );

    // Display mark price and last traded price prominently
    console.log(
      colorText(
        `│ Mark Price: ${colorText(
          "$" + markPriceFormatted,
          colors.brightCyan
        ).padEnd(20)} Last Trade: ${colorText(
          "$" + lastTradePriceFormatted,
          colors.brightYellow
        ).padEnd(20)} │`,
        colors.white
      )
    );

    // Calculate spread if both bid and ask exist
    const bestBidPrice =
      bestBid > 0 ? Number(ethers.formatUnits(bestBid, 6)) : 0;
    const bestAskPrice =
      bestAsk < ethers.MaxUint256 ? Number(ethers.formatUnits(bestAsk, 6)) : 0;
    const spread =
      bestBidPrice > 0 && bestAskPrice > 0 ? bestAskPrice - bestBidPrice : 0;
    const spreadFormatted = spread > 0 ? spread.toFixed(4) : "N/A";

    console.log(
      colorText(
        `│ Best Bid: ${colorText(
          bestBidPrice > 0 ? "$" + bestBidPrice.toFixed(4) : "N/A",
          colors.green
        ).padEnd(20)} Best Ask: ${colorText(
          bestAskPrice > 0 ? "$" + bestAskPrice.toFixed(4) : "N/A",
          colors.red
        ).padEnd(20)} │`,
        colors.white
      )
    );
    console.log(
      colorText(
        `│ Spread: ${colorText("$" + spreadFormatted, colors.magenta).padEnd(
          20
        )} Active Orders: ${colorText(
          buyCount + " buys, " + sellCount + " sells",
          colors.cyan
        ).padEnd(20)} │`,
        colors.white
      )
    );

    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────┤",
        colors.white
      )
    );
    console.log(
      colorText(
        "│                           ORDER BOOK DEPTH                                 │",
        colors.bright
      )
    );
    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────┤",
        colors.white
      )
    );
    console.log(
      colorText(
        "│         BIDS (Buy Orders)         │         ASKS (Sell Orders)         │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│   Price    Amount    User        │    Price    Amount    User        │",
        colors.white
      )
    );
    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────┤",
        colors.white
      )
    );

    // Get enhanced order book depth with user info
    try {
      const depth = 5;
      const [bidPrices, bidAmounts, askPrices, askAmounts] =
        await orderBook.getOrderBookDepth(depth);

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

      const maxRows = Math.max(bids.length, asks.length, 3);

      for (let i = 0; i < maxRows; i++) {
        let bidInfo = "                              ";
        let askInfo = "                              ";

        if (i < bids.length) {
          const bid = bids[i];
          const price = formatPrice(bid.price);
          const amount = formatAmount(bid.amount);
          const user =
            bid.trader !== ethers.ZeroAddress
              ? bid.trader.substring(2, 6).toUpperCase()
              : "Unknown";
          bidInfo = colorText(
            `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(8)}`,
            colors.green
          );
        }

        if (i < asks.length) {
          const ask = asks[i];
          const price = formatPrice(ask.price);
          const amount = formatAmount(ask.amount);
          const user =
            ask.trader !== ethers.ZeroAddress
              ? ask.trader.substring(2, 6).toUpperCase()
              : "Unknown";
          askInfo = colorText(
            `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(8)}`,
            colors.red
          );
        }

        console.log(
          colorText("│ ", colors.white) +
            bidInfo +
            colorText(" │ ", colors.white) +
            askInfo +
            colorText(" │", colors.white)
        );
      }
    } catch (error) {
      console.log(
        colorText(
          "│                         No order book data available                         │",
          colors.yellow
        )
      );
      console.log(
        colorText(
          `│ Error: ${error.message.substring(0, 65).padEnd(65)} │`,
          colors.red
        )
      );
    }

    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────┤",
        colors.white
      )
    );
    console.log(
      colorText(
        "└─────────────────────────────────────────────────────────────────────────────┘",
        colors.white
      )
    );

    // Add helpful legend
    console.log(colorText("\n📋 PRICE LEGEND:", colors.brightCyan));
    console.log(
      colorText(
        "   • Mark Price: Current fair value used for PnL calculations and liquidations",
        colors.white
      )
    );
    console.log(
      colorText(
        "   • Last Trade: Price of the most recent executed trade",
        colors.white
      )
    );
    console.log(
      colorText(
        "   • Best Bid/Ask: Highest buy order and lowest sell order prices",
        colors.white
      )
    );
    console.log(
      colorText(
        "   • Spread: Difference between best ask and best bid",
        colors.white
      )
    );
  } catch (error) {
    console.log(
      colorText("❌ Error showing order book: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the script
showOrderBookLocalhost().catch(console.error);
