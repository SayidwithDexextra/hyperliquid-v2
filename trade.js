#!/usr/bin/env node

// trade.js - Dexetra Trading Utility with Order Modification Support
//
// 🎯 FEATURES:
//   ✅ Launch Interactive Trading Terminal
//   ✅ Order Modification (Cancel & Replace pattern)
//   ✅ Advanced Order Management
//   ✅ Standalone Trading Functions
//
// 🚀 USAGE:
//   node trade.js                    # Launch interactive terminal
//   node trade.js --help             # Show all available commands
//   node trade.js --modify-order     # Modify order example
//
const { spawn } = require("child_process");
const path = require("path");
const { ethers } = require("hardhat");

// Import contract utilities
let contractUtils;
try {
  contractUtils = require("./config/contracts");
} catch (error) {
  console.warn("⚠️ Contract utilities not available in standalone mode");
}

// 🎨 Color utilities
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

// ============ ORDER MODIFICATION FUNCTIONALITY ============

/**
 * @dev Order Modification Class
 * Implements cancel-and-replace pattern since smart contracts don't have native modify
 */
class OrderModifier {
  constructor() {
    this.contracts = {};
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized || !contractUtils) return;

    try {
      console.log(
        colorText("🔧 Initializing contract connections...", colors.yellow)
      );

      this.contracts.mockUSDC = await contractUtils.getContract("MOCK_USDC");
      this.contracts.vault = await contractUtils.getContract(
        "CENTRALIZED_VAULT"
      );
      this.contracts.orderBook = await contractUtils.getContract(
        "ALUMINUM_ORDERBOOK"
      );
      this.contracts.router = await contractUtils.getContract("TRADING_ROUTER");

      this.initialized = true;
      console.log(
        colorText("✅ Contracts initialized successfully!", colors.brightGreen)
      );
    } catch (error) {
      console.error(
        colorText("❌ Failed to initialize contracts:", colors.red),
        error.message
      );
      throw error;
    }
  }

  /**
   * @dev Modify an existing order using cancel-and-replace pattern
   * @param {Object} params - Modification parameters
   * @param {string} params.userAddress - User wallet address
   * @param {number} params.orderId - ID of order to modify
   * @param {number} [params.newPrice] - New price (if changing price)
   * @param {number} [params.newAmount] - New amount (if changing amount)
   * @param {Object} params.signer - Ethers signer object
   * @returns {Object} Result with new order ID and transaction details
   */
  async modifyOrder(params) {
    const { userAddress, orderId, newPrice, newAmount, signer } = params;

    if (!this.initialized) {
      await this.initialize();
    }

    console.log(
      colorText(`\n🔄 Modifying Order ${orderId}...`, colors.brightCyan)
    );
    console.log(colorText("═".repeat(50), colors.cyan));

    try {
      // Step 1: Get current order details
      console.log(
        colorText("📋 Step 1: Fetching current order details...", colors.yellow)
      );
      const currentOrder = await this.contracts.orderBook.getOrder(orderId);

      if (currentOrder.trader === ethers.ZeroAddress) {
        throw new Error(`Order ${orderId} does not exist`);
      }

      if (currentOrder.trader.toLowerCase() !== userAddress.toLowerCase()) {
        throw new Error(
          `Order ${orderId} does not belong to user ${userAddress}`
        );
      }

      // Display current order info with enhanced precision
      const currentPriceFormatted = Number(
        ethers.formatUnits(currentOrder.price, 6)
      ).toFixed(4); // Increased to 4 decimal places for better accuracy
      const currentAmountFormatted = Number(
        ethers.formatUnits(currentOrder.amount, 18)
      ).toFixed(4);
      const side = currentOrder.isBuy ? "BUY" : "SELL";
      const sideColor = currentOrder.isBuy ? colors.green : colors.red;

      console.log(colorText("   Current Order Details:", colors.white));
      console.log(
        colorText(`   • Side: ${colorText(side, sideColor)}`, colors.white)
      );
      console.log(
        colorText(`   • Price: $${currentPriceFormatted} USDC`, colors.yellow)
      );
      console.log(
        colorText(`   • Amount: ${currentAmountFormatted} ALU`, colors.cyan)
      );
      console.log(
        colorText(
          `   • Is Margin: ${currentOrder.isMarginOrder ? "Yes" : "No"}`,
          colors.magenta
        )
      );

      // Step 2: Validate new parameters
      console.log(
        colorText(
          "\n📋 Step 2: Validating modification parameters...",
          colors.yellow
        )
      );

      const finalPrice =
        newPrice !== undefined ? newPrice : parseFloat(currentPriceFormatted);
      const finalAmount =
        newAmount !== undefined
          ? newAmount
          : parseFloat(currentAmountFormatted);

      if (finalPrice <= 0) {
        throw new Error("New price must be greater than 0");
      }
      if (finalAmount <= 0) {
        throw new Error("New amount must be greater than 0");
      }

      // Check if anything actually changed
      const priceChanged =
        newPrice !== undefined &&
        Math.abs(finalPrice - parseFloat(currentPriceFormatted)) > 0.001;
      const amountChanged =
        newAmount !== undefined &&
        Math.abs(finalAmount - parseFloat(currentAmountFormatted)) > 0.0001;

      if (!priceChanged && !amountChanged) {
        console.log(
          colorText(
            "⚠️ No changes detected - order remains the same",
            colors.yellow
          )
        );
        return {
          success: false,
          message: "No changes detected",
          currentOrder: {
            orderId: orderId.toString(),
            price: finalPrice,
            amount: finalAmount,
            side: side,
          },
        };
      }

      console.log(colorText("   Modification Summary:", colors.white));
      if (priceChanged) {
        console.log(
          colorText(
            `   • Price: $${currentPriceFormatted} → $${finalPrice.toFixed(
              2
            )} USDC`,
            colors.brightYellow
          )
        );
      }
      if (amountChanged) {
        console.log(
          colorText(
            `   • Amount: ${currentAmountFormatted} → ${finalAmount.toFixed(
              4
            )} ALU`,
            colors.brightCyan
          )
        );
      }

      // Step 3: Cancel existing order
      console.log(
        colorText("\n📋 Step 3: Cancelling existing order...", colors.yellow)
      );

      const cancelTx = await this.contracts.orderBook
        .connect(signer)
        .cancelOrder(orderId);

      console.log(
        colorText("   ⏳ Cancel transaction submitted...", colors.yellow)
      );
      const cancelReceipt = await cancelTx.wait();
      console.log(
        colorText(
          `   ✅ Order ${orderId} cancelled successfully!`,
          colors.brightGreen
        )
      );
      console.log(colorText(`   📄 Cancel TX: ${cancelTx.hash}`, colors.dim));

      // Step 4: Place new order with updated parameters
      console.log(
        colorText(
          "\n📋 Step 4: Placing new order with updated parameters...",
          colors.yellow
        )
      );

      const priceWei = ethers.parseUnits(finalPrice.toString(), 6);
      const amountWei = ethers.parseUnits(finalAmount.toString(), 18);

      let newOrderTx;
      if (currentOrder.isMarginOrder) {
        newOrderTx = await this.contracts.orderBook
          .connect(signer)
          .placeMarginLimitOrder(priceWei, amountWei, currentOrder.isBuy);
      } else {
        newOrderTx = await this.contracts.orderBook
          .connect(signer)
          .placeLimitOrder(priceWei, amountWei, currentOrder.isBuy);
      }

      console.log(
        colorText("   ⏳ New order transaction submitted...", colors.yellow)
      );
      const newOrderReceipt = await newOrderTx.wait();

      // Extract new order ID from transaction logs
      const orderPlacedEvent = newOrderReceipt.logs.find((log) => {
        try {
          const parsed = this.contracts.orderBook.interface.parseLog(log);
          return parsed.name === "OrderPlaced";
        } catch {
          return false;
        }
      });

      let newOrderId = "Unknown";
      if (orderPlacedEvent) {
        const parsed =
          this.contracts.orderBook.interface.parseLog(orderPlacedEvent);
        newOrderId = parsed.args.orderId.toString();
      }

      console.log(
        colorText(
          `   ✅ New order placed successfully! ID: ${newOrderId}`,
          colors.brightGreen
        )
      );
      console.log(
        colorText(`   📄 New Order TX: ${newOrderTx.hash}`, colors.dim)
      );

      // Step 5: Summary
      console.log(
        colorText("\n🎉 ORDER MODIFICATION COMPLETE!", colors.brightGreen)
      );
      console.log(colorText("═".repeat(50), colors.cyan));
      console.log(colorText(`✅ Old Order ${orderId} → Cancelled`, colors.red));
      console.log(
        colorText(`✅ New Order ${newOrderId} → Active`, colors.green)
      );
      console.log(
        colorText(
          `📊 Final Parameters: $${finalPrice.toFixed(
            2
          )} USDC × ${finalAmount.toFixed(4)} ALU`,
          colors.brightCyan
        )
      );

      return {
        success: true,
        oldOrderId: orderId.toString(),
        newOrderId: newOrderId,
        cancelTxHash: cancelTx.hash,
        newOrderTxHash: newOrderTx.hash,
        finalPrice: finalPrice,
        finalAmount: finalAmount,
        side: side,
        gasUsed: {
          cancel: cancelReceipt.gasUsed.toString(),
          newOrder: newOrderReceipt.gasUsed.toString(),
          total: (cancelReceipt.gasUsed + newOrderReceipt.gasUsed).toString(),
        },
      };
    } catch (error) {
      console.error(
        colorText(`❌ Order modification failed: ${error.message}`, colors.red)
      );

      // Enhanced error handling
      if (error.message.includes("Order does not exist")) {
        console.log(
          colorText(
            "💡 Tip: Check if the order ID is correct and still active",
            colors.cyan
          )
        );
      } else if (error.message.includes("Not order owner")) {
        console.log(
          colorText(
            "💡 Tip: Ensure you're using the correct wallet that placed the order",
            colors.cyan
          )
        );
      } else if (error.message.includes("insufficient")) {
        console.log(
          colorText(
            "💡 Tip: Check your collateral balance for the new order parameters",
            colors.cyan
          )
        );
      }

      throw error;
    }
  }

  /**
   * @dev Batch modify multiple orders
   * @param {Array} modifications - Array of modification parameters
   * @returns {Array} Array of modification results
   */
  async batchModifyOrders(modifications) {
    console.log(
      colorText(
        `\n🔄 Batch Modifying ${modifications.length} Orders...`,
        colors.brightCyan
      )
    );

    const results = [];
    for (let i = 0; i < modifications.length; i++) {
      const mod = modifications[i];
      console.log(
        colorText(
          `\n[${i + 1}/${modifications.length}] Processing Order ${
            mod.orderId
          }...`,
          colors.yellow
        )
      );

      try {
        const result = await this.modifyOrder(mod);
        results.push(result);
        console.log(
          colorText(
            `✅ Order ${mod.orderId} modified successfully`,
            colors.green
          )
        );
      } catch (error) {
        console.error(
          colorText(
            `❌ Failed to modify order ${mod.orderId}: ${error.message}`,
            colors.red
          )
        );
        results.push({
          success: false,
          orderId: mod.orderId,
          error: error.message,
        });
      }

      // Small delay between modifications to avoid overwhelming the network
      if (i < modifications.length - 1) {
        console.log(
          colorText(
            "   ⏳ Waiting 1 second before next modification...",
            colors.dim
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    console.log(
      colorText(`\n📊 BATCH MODIFICATION COMPLETE!`, colors.brightGreen)
    );
    console.log(colorText(`✅ Successful: ${successful}`, colors.green));
    if (failed > 0) {
      console.log(colorText(`❌ Failed: ${failed}`, colors.red));
    }

    return results;
  }

  /**
   * @dev Helper function to get user's orders for modification
   * @param {string} userAddress - User wallet address
   * @returns {Array} Array of user's active orders
   */
  async getUserOrdersForModification(userAddress) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const orderIds = await this.contracts.orderBook.getUserOrders(
        userAddress
      );
      const orders = [];

      for (const orderId of orderIds) {
        try {
          const order = await this.contracts.orderBook.getOrder(orderId);
          if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
            orders.push({
              orderId: orderId.toString(),
              price: Number(ethers.formatUnits(order.price, 6)),
              amount: Number(ethers.formatUnits(order.amount, 18)),
              side: order.isBuy ? "BUY" : "SELL",
              isMargin: order.isMarginOrder,
              timestamp: new Date(
                Number(order.timestamp) * 1000
              ).toLocaleString(),
            });
          }
        } catch (error) {
          console.warn(
            colorText(
              `⚠️ Could not fetch details for order ${orderId}`,
              colors.yellow
            )
          );
        }
      }

      return orders;
    } catch (error) {
      console.error(
        colorText("❌ Failed to fetch user orders:", colors.red),
        error.message
      );
      return [];
    }
  }

  /**
   * @dev Display user's recent trade history
   * @param {string} userAddress - User wallet address
   * @param {number} limit - Number of trades to fetch (max 100)
   */
  async displayUserTradeHistory(userAddress, limit = 20) {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(
      colorText(
        `\n📈 TRADE HISTORY - Last ${limit} Trades`,
        colors.brightYellow
      )
    );
    console.log(colorText("═".repeat(80), colors.cyan));
    console.log(colorText(`👤 User: ${userAddress}`, colors.cyan));

    try {
      // Get user's trade count first
      const userTradeCount = await this.contracts.orderBook.getUserTradeCount(
        userAddress
      );
      console.log(
        colorText(`📊 Total trades: ${userTradeCount}`, colors.white)
      );

      if (userTradeCount === 0) {
        console.log(
          colorText("\n💤 No trades found for this user", colors.yellow)
        );
        console.log(
          colorText(
            "┌─────────────────────────────────────────────────────────────┐",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│                        No Trade History                     │",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "│                                                             │",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│  💡 Start trading to see your history here!                │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│     • Place limit orders for precise entries               │",
            colors.white
          )
        );
        console.log(
          colorText(
            "│     • Use market orders for immediate execution            │",
            colors.white
          )
        );
        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────┘",
            colors.dim
          )
        );
        return;
      }

      // Get user's recent trades (only if user has trades)
      if (Number(userTradeCount) === 0) {
        console.log(colorText("\n💤 No trades to display", colors.yellow));
        return;
      }

      const actualLimit = Math.min(limit, Number(userTradeCount), 100);
      const [trades, hasMore] = await this.contracts.orderBook.getUserTrades(
        userAddress,
        0,
        actualLimit
      );

      console.log(
        colorText(
          "\n┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│ Trade ID │   Side   │    Amount     │    Price     │  Trade Value │     Fee      │      Date/Time      │",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      let totalVolume = 0;
      let totalFees = 0;

      for (const trade of trades) {
        try {
          const tradeId = trade.tradeId.toString();
          const shortId =
            tradeId.length > 8 ? tradeId.substring(0, 8) + "..." : tradeId;

          // Determine if user was buyer or seller
          const isBuyer =
            trade.buyer.toLowerCase() === userAddress.toLowerCase();
          const side = isBuyer ? "BUY" : "SELL";
          const sideColor = isBuyer ? colors.green : colors.red;

          const amount = Number(ethers.formatUnits(trade.amount, 18));
          const price = Number(ethers.formatUnits(trade.price, 6));
          const tradeValue = Number(ethers.formatUnits(trade.tradeValue, 6));
          const userFee = Number(
            ethers.formatUnits(isBuyer ? trade.buyerFee : trade.sellerFee, 6)
          );

          totalVolume += tradeValue;
          totalFees += userFee;

          const timestamp = new Date(Number(trade.timestamp) * 1000);
          const timeStr = timestamp.toLocaleString();

          // Format margin indicators
          const marginIndicator = isBuyer
            ? trade.buyerIsMargin
              ? "M"
              : "S"
            : trade.sellerIsMargin
            ? "M"
            : "S";
          const marginColor =
            marginIndicator === "M" ? colors.magenta : colors.dim;

          console.log(
            colorText(
              `│ ${shortId.padEnd(8)} │ ${colorText(
                side.padEnd(8),
                sideColor
              )} │ ${amount.toFixed(4).padStart(13)} │ ${(
                "$" + price.toFixed(4)
              ).padStart(12)} │ ${("$" + tradeValue.toFixed(2)).padStart(
                12
              )} │ ${("$" + userFee.toFixed(4)).padStart(
                12
              )} │ ${timeStr.padEnd(19)} │`,
              colors.white
            )
          );
        } catch (tradeError) {
          console.log(
            colorText(
              `│ ERROR    │          │               │              │              │              │                     │`,
              colors.red
            )
          );
        }
      }

      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      // Summary row
      console.log(
        colorText(
          `│ 📊 SUMMARY: ${
            trades.length
          } trades │ Total Volume: $${totalVolume.toFixed(
            2
          )} USDC │ Total Fees: $${totalFees.toFixed(4)} USDC │`,
          colors.brightGreen
        )
      );

      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────────────────────────────────────────────┘",
          colors.cyan
        )
      );

      // Legend
      console.log(colorText("\n📋 LEGEND:", colors.brightCyan));
      console.log(
        colorText("   • Side: Your perspective (BUY/SELL)", colors.white)
      );
      console.log(
        colorText("   • M = Margin trade, S = Spot trade", colors.white)
      );
      console.log(colorText("   • Fees shown are what YOU paid", colors.white));
      console.log(
        colorText("   • Times shown in your local timezone", colors.white)
      );

      if (hasMore) {
        console.log(
          colorText(
            `\n💡 ${userTradeCount - trades.length} more trades available`,
            colors.cyan
          )
        );
        console.log(
          colorText("   Use pagination options to see older trades", colors.dim)
        );
      }
    } catch (error) {
      console.error(
        colorText("❌ Failed to fetch trade history:", colors.red),
        error.message
      );
      console.log(colorText("🔍 Debug info:", colors.dim));
      console.log(colorText(`   User: ${userAddress}`, colors.dim));
      console.log(colorText(`   Error: ${error.stack}`, colors.dim));
    }
  }

  /**
   * @dev Display enhanced order book with trader information
   */
  async displayEnhancedOrderBook() {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(
      colorText(
        "\n📊 ENHANCED ORDER BOOK - ALU/USDC (with Traders)",
        colors.brightYellow
      )
    );

    try {
      const [buyCount, sellCount] =
        await this.contracts.orderBook.getActiveOrdersCount();
      const bestBid = await this.contracts.orderBook.bestBid();
      const bestAsk = await this.contracts.orderBook.bestAsk();

      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────────────────────┐",
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
        const enhancedBookData = await this.getEnhancedOrderBookDepth(depth);

        const maxRows = Math.max(
          enhancedBookData.bids.length,
          enhancedBookData.asks.length,
          3
        );

        for (let i = 0; i < maxRows; i++) {
          let bidInfo = "                              ";
          let askInfo = "                              ";

          if (i < enhancedBookData.bids.length) {
            const bid = enhancedBookData.bids[i];
            const price = Number(ethers.formatUnits(bid.price, 6)).toFixed(4);
            const amount = Number(ethers.formatUnits(bid.amount, 18)).toFixed(
              4
            );
            const user = this.formatUserDisplay(bid.trader);
            bidInfo = colorText(
              `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(8)}`,
              colors.green
            );
          }

          if (i < enhancedBookData.asks.length) {
            const ask = enhancedBookData.asks[i];
            const price = Number(ethers.formatUnits(ask.price, 6)).toFixed(4);
            const amount = Number(ethers.formatUnits(ask.amount, 18)).toFixed(
              4
            );
            const user = this.formatUserDisplay(ask.trader);
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

      const bestBidPrice =
        bestBid > 0
          ? Number(ethers.formatUnits(bestBid, 6)).toFixed(4)
          : "0.0000";
      const bestAskPrice =
        bestAsk < ethers.MaxUint256
          ? Number(ethers.formatUnits(bestAsk, 6)).toFixed(4)
          : "∞";

      console.log(
        colorText(
          `│ Best Bid: ${colorText("$" + bestBidPrice, colors.green).padEnd(
            25
          )} Best Ask: ${colorText("$" + bestAskPrice, colors.red).padEnd(
            25
          )} │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Active Orders: ${colorText(
            buyCount + " buys",
            colors.green
          )}, ${colorText(sellCount + " sells", colors.red)}${" ".repeat(35)}│`,
          colors.white
        )
      );
      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────────────────────┘",
          colors.white
        )
      );
    } catch (error) {
      console.log(
        colorText(
          "⚠️ Could not fetch order book data: " + error.message,
          colors.red
        )
      );
    }
  }

  // Helper function to get enhanced order book data with trader information
  async getEnhancedOrderBookDepth(depth) {
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await this.contracts.orderBook.getOrderBookDepth(depth);

    const bids = [];
    const asks = [];

    // Get detailed bid information
    for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
      const price = bidPrices[i];
      const totalAmount = bidAmounts[i];

      // Get the first order at this price level to show as representative trader
      try {
        const buyLevel = await this.contracts.orderBook.buyLevels(price);
        if (buyLevel.exists && buyLevel.firstOrderId > 0) {
          const firstOrder = await this.contracts.orderBook.getOrder(
            buyLevel.firstOrderId
          );
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
        const sellLevel = await this.contracts.orderBook.sellLevels(price);
        if (sellLevel.exists && sellLevel.firstOrderId > 0) {
          const firstOrder = await this.contracts.orderBook.getOrder(
            sellLevel.firstOrderId
          );
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

    return { bids, asks };
  }

  // Helper function to format user display
  formatUserDisplay(traderAddress) {
    if (!traderAddress || traderAddress === ethers.ZeroAddress) {
      return "Unknown";
    }

    // Show first 4 characters of address for identification
    return colorText(traderAddress.substring(2, 6).toUpperCase(), colors.dim);
  }
}

async function showTradeHistory() {
  console.log(colorText("\n📈 Trade History Viewer", colors.brightCyan));
  console.log(colorText("═".repeat(60), colors.cyan));

  try {
    const modifier = new OrderModifier();
    await modifier.initialize();

    // Get all signers to show trade history for each user
    const signers = await ethers.getSigners();
    const maxUsers = Math.min(5, signers.length);

    console.log(
      colorText(
        `🔍 Checking trade history for ${maxUsers} users...`,
        colors.cyan
      )
    );

    for (let i = 0; i < maxUsers; i++) {
      const userSigner = signers[i];
      const userAddress = userSigner.address;
      const userType = i === 0 ? "Deployer" : `User ${i}`;

      console.log(
        colorText(`\n👤 ${userType}: ${userAddress}`, colors.brightYellow)
      );
      console.log(colorText("─".repeat(80), colors.dim));

      try {
        await modifier.displayUserTradeHistory(userAddress, 10); // Show last 10 trades per user
      } catch (userError) {
        console.log(
          colorText(
            `   ❌ Error fetching trade history for ${userType}: ${userError.message}`,
            colors.red
          )
        );
      }
    }

    // Show market-wide statistics
    console.log(colorText(`\n📊 MARKET STATISTICS`, colors.brightCyan));
    console.log(colorText("═".repeat(60), colors.cyan));

    try {
      const [totalTrades, totalVolume, totalFees] =
        await modifier.contracts.orderBook.getTradeStatistics();
      console.log(colorText(`📈 Total Trades: ${totalTrades}`, colors.white));
      console.log(
        colorText(
          `💰 Total Volume: $${ethers.formatUnits(totalVolume, 6)} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `💸 Total Fees: $${ethers.formatUnits(totalFees, 6)} USDC`,
          colors.white
        )
      );

      if (totalTrades > 0) {
        const avgTradeSize =
          Number(ethers.formatUnits(totalVolume, 6)) / Number(totalTrades);
        const avgFeePerTrade =
          Number(ethers.formatUnits(totalFees, 6)) / Number(totalTrades);
        console.log(
          colorText(
            `📊 Avg Trade Size: $${avgTradeSize.toFixed(2)} USDC`,
            colors.cyan
          )
        );
        console.log(
          colorText(
            `📊 Avg Fee per Trade: $${avgFeePerTrade.toFixed(4)} USDC`,
            colors.cyan
          )
        );
      }
    } catch (statsError) {
      console.log(
        colorText("⚠️ Could not fetch market statistics", colors.yellow)
      );
    }
  } catch (error) {
    console.error(
      colorText("❌ Failed to show trade history:", colors.red),
      error.message
    );
  }
}

async function showEnhancedOrderBook() {
  console.log(colorText("\n📊 Enhanced Order Book Viewer", colors.brightCyan));
  console.log(colorText("═".repeat(50), colors.cyan));

  try {
    const modifier = new OrderModifier();
    await modifier.displayEnhancedOrderBook();

    console.log(
      colorText(
        "\n💡 This view shows the first trader at each price level.",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "   If multiple orders exist at the same price, only the first is shown.",
        colors.dim
      )
    );
    console.log(
      colorText(
        "   User identifiers: First 4 chars of wallet address.",
        colors.dim
      )
    );
  } catch (error) {
    console.error(
      colorText("❌ Failed to show enhanced order book:", colors.red),
      error.message
    );
  }
}

// ============ COMMAND LINE INTERFACE ============

async function showHelp() {
  console.log(colorText("\n🎯 Dexetra Trading Utility", colors.brightCyan));
  console.log(colorText("═".repeat(50), colors.cyan));
  console.log(colorText("Available Commands:", colors.brightYellow));
  console.log(
    colorText(
      "  node trade.js                    # Launch interactive terminal",
      colors.white
    )
  );
  console.log(
    colorText(
      "  node trade.js --help             # Show this help",
      colors.white
    )
  );
  console.log(
    colorText(
      "  node trade.js --modify-order     # Order modification example",
      colors.white
    )
  );
  console.log(
    colorText(
      "  node trade.js --list-orders      # List user orders",
      colors.white
    )
  );
  console.log(
    colorText(
      "  node trade.js --show-book        # Show enhanced order book with traders",
      colors.white
    )
  );
  console.log(
    colorText(
      "  node trade.js --trade-history    # Show recent trade history",
      colors.white
    )
  );
  console.log(
    colorText("\n💡 Order Modification Features:", colors.brightYellow)
  );
  console.log(
    colorText("  ✅ Cancel and replace existing orders", colors.green)
  );
  console.log(colorText("  ✅ Modify price, amount, or both", colors.green));
  console.log(colorText("  ✅ Batch modify multiple orders", colors.green));
  console.log(colorText("  ✅ Comprehensive error handling", colors.green));
  console.log(colorText("  ✅ Gas usage tracking", colors.green));
  console.log(colorText("\n🔧 Technical Details:", colors.brightYellow));
  console.log(
    colorText(
      "  • Uses cancel-and-replace pattern (smart contracts don't have native modify)",
      colors.cyan
    )
  );
  console.log(
    colorText(
      "  • Maintains order side (BUY/SELL) and margin status",
      colors.cyan
    )
  );
  console.log(
    colorText("  • Atomic operation with proper error recovery", colors.cyan)
  );
}

async function demonstrateOrderModification() {
  console.log(colorText("\n🎯 Order Modification Demo", colors.brightCyan));
  console.log(colorText("═".repeat(50), colors.cyan));

  try {
    const modifier = new OrderModifier();
    await modifier.initialize();

    // Get signers for demo
    const signers = await ethers.getSigners();
    const userSigner = signers[0]; // Use first signer
    const userAddress = userSigner.address;

    console.log(colorText(`👤 Using demo user: ${userAddress}`, colors.cyan));

    // Get user's orders
    console.log(
      colorText("\n📋 Fetching your active orders...", colors.yellow)
    );
    const orders = await modifier.getUserOrdersForModification(userAddress);

    if (orders.length === 0) {
      console.log(colorText("💤 No active orders found.", colors.yellow));
      console.log(
        colorText(
          "💡 Place some orders first using the interactive terminal:",
          colors.cyan
        )
      );
      console.log(colorText("   node trade.js", colors.white));
      return;
    }

    // Display orders
    console.log(colorText("\n📊 Your Active Orders:", colors.brightYellow));
    console.log(
      colorText(
        "┌─────────────────────────────────────────────────────────┐",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "│  ID       │ Side │   Price   │   Amount  │   Status    │",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────┤",
        colors.cyan
      )
    );

    orders.forEach((order, index) => {
      const shortId = order.orderId.substring(0, 8) + "...";
      const sideColor = order.side === "BUY" ? colors.green : colors.red;
      console.log(
        colorText(
          `│ ${shortId.padEnd(9)} │ ${colorText(
            order.side.padEnd(4),
            sideColor
          )} │ ${("$" + order.price.toFixed(2)).padStart(9)} │ ${order.amount
            .toFixed(4)
            .padStart(9)} │ ${order.isMargin ? "MARGIN" : "SPOT  "} │`,
          colors.white
        )
      );
    });

    console.log(
      colorText(
        "└─────────────────────────────────────────────────────────┘",
        colors.cyan
      )
    );

    // Demo modification (modify first order)
    const firstOrder = orders[0];
    console.log(
      colorText(
        `\n🔄 Demo: Modifying order ${firstOrder.orderId}...`,
        colors.brightYellow
      )
    );
    console.log(
      colorText(
        "   Original: $" +
          firstOrder.price.toFixed(2) +
          " × " +
          firstOrder.amount.toFixed(4),
        colors.white
      )
    );

    // Modify price by 1% and amount by 5%
    const newPrice = firstOrder.price * 1.01; // Increase price by 1%
    const newAmount = firstOrder.amount * 0.95; // Decrease amount by 5%

    console.log(
      colorText(
        "   Modified: $" + newPrice.toFixed(2) + " × " + newAmount.toFixed(4),
        colors.brightCyan
      )
    );

    const result = await modifier.modifyOrder({
      userAddress: userAddress,
      orderId: parseInt(firstOrder.orderId),
      newPrice: newPrice,
      newAmount: newAmount,
      signer: userSigner,
    });

    if (result.success) {
      console.log(
        colorText("\n🎉 Demo completed successfully!", colors.brightGreen)
      );
      console.log(
        colorText(`📊 Gas used: ${result.gasUsed.total} total`, colors.dim)
      );
    }
  } catch (error) {
    console.error(colorText("❌ Demo failed:", colors.red), error.message);
    console.log(colorText("\n💡 Make sure you have:", colors.cyan));
    console.log(
      colorText("   • A local Hardhat network running", colors.white)
    );
    console.log(colorText("   • Contracts deployed", colors.white));
    console.log(colorText("   • Some active orders to modify", colors.white));
  }
}

async function listUserOrders() {
  console.log(colorText("\n📋 Enhanced User Orders Viewer", colors.brightCyan));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    const modifier = new OrderModifier();
    await modifier.initialize();

    // Get all signers to show orders for each user independently
    const signers = await ethers.getSigners();
    const maxUsers = Math.min(5, signers.length);

    console.log(
      colorText(`🔍 Checking orders for ${maxUsers} users...`, colors.cyan)
    );

    for (let i = 0; i < maxUsers; i++) {
      const userSigner = signers[i];
      const userAddress = userSigner.address;
      const userType = i === 0 ? "Deployer" : `User ${i}`;

      console.log(
        colorText(`\n👤 ${userType}: ${userAddress}`, colors.brightYellow)
      );
      console.log(colorText("─".repeat(80), colors.dim));

      try {
        const orders = await modifier.getUserOrdersForModification(userAddress);

        if (orders.length === 0) {
          console.log(colorText("   💤 No active orders", colors.yellow));
          continue;
        }

        console.log(
          colorText(`   📊 Found ${orders.length} Active Orders:`, colors.green)
        );
        console.log(
          colorText(
            "   ┌─────────────────────────────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "   │  Order ID │ Side │   Price   │   Amount  │   Type   │      Created At      │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "   ├─────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        let totalOrderValue = 0;
        orders.forEach((order) => {
          const shortId = order.orderId.substring(0, 9);
          const sideColor = order.side === "BUY" ? colors.green : colors.red;
          const orderValue = order.price * order.amount;
          totalOrderValue += orderValue;

          console.log(
            colorText(
              `   │ ${shortId.padEnd(9)} │ ${colorText(
                order.side.padEnd(4),
                sideColor
              )} │ ${("$" + order.price.toFixed(2)).padStart(
                9
              )} │ ${order.amount.toFixed(4).padStart(9)} │ ${
                order.isMargin ? "MARGIN" : "SPOT  "
              } │ ${order.timestamp.padEnd(20)} │`,
              colors.white
            )
          );
        });

        console.log(
          colorText(
            "   ├─────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );
        console.log(
          colorText(
            `   │ 📊 SUMMARY: ${
              orders.length
            } orders │ Total Value: $${totalOrderValue.toFixed(
              2
            )} USDC                     │`,
            colors.brightGreen
          )
        );
        console.log(
          colorText(
            "   └─────────────────────────────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );
      } catch (userError) {
        console.log(
          colorText(
            `   ❌ Error fetching orders for ${userType}: ${userError.message}`,
            colors.red
          )
        );
      }
    }

    // Show summary across all users
    console.log(colorText(`\n📊 MULTI-USER SUMMARY`, colors.brightCyan));
    console.log(colorText("═".repeat(50), colors.cyan));

    let totalOrdersAcrossUsers = 0;
    let usersWithOrders = 0;

    for (let i = 0; i < maxUsers; i++) {
      try {
        const userSigner = signers[i];
        const orders = await modifier.getUserOrdersForModification(
          userSigner.address
        );
        const userType = i === 0 ? "Deployer" : `User ${i}`;

        if (orders.length > 0) {
          usersWithOrders++;
          totalOrdersAcrossUsers += orders.length;
          const totalValue = orders.reduce(
            (sum, order) => sum + order.price * order.amount,
            0
          );

          console.log(
            colorText(
              `   ${userType}: ${orders.length} orders ($${totalValue.toFixed(
                2
              )} USDC)`,
              colors.white
            )
          );
        }
      } catch (error) {
        // Skip errors in summary
      }
    }

    console.log(colorText("─".repeat(50), colors.dim));
    console.log(
      colorText(
        `   Total: ${totalOrdersAcrossUsers} orders across ${usersWithOrders} users`,
        colors.brightGreen
      )
    );

    if (totalOrdersAcrossUsers === 0) {
      console.log(
        colorText("\n💡 No orders found across all users.", colors.yellow)
      );
      console.log(
        colorText(
          "   • Use the interactive trader to place orders:",
          colors.cyan
        )
      );
      console.log(colorText("     node trade.js", colors.white));
      console.log(
        colorText("   • Or use the enhanced order book viewer:", colors.cyan)
      );
      console.log(colorText("     node trade.js --show-book", colors.white));
    }
  } catch (error) {
    console.error(
      colorText("❌ Failed to list orders:", colors.red),
      error.message
    );
    console.log(colorText("🔍 Debug info:", colors.dim));
    console.log(colorText(`   Error: ${error.stack}`, colors.dim));
  }
}

// ============ MAIN EXECUTION ============

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    await showHelp();
    return;
  }

  if (args.includes("--modify-order")) {
    await demonstrateOrderModification();
    return;
  }

  if (args.includes("--list-orders")) {
    await listUserOrders();
    return;
  }

  if (args.includes("--show-book")) {
    await showEnhancedOrderBook();
    return;
  }

  if (args.includes("--trade-history")) {
    await showTradeHistory();
    return;
  }

  if (args.includes("--market-order")) {
    await placeMarketOrderWithSlippage();
    return;
  }

  if (args.includes("--test-slippage")) {
    await testSlippageScenario();
    return;
  }

  // Default: Launch interactive terminal
  console.log(
    colorText("🚀 Launching Dexetra Interactive Trader...", colors.brightCyan)
  );
  console.log(
    colorText(
      "💡 Use 'node trade.js --help' to see Dexetra order modification features",
      colors.cyan
    )
  );

  const scriptPath = path.join(__dirname, "scripts", "interactive-trader.js");
  const hardhatProcess = spawn(
    "npx",
    ["hardhat", "run", scriptPath, "--network", "localhost"],
    {
      stdio: "inherit",
      shell: true,
    }
  );

  hardhatProcess.on("close", (code) => {
    console.log(
      colorText(`\n✨ Trading session ended with code ${code}`, colors.green)
    );
  });

  hardhatProcess.on("error", (error) => {
    console.error(
      colorText("❌ Failed to start trader:", colors.red),
      error.message
    );
  });
}

// Export for use in other scripts
module.exports = { OrderModifier };

// Execute main function if run directly
if (require.main === module) {
  main().catch(console.error);
}
