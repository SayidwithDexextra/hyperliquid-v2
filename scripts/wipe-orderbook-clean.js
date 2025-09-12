#!/usr/bin/env node

/**
 * 🧹 WIPE ORDER BOOK CLEAN
 *
 * Cancel all open orders to start fresh
 */

const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(colorText("\n🧹 WIPING ORDER BOOK CLEAN", colors.bright));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");
    const signers = await ethers.getSigners();

    // Check all users for orders
    console.log(colorText("\n📋 CHECKING FOR OPEN ORDERS...", colors.yellow));

    let totalOrdersCancelled = 0;

    for (let i = 0; i < Math.min(4, signers.length); i++) {
      const signer = signers[i];
      const userType = i === 0 ? "Deployer" : `User${i}`;

      try {
        const orderIds = await orderBook.getUserOrders(signer.address);

        if (orderIds.length > 0) {
          console.log(
            colorText(
              `\n${userType} has ${orderIds.length} orders:`,
              colors.cyan
            )
          );

          for (const orderId of orderIds) {
            try {
              const order = await orderBook.getOrder(orderId);

              if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
                const side = order.isBuy ? "BUY" : "SELL";
                console.log(
                  `  Cancelling Order #${orderId}: ${side} ${ethers.formatUnits(
                    order.amount,
                    18
                  )} @ $${ethers.formatUnits(order.price, 6)}`
                );

                const tx = await orderBook.connect(signer).cancelOrder(orderId);
                await tx.wait();

                console.log(colorText(`  ✅ Cancelled!`, colors.green));
                totalOrdersCancelled++;
              }
            } catch (error) {
              console.log(
                colorText(
                  `  ⚠️ Could not cancel order ${orderId}: ${error.message}`,
                  colors.yellow
                )
              );
            }
          }
        } else {
          console.log(`${userType}: No orders`);
        }
      } catch (error) {
        console.log(
          colorText(`Error checking ${userType}: ${error.message}`, colors.red)
        );
      }
    }

    // Verify order book is clean
    console.log(colorText("\n✅ VERIFYING CLEAN STATE...", colors.yellow));

    const [bestBid, bestAsk] = await orderBook.getBestPrices();
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();

    console.log(`\nOrder Book State:`);
    console.log(
      `  Best Bid: ${
        bestBid > 0 ? "$" + ethers.formatUnits(bestBid, 6) : "None"
      }`
    );
    console.log(
      `  Best Ask: ${
        bestAsk < ethers.MaxUint256
          ? "$" + ethers.formatUnits(bestAsk, 6)
          : "None"
      }`
    );
    console.log(`  Active Buy Orders: ${buyCount}`);
    console.log(`  Active Sell Orders: ${sellCount}`);

    if (buyCount === 0n && sellCount === 0n) {
      console.log(colorText("\n✅ ORDER BOOK IS CLEAN!", colors.green));
    } else {
      console.log(colorText("\n⚠️ Some orders may remain!", colors.yellow));
    }

    console.log(
      colorText(
        `\n📊 Summary: Cancelled ${totalOrdersCancelled} orders`,
        colors.cyan
      )
    );
  } catch (error) {
    console.error(colorText("\n❌ Error:", colors.red), error.message);
  }
}

main()
  .then(() => {
    console.log(colorText("\n✅ Order book wiped!", colors.green));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
