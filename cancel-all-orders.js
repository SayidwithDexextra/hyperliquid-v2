#!/usr/bin/env node

// cancel-all-orders.js - Cancel all existing orders for clean state
//
// 🎯 PURPOSE: Clean up all existing orders and start fresh
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

// 🎨 Color Palette
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  try {
    console.log("🧹 CANCELLING ALL EXISTING ORDERS");
    console.log("═".repeat(60));

    const [deployer] = await ethers.getSigners();
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");

    // Check initial state
    const userOrders = await orderBook.getUserOrders(deployer.address);
    const marginBefore = await vault.getMarginSummary(deployer.address);

    console.log(colorText(`\n👤 Deployer: ${deployer.address}`, colors.green));
    console.log(
      colorText(`📋 Orders to cancel: ${userOrders.length}`, colors.yellow)
    );
    console.log(
      colorText(
        `💰 Margin reserved before: $${ethers.formatUnits(
          marginBefore.marginReserved,
          6
        )}`,
        colors.cyan
      )
    );

    if (userOrders.length === 0) {
      console.log(
        colorText(
          "\n✅ No orders to cancel - order book is already clean!",
          colors.green
        )
      );
      return;
    }

    // Cancel each order
    console.log(colorText("\n🗑️ Cancelling orders...", colors.yellow));
    let cancelledCount = 0;
    let failedCount = 0;

    for (let i = 0; i < userOrders.length; i++) {
      const orderId = userOrders[i];

      try {
        // Check if order still exists
        const order = await orderBook.getOrder(orderId);

        if (order.trader === "0x0000000000000000000000000000000000000000") {
          console.log(
            colorText(
              `   Order ${orderId}: ALREADY DELETED (ghost order)`,
              colors.yellow
            )
          );
          continue;
        }

        console.log(
          colorText(`   Cancelling Order ${orderId}...`, colors.cyan)
        );
        const cancelTx = await orderBook.cancelOrder(orderId);
        await cancelTx.wait();

        cancelledCount++;
        console.log(
          colorText(
            `   ✅ Order ${orderId} cancelled successfully`,
            colors.green
          )
        );
      } catch (error) {
        failedCount++;
        console.log(
          colorText(
            `   ❌ Order ${orderId} failed: ${error.message}`,
            colors.red
          )
        );

        // If it's a "not order owner" error, try to get order details
        if (error.message.includes("Not order owner")) {
          try {
            const order = await orderBook.getOrder(orderId);
            console.log(
              colorText(
                `      Order belongs to: ${order.trader}`,
                colors.yellow
              )
            );
          } catch (detailError) {
            console.log(
              colorText(`      Could not get order details`, colors.yellow)
            );
          }
        }
      }
    }

    // Check final state
    const userOrdersAfter = await orderBook.getUserOrders(deployer.address);
    const marginAfter = await vault.getMarginSummary(deployer.address);
    const pendingOrdersAfter = await vault.getUserPendingOrders(
      deployer.address
    );

    console.log(colorText("\n📊 CLEANUP RESULTS:", colors.brightGreen));
    console.log("═".repeat(60));
    console.log(
      colorText(`✅ Orders cancelled: ${cancelledCount}`, colors.green)
    );
    console.log(colorText(`❌ Orders failed: ${failedCount}`, colors.red));
    console.log(
      colorText(`📋 Orders remaining: ${userOrdersAfter.length}`, colors.cyan)
    );
    console.log(
      colorText(
        `🏦 Pending orders remaining: ${pendingOrdersAfter.length}`,
        colors.cyan
      )
    );
    console.log(
      colorText(
        `💰 Margin reserved after: $${ethers.formatUnits(
          marginAfter.marginReserved,
          6
        )}`,
        colors.cyan
      )
    );

    // If there are still pending orders in vault, list them
    if (pendingOrdersAfter.length > 0) {
      console.log(
        colorText("\n⚠️ REMAINING PENDING ORDERS IN VAULT:", colors.yellow)
      );
      for (let i = 0; i < pendingOrdersAfter.length; i++) {
        const pending = pendingOrdersAfter[i];
        const reservedAmount = Number(
          ethers.formatUnits(pending.marginReserved, 6)
        );
        console.log(
          colorText(
            `   Order ${pending.orderId}: $${reservedAmount.toFixed(
              2
            )} reserved`,
            colors.white
          )
        );
      }

      console.log(
        colorText(
          "\n🧹 These are ghost reservations that need manual cleanup",
          colors.yellow
        )
      );
      console.log(
        colorText("   Run the ghost cleanup script if needed", colors.cyan)
      );
    }

    // Final verification
    if (
      userOrdersAfter.length === 0 &&
      Number(ethers.formatUnits(marginAfter.marginReserved, 6)) === 0
    ) {
      console.log(
        colorText(
          "\n🎉 ORDER BOOK IS NOW COMPLETELY CLEAN!",
          colors.brightGreen
        )
      );
      console.log(colorText("   • No active orders", colors.green));
      console.log(colorText("   • No margin reserved", colors.green));
      console.log(colorText("   • Ready for fresh trading", colors.green));
    } else if (
      userOrdersAfter.length === 0 &&
      Number(ethers.formatUnits(marginAfter.marginReserved, 6)) > 0
    ) {
      console.log(
        colorText(
          "\n⚠️ ORDERS CANCELLED BUT MARGIN STILL RESERVED",
          colors.yellow
        )
      );
      console.log(
        colorText("   This confirms the ghost reservation issue", colors.yellow)
      );
      console.log(
        colorText(
          "   The new deployment will fix this for future orders",
          colors.cyan
        )
      );
    }

    console.log(colorText("\n🚀 READY FOR CLEAN TRADING!", colors.brightGreen));
  } catch (error) {
    console.error(colorText(`❌ Cleanup failed: ${error.message}`, colors.red));
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
