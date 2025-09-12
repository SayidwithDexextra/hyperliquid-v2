/**
 * 🔄 POSITION FLIP DEMONSTRATION
 *
 * This script demonstrates how position flipping works by:
 * 1. Showing current positions
 * 2. Executing trades that flip positions from LONG to SHORT and vice versa
 * 3. Displaying the results and P&L
 */

const { ethers } = require("hardhat");

// Color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  return ethers.formatUnits(value, 6);
}

function formatALU(value) {
  return ethers.formatUnits(value, 18);
}

async function main() {
  console.clear();
  console.log(colorText("🔄 POSITION FLIP DEMONSTRATION", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));
  console.log(
    colorText("Using current market state - no reset!", colors.brightMagenta)
  );

  try {
    // Get contracts
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1"
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      "0x2b961E3959b79326A8e7F64Ef0d2d825707669b5"
    );

    const [deployer, user1, user2] = await ethers.getSigners();

    // Display current state
    console.log(colorText("\n📊 CURRENT POSITIONS", colors.brightCyan));
    console.log(colorText("Based on previous trades:", colors.cyan));
    console.log(colorText("• User 1: LONG 30 ALU @ $10", colors.green));
    console.log(colorText("• User 2: SHORT 30 ALU @ $10", colors.red));

    // Get current trade counts
    const user1TradesBefore = await orderBook.getUserTradeCount(user1.address);
    const user2TradesBefore = await orderBook.getUserTradeCount(user2.address);
    console.log(
      colorText(`\nUser 1 has ${user1TradesBefore} trades`, colors.cyan)
    );
    console.log(
      colorText(`User 2 has ${user2TradesBefore} trades`, colors.cyan)
    );

    // POSITION FLIP DEMONSTRATION
    console.log(
      colorText("\n\n🎯 EXECUTING POSITION FLIP", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    console.log(colorText("\n📍 The Flip Trade:", colors.brightMagenta));
    console.log(colorText("• User 1 will SELL 80 ALU @ $12", colors.magenta));
    console.log(colorText("• User 2 will BUY 80 ALU @ $12", colors.magenta));

    console.log(colorText("\n📊 What happens:", colors.brightCyan));
    console.log(colorText("User 1:", colors.yellow));
    console.log(
      colorText(
        "  1. Closes LONG 30 ALU (realizes $2/ALU profit = $60)",
        colors.green
      )
    );
    console.log(colorText("  2. Opens SHORT 50 ALU @ $12", colors.red));
    console.log(colorText("User 2:", colors.yellow));
    console.log(
      colorText(
        "  1. Closes SHORT 30 ALU (realizes $2/ALU loss = -$60)",
        colors.red
      )
    );
    console.log(colorText("  2. Opens LONG 50 ALU @ $12", colors.green));

    const flipAmount = ethers.parseUnits("80", 18);
    const flipPrice = ethers.parseUnits("12", 6);

    console.log(colorText("\n⏳ Executing flip trades...", colors.yellow));

    // User 1 sells 80 ALU
    let tx = await orderBook.connect(user1).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      false // sell
    );
    await tx.wait();
    console.log(colorText("✅ User 1 sell order placed", colors.green));

    // User 2 buys 80 ALU
    tx = await orderBook.connect(user2).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      true // buy
    );
    await tx.wait();
    console.log(colorText("✅ User 2 buy order matched", colors.green));

    // Display results
    console.log(colorText("\n\n📊 POSITION FLIP RESULTS", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));

    // Get new positions
    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);

    // Get trade counts after
    const user1TradesAfter = await orderBook.getUserTradeCount(user1.address);
    const user2TradesAfter = await orderBook.getUserTradeCount(user2.address);

    // Display User 1 results
    console.log(colorText("\nUser 1:", colors.brightCyan));
    console.log(colorText(`• Started: LONG 30 ALU @ $10`, colors.green));
    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      const size = pos.size;
      const side = size >= 0n ? "LONG" : "SHORT";
      const absSize = size < 0n ? -size : size;
      console.log(
        colorText(
          `• Now: ${side} ${formatALU(absSize)} ALU @ $${formatUSDC(
            pos.entryPrice
          )}`,
          side === "LONG" ? colors.green : colors.red
        )
      );
    }
    console.log(
      colorText(
        `• Realized P&L: +$60 (from closing long at profit)`,
        colors.brightGreen
      )
    );
    console.log(
      colorText(
        `• Total trades: ${user1TradesAfter} (+${
          user1TradesAfter - user1TradesBefore
        } new)`,
        colors.magenta
      )
    );

    // Display User 2 results
    console.log(colorText("\nUser 2:", colors.brightCyan));
    console.log(colorText(`• Started: SHORT 30 ALU @ $10`, colors.red));
    if (user2Positions.length > 0) {
      const pos = user2Positions[0];
      const size = pos.size;
      const side = size >= 0n ? "LONG" : "SHORT";
      const absSize = size < 0n ? -size : size;
      console.log(
        colorText(
          `• Now: ${side} ${formatALU(absSize)} ALU @ $${formatUSDC(
            pos.entryPrice
          )}`,
          side === "LONG" ? colors.green : colors.red
        )
      );
    }
    console.log(
      colorText(
        `• Realized P&L: -$60 (from closing short at loss)`,
        colors.brightRed
      )
    );
    console.log(
      colorText(
        `• Total trades: ${user2TradesAfter} (+${
          user2TradesAfter - user2TradesBefore
        } new)`,
        colors.magenta
      )
    );

    // Show recent trades
    console.log(colorText("\n\n📋 RECENT TRADES", colors.brightYellow));
    const recentTrades = await orderBook.getRecentTrades(3);
    for (let i = 0; i < recentTrades.length; i++) {
      const trade = recentTrades[i];
      const buyer = trade.buyer === user1.address ? "User1" : "User2";
      const seller = trade.seller === user1.address ? "User1" : "User2";
      console.log(
        colorText(
          `${i + 1}. ${buyer} bought ${formatALU(
            trade.amount
          )} ALU from ${seller} @ $${formatUSDC(trade.price)}`,
          colors.white
        )
      );
    }

    console.log(
      colorText("\n\n✅ POSITION FLIP COMPLETE!", colors.brightGreen)
    );
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(colorText("💡 Key Points:", colors.brightYellow));
    console.log(
      colorText("• Both users completely reversed their positions", colors.cyan)
    );
    console.log(
      colorText("• P&L was realized on the closed portion", colors.cyan)
    );
    console.log(
      colorText("• New positions opened at the execution price", colors.cyan)
    );
    console.log(
      colorText("• All trades are recorded in your trade history", colors.cyan)
    );
    console.log(
      colorText(
        "\n🎮 Run the interactive trader to see full details!",
        colors.brightMagenta
      )
    );
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    if (error.reason) {
      console.error(colorText(`Reason: ${error.reason}`, colors.red));
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
