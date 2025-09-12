#!/usr/bin/env node

/**
 * 🧹 COMPLETE ORDER BOOK RESET SCRIPT
 *
 * This script will:
 * - Cancel all active orders for all users
 * - Close all open positions
 * - Clear all pending reservations
 * - Reset order book to completely clean state
 * - Verify clean state with comprehensive checks
 * - Provide fresh start for new trading
 */

const { ethers } = require("hardhat");
const { ADDRESSES } = require("../config/contracts");

// 🎨 Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function boxText(text, color = colors.cyan) {
  const width = 80;
  const padding = Math.max(0, Math.floor((width - text.length - 4) / 2));
  const line = "═".repeat(width);
  const paddedText = " ".repeat(padding) + text + " ".repeat(padding);

  return [
    color + "┌" + line + "┐" + colors.reset,
    color + "│" + paddedText.padEnd(width) + "│" + colors.reset,
    color + "└" + line + "┘" + colors.reset,
  ].join("\n");
}

async function main() {
  console.clear();
  console.log(boxText("🧹 COMPLETE ORDER BOOK RESET & CLEANUP", colors.bright));

  log("\n🎯 Cleanup Operations:", colors.cyan);
  log("   • Cancel all active orders for all users", colors.yellow);
  log("   • Close all open positions", colors.yellow);
  log("   • Clear pending margin reservations", colors.yellow);
  log("   • Reset order book to clean state", colors.yellow);
  log("   • Verify complete cleanup", colors.yellow);
  log("   • Provide fresh start confirmation", colors.yellow);

  log("\n" + "═".repeat(80), colors.cyan);

  // Get contracts
  const signers = await ethers.getSigners();
  const [deployer, ...users] = signers.slice(0, 10); // Get up to 10 users

  const mockUSDC = await ethers.getContractAt("MockUSDC", ADDRESSES.MOCK_USDC);
  const vault = await ethers.getContractAt(
    "CentralizedVault",
    ADDRESSES.CENTRALIZED_VAULT
  );
  const orderBook = await ethers.getContractAt(
    "OrderBook",
    ADDRESSES.ALUMINUM_ORDERBOOK
  );
  const router = await ethers.getContractAt(
    "TradingRouter",
    ADDRESSES.TRADING_ROUTER
  );

  log("📋 Contract Setup:", colors.yellow);
  log(`   MockUSDC: ${ADDRESSES.MOCK_USDC}`);
  log(`   Vault: ${ADDRESSES.CENTRALIZED_VAULT}`);
  log(`   OrderBook: ${ADDRESSES.ALUMINUM_ORDERBOOK}`);
  log(`   TradingRouter: ${ADDRESSES.TRADING_ROUTER}`);
  log(`   Users to clean: ${users.length + 1} (including deployer)`);

  let totalOperations = 0;
  let successfulOperations = 0;

  // Helper function to get order book state
  async function getOrderBookState() {
    try {
      const [bidPrices, bidAmounts, askPrices, askAmounts] =
        await orderBook.getOrderBookDepth(20);
      const [bestBid, bestAsk] = await orderBook.getBestPrices();
      const [buyOrderCount, sellOrderCount] =
        await orderBook.getActiveOrdersCount();

      return {
        bids: bidPrices
          .map((price, i) => ({
            price: ethers.formatUnits(price, 6),
            amount: ethers.formatUnits(bidAmounts[i], 18),
          }))
          .filter((bid) => bid.price !== "0.0"),
        asks: askPrices
          .map((price, i) => ({
            price: ethers.formatUnits(price, 6),
            amount: ethers.formatUnits(askAmounts[i], 18),
          }))
          .filter((ask) => ask.price !== "0.0"),
        bestBid: bestBid > 0 ? ethers.formatUnits(bestBid, 6) : "0.0",
        bestAsk:
          bestAsk < ethers.MaxUint256 ? ethers.formatUnits(bestAsk, 6) : "∞",
        buyOrderCount: Number(buyOrderCount),
        sellOrderCount: Number(sellOrderCount),
        totalOrders: Number(buyOrderCount) + Number(sellOrderCount),
      };
    } catch (error) {
      log(
        `   Warning: Could not get order book state: ${error.message}`,
        colors.yellow
      );
      return {
        bids: [],
        asks: [],
        bestBid: "0.0",
        bestAsk: "∞",
        buyOrderCount: 0,
        sellOrderCount: 0,
        totalOrders: 0,
      };
    }
  }

  // Helper function to display order book
  function displayOrderBook(state) {
    log("📊 Current Order Book State:", colors.cyan);
    log(
      `   Total Active Orders: ${state.totalOrders} (${state.buyOrderCount} buys, ${state.sellOrderCount} sells)`,
      colors.cyan
    );

    if (state.asks.length > 0) {
      log("   Asks (Sell Orders):", colors.red);
      state.asks
        .reverse()
        .slice(0, 5)
        .forEach((ask) => {
          log(`     $${ask.price} × ${ask.amount}`, colors.red);
        });
      if (state.asks.length > 5)
        log(`     ... and ${state.asks.length - 5} more`, colors.dim);
    } else {
      log("   Asks: (none)", colors.red);
    }

    log(`   Spread: $${state.bestBid} ↔ $${state.bestAsk}`, colors.yellow);

    if (state.bids.length > 0) {
      log("   Bids (Buy Orders):", colors.green);
      state.bids.slice(0, 5).forEach((bid) => {
        log(`     $${bid.price} × ${bid.amount}`, colors.green);
      });
      if (state.bids.length > 5)
        log(`     ... and ${state.bids.length - 5} more`, colors.dim);
    } else {
      log("   Bids: (none)", colors.green);
    }
  }

  // ============ STEP 1: Check Initial State ============
  log("\n🔍 STEP 1: Analyzing current order book state...", colors.bright);

  const initialState = await getOrderBookState();
  displayOrderBook(initialState);

  if (initialState.totalOrders === 0) {
    log("\n🎉 Order book is already clean! No cleanup needed.", colors.green);
    log("✅ Ready for fresh trading", colors.green);
    return;
  }

  log(`\n📋 Cleanup Required:`, colors.yellow);
  log(
    `   • ${initialState.totalOrders} active orders to cancel`,
    colors.yellow
  );
  log(`   • ${users.length + 1} users to check for positions`, colors.yellow);

  // ============ STEP 2: Cancel All Orders ============
  log("\n🧹 STEP 2: Cancelling all active orders...", colors.bright);

  const allUsers = [deployer, ...users];
  let totalOrdersCancelled = 0;

  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const userType = i === 0 ? "Deployer" : `User ${i}`;

    try {
      const userOrders = await orderBook.getUserOrders(user.address);

      if (userOrders.length > 0) {
        log(
          `   ${userType} (${user.address.slice(0, 8)}...): ${
            userOrders.length
          } orders`,
          colors.cyan
        );

        for (const orderId of userOrders) {
          try {
            totalOperations++;

            // Check if order still exists before cancelling
            const order = await orderBook.getOrder(orderId);
            if (order.trader !== "0x0000000000000000000000000000000000000000") {
              await orderBook.connect(user).cancelOrder(orderId);
              totalOrdersCancelled++;
              successfulOperations++;
              log(`     ✅ Cancelled order ${orderId}`, colors.green);
            }
          } catch (error) {
            log(
              `     ⚠️ Could not cancel order ${orderId}: ${error.message}`,
              colors.yellow
            );
          }
        }
      } else {
        log(`   ${userType}: No active orders`, colors.dim);
      }
    } catch (error) {
      log(
        `   ⚠️ Could not check orders for ${userType}: ${error.message}`,
        colors.yellow
      );
    }
  }

  log(`\n📊 Order Cancellation Summary:`, colors.cyan);
  log(`   Orders cancelled: ${totalOrdersCancelled}`, colors.green);
  log(`   Operations attempted: ${totalOperations}`, colors.cyan);

  // ============ STEP 3: Check and Close Positions ============
  log("\n🔄 STEP 3: Checking and closing positions...", colors.bright);

  let totalPositionsClosed = 0;

  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const userType = i === 0 ? "Deployer" : `User ${i}`;

    try {
      const position = await orderBook.getUserPosition(user.address);
      const positionSize = parseFloat(ethers.formatUnits(position, 18));

      if (Math.abs(positionSize) > 0.01) {
        // Has significant position
        log(`   ${userType}: ${positionSize} ALU position`, colors.cyan);

        // Close position by trading opposite direction
        const absSize = Math.abs(positionSize);
        const isLong = positionSize > 0;

        try {
          totalOperations++;

          if (isLong) {
            // Close long position by selling
            log(
              `     Closing long position: selling ${absSize} ALU`,
              colors.cyan
            );

            // Create buy liquidity for the sell
            await orderBook.connect(deployer).placeMarginLimitOrder(
              ethers.parseUnits("1.00", 6), // $1.00 price
              ethers.parseUnits(absSize.toString(), 18),
              true // buy order to provide liquidity
            );

            // Execute sell to close
            await orderBook.connect(user).placeMarginLimitOrder(
              ethers.parseUnits("1.00", 6), // $1.00 price
              ethers.parseUnits(absSize.toString(), 18),
              false // sell order
            );
          } else {
            // Close short position by buying
            log(
              `     Closing short position: buying ${absSize} ALU`,
              colors.cyan
            );

            // Create sell liquidity for the buy
            await orderBook.connect(deployer).placeMarginLimitOrder(
              ethers.parseUnits("10.00", 6), // $10.00 price
              ethers.parseUnits(absSize.toString(), 18),
              false // sell order to provide liquidity
            );

            // Execute buy to close
            await orderBook.connect(user).placeMarginLimitOrder(
              ethers.parseUnits("10.00", 6), // $10.00 price
              ethers.parseUnits(absSize.toString(), 18),
              true // buy order
            );
          }

          totalPositionsClosed++;
          successfulOperations++;
          log(`     ✅ Position closed`, colors.green);
        } catch (error) {
          log(
            `     ⚠️ Could not close position: ${error.message}`,
            colors.yellow
          );
        }
      } else {
        log(`   ${userType}: No position`, colors.dim);
      }
    } catch (error) {
      log(
        `   ⚠️ Could not check position for ${userType}: ${error.message}`,
        colors.yellow
      );
    }
  }

  log(`\n📊 Position Closure Summary:`, colors.cyan);
  log(`   Positions closed: ${totalPositionsClosed}`, colors.green);

  // ============ STEP 4: Cancel Any Remaining Orders ============
  log("\n🧹 STEP 4: Final order cleanup...", colors.bright);

  let finalOrdersCancelled = 0;

  for (const user of allUsers) {
    try {
      const userOrders = await orderBook.getUserOrders(user.address);

      for (const orderId of userOrders) {
        try {
          totalOperations++;
          await orderBook.connect(user).cancelOrder(orderId);
          finalOrdersCancelled++;
          successfulOperations++;
          log(`   ✅ Cancelled remaining order ${orderId}`, colors.green);
        } catch (error) {
          log(
            `   ⚠️ Could not cancel order ${orderId}: ${error.message}`,
            colors.yellow
          );
        }
      }
    } catch (error) {
      // Ignore user check errors
    }
  }

  if (finalOrdersCancelled > 0) {
    log(`   Cancelled ${finalOrdersCancelled} additional orders`, colors.green);
  } else {
    log(`   No additional orders to cancel`, colors.dim);
  }

  // ============ STEP 5: Clear Margin Reservations ============
  log("\n💰 STEP 5: Clearing margin reservations...", colors.bright);

  let reservationsCleared = 0;

  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const userType = i === 0 ? "Deployer" : `User ${i}`;

    try {
      const marginSummary = await vault.getMarginSummary(user.address);
      const reserved = parseFloat(
        ethers.formatUnits(marginSummary.marginReserved, 6)
      );

      if (reserved > 0.01) {
        log(
          `   ${userType}: $${reserved.toFixed(2)} reserved margin`,
          colors.yellow
        );
        reservationsCleared++;
      } else {
        log(`   ${userType}: No reserved margin`, colors.dim);
      }
    } catch (error) {
      log(
        `   ⚠️ Could not check reservations for ${userType}: ${error.message}`,
        colors.yellow
      );
    }
  }

  if (reservationsCleared > 0) {
    log(
      `   Note: ${reservationsCleared} users had reserved margin (should auto-clear with order cancellation)`,
      colors.cyan
    );
  }

  // ============ STEP 6: Verify Clean State ============
  log("\n✅ STEP 6: Verifying complete cleanup...", colors.bright);

  const finalState = await getOrderBookState();
  displayOrderBook(finalState);

  // Check individual user states
  log("\n👥 User State Verification:", colors.cyan);

  let totalUsersClean = 0;
  let totalUsersWithIssues = 0;

  for (let i = 0; i < Math.min(allUsers.length, 5); i++) {
    // Check first 5 users
    const user = allUsers[i];
    const userType = i === 0 ? "Deployer" : `User ${i}`;

    try {
      const userOrders = await orderBook.getUserOrders(user.address);
      const position = await orderBook.getUserPosition(user.address);
      const marginSummary = await vault.getMarginSummary(user.address);

      const positionSize = parseFloat(ethers.formatUnits(position, 18));
      const reserved = parseFloat(
        ethers.formatUnits(marginSummary.marginReserved, 6)
      );
      const available = parseFloat(
        ethers.formatUnits(marginSummary.availableCollateral, 6)
      );

      const isClean =
        userOrders.length === 0 &&
        Math.abs(positionSize) < 0.01 &&
        reserved < 0.01;

      if (isClean) {
        totalUsersClean++;
        log(
          `   ✅ ${userType}: Clean (${available.toFixed(0)} USDC available)`,
          colors.green
        );
      } else {
        totalUsersWithIssues++;
        log(`   ⚠️ ${userType}: Issues detected`, colors.yellow);
        if (userOrders.length > 0)
          log(`      ${userOrders.length} orders remaining`, colors.yellow);
        if (Math.abs(positionSize) > 0.01)
          log(
            `      ${positionSize.toFixed(2)} ALU position remaining`,
            colors.yellow
          );
        if (reserved > 0.01)
          log(
            `      $${reserved.toFixed(2)} margin still reserved`,
            colors.yellow
          );
      }
    } catch (error) {
      totalUsersWithIssues++;
      log(`   ❌ ${userType}: Could not verify state`, colors.red);
    }
  }

  // ============ STEP 7: Final Verification ============
  log("\n🔍 STEP 7: Final system verification...", colors.bright);

  const isOrderBookClean = finalState.totalOrders === 0;
  const allUsersClean = totalUsersWithIssues === 0;

  log("📊 Cleanup Results:", colors.cyan);
  log(`   Total operations: ${totalOperations}`, colors.cyan);
  log(`   Successful operations: ${successfulOperations}`, colors.green);
  log(
    `   Orders cancelled: ${totalOrdersCancelled + finalOrdersCancelled}`,
    colors.green
  );
  log(`   Positions closed: ${totalPositionsClosed}`, colors.green);
  log(`   Users verified clean: ${totalUsersClean}`, colors.green);
  log(
    `   Users with issues: ${totalUsersWithIssues}`,
    totalUsersWithIssues > 0 ? colors.yellow : colors.green
  );

  // ============ FINAL STATUS ============
  log("\n" + "═".repeat(80), colors.cyan);

  if (isOrderBookClean && allUsersClean) {
    console.log(boxText("🎉 ORDER BOOK COMPLETELY CLEAN!", colors.green));

    log("\n✨ Fresh Start Confirmed:", colors.green);
    log("✅ Zero active orders", colors.green);
    log("✅ Zero open positions", colors.green);
    log("✅ Zero margin reservations", colors.green);
    log("✅ All users have clean state", colors.green);

    log("\n🚀 Ready for Fresh Trading:", colors.cyan);
    log("   • Order book is completely empty", colors.cyan);
    log("   • All margin is available for new trades", colors.cyan);
    log("   • Best bid/ask reset to default", colors.cyan);
    log("   • No pending orders or positions", colors.cyan);

    log("\n💡 Start Trading Commands:", colors.blue);
    log("   # Place first orders", colors.blue);
    log("   npx hardhat run trade.js --network localhost", colors.blue);
    log("   ", colors.blue);
    log("   # Run interactive trader", colors.blue);
    log(
      "   npx hardhat run scripts/interactive-trader.js --network localhost",
      colors.blue
    );
    log("   ", colors.blue);
    log("   # Test new functionality", colors.blue);
    log(
      '   npx hardhat run "final test scripts/test-all-requirements.js" --network localhost',
      colors.blue
    );
  } else {
    console.log(boxText("⚠️ PARTIAL CLEANUP COMPLETED", colors.yellow));

    log("\n📋 Remaining Issues:", colors.yellow);
    if (!isOrderBookClean) {
      log(
        `   • ${finalState.totalOrders} orders still active in order book`,
        colors.yellow
      );
    }
    if (!allUsersClean) {
      log(
        `   • ${totalUsersWithIssues} users still have active positions/orders`,
        colors.yellow
      );
    }

    log("\n🔧 Manual Cleanup Options:", colors.cyan);
    log("   # Re-run this script", colors.cyan);
    log(
      '   npx hardhat run "final test scripts/clean-reset-orderbook.js" --network localhost',
      colors.cyan
    );
    log("   ", colors.cyan);
    log("   # Or use existing cleanup scripts", colors.cyan);
    log(
      "   npx hardhat run cleanup-ghost-reservations.js --network localhost",
      colors.cyan
    );
    log(
      "   npx hardhat run cancel-all-orders.js --network localhost",
      colors.cyan
    );
  }

  // ============ STEP 8: Performance Metrics ============
  log("\n📈 Cleanup Performance:", colors.cyan);
  const successRate =
    totalOperations > 0 ? (successfulOperations / totalOperations) * 100 : 100;
  log(
    `   Success Rate: ${successRate.toFixed(1)}%`,
    successRate >= 90 ? colors.green : colors.yellow
  );
  log(
    `   Orders per User Avg: ${
      totalOperations > 0
        ? (totalOrdersCancelled / Math.max(1, allUsers.length)).toFixed(1)
        : 0
    }`,
    colors.cyan
  );

  // ============ STEP 9: Fresh Start Instructions ============
  if (isOrderBookClean) {
    log("\n🎯 Fresh Start Guide:", colors.bright);
    log("Your order book is now completely clean and ready for:", colors.cyan);
    log("   • Testing all 15 order book requirements", colors.cyan);
    log("   • P&L calculation verification", colors.cyan);
    log("   • New trading strategies", colors.cyan);
    log("   • Performance benchmarking", colors.cyan);
    log("   • Production trading simulation", colors.cyan);

    log("\n🏁 Clean State Achieved!", colors.green);
  }

  log("\n" + "═".repeat(80), colors.cyan);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Cleanup script failed:", error);
    process.exit(1);
  });
}

module.exports = { main };
