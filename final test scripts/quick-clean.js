#!/usr/bin/env node

/**
 * 🚀 QUICK ORDER BOOK CLEANUP
 *
 * Fast and simple cleanup script:
 * - Cancel all orders for all users
 * - Reset order book to empty state
 * - Minimal output, maximum efficiency
 */

const { ethers } = require("hardhat");
const { ADDRESSES } = require("../config/contracts");

async function main() {
  console.log("🧹 Quick Order Book Cleanup...");

  // Get contracts
  const signers = await ethers.getSigners();
  const allUsers = signers.slice(0, 10); // First 10 signers

  const orderBook = await ethers.getContractAt(
    "OrderBook",
    ADDRESSES.ALUMINUM_ORDERBOOK
  );

  // Check initial state
  const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
  const totalOrders = Number(buyCount) + Number(sellCount);

  console.log(`📊 Found ${totalOrders} active orders`);

  if (totalOrders === 0) {
    console.log("✅ Order book already clean!");
    return;
  }

  // Cancel all orders for all users
  let cancelled = 0;

  for (const user of allUsers) {
    try {
      const userOrders = await orderBook.getUserOrders(user.address);

      for (const orderId of userOrders) {
        try {
          await orderBook.connect(user).cancelOrder(orderId);
          cancelled++;
          process.stdout.write(".");
        } catch (e) {
          // Ignore cancellation errors
        }
      }
    } catch (e) {
      // Ignore user errors
    }
  }

  console.log(`\n✅ Cancelled ${cancelled} orders`);

  // Verify clean state
  const [finalBuyCount, finalSellCount] =
    await orderBook.getActiveOrdersCount();
  const finalTotal = Number(finalBuyCount) + Number(finalSellCount);

  if (finalTotal === 0) {
    console.log("🎉 Order book is now completely clean!");
    console.log("🚀 Ready for fresh trading");
  } else {
    console.log(`⚠️ ${finalTotal} orders still remain`);
    console.log("💡 Run the full cleanup script for complete reset");
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
