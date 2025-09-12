/**
 * 🔄 EXECUTE POSITION FLIP
 *
 * Simple script to demonstrate position flipping with current positions
 */

const { ethers } = require("hardhat");

// Color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightYellow: "\x1b[93m",
  brightGreen: "\x1b[92m",
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
  console.log(colorText("🔄 EXECUTE POSITION FLIP", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // Get contracts
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      "0x2b961E3959b79326A8e7F64Ef0d2d825707669b5"
    );
    const [deployer, user1, user2] = await ethers.getSigners();

    // Get current mark price
    const markPrice = await orderBook.getMarkPrice();
    console.log(
      colorText(
        `\n📈 Current Mark Price: $${formatUSDC(markPrice)}`,
        colors.brightYellow
      )
    );

    // Set up flip parameters
    // We'll flip at mark price to minimize P&L impact
    const flipPrice = markPrice;
    const flipAmount = ethers.parseUnits("60", 18); // 60 ALU flip

    console.log(colorText("\n📍 POSITION FLIP PARAMETERS", colors.cyan));
    console.log(
      colorText(`Amount: ${formatALU(flipAmount)} ALU`, colors.yellow)
    );
    console.log(colorText(`Price: $${formatUSDC(flipPrice)}`, colors.yellow));
    console.log(
      colorText(
        `Total Value: $${formatUSDC(
          (flipAmount * flipPrice) / BigInt(10 ** 18)
        )}`,
        colors.yellow
      )
    );

    console.log(colorText("\n\n⚡ EXECUTING FLIP", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));

    // User 1 sells (assuming they're currently long)
    console.log(colorText("User 1 placing SELL order...", colors.red));
    let tx = await orderBook.connect(user1).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      false // sell
    );
    await tx.wait();
    console.log(colorText("✅ User 1 sell order placed", colors.green));

    // User 2 buys (assuming they're currently short)
    console.log(colorText("User 2 placing BUY order...", colors.green));
    tx = await orderBook.connect(user2).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      true // buy
    );
    await tx.wait();
    console.log(colorText("✅ User 2 buy order matched", colors.green));

    // Get trade count
    const user1Trades = await orderBook.getUserTradeCount(user1.address);
    const user2Trades = await orderBook.getUserTradeCount(user2.address);

    console.log(colorText("\n\n📊 FLIP RESULTS", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(
      colorText(`User 1 Total Trades: ${user1Trades}`, colors.magenta)
    );
    console.log(
      colorText(`User 2 Total Trades: ${user2Trades}`, colors.magenta)
    );

    // Show recent trades
    console.log(colorText("\n📋 Recent Trades:", colors.cyan));
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
          colors.blue
        )
      );
    }

    console.log(
      colorText("\n\n✅ POSITION FLIP COMPLETE!", colors.brightGreen)
    );
    console.log(
      colorText(
        "The flip was executed at mark price to minimize losses",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "Check your interactive trader to see the new positions!",
        colors.magenta
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
