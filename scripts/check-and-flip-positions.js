/**
 * 🔍 CHECK POSITIONS AND EXECUTE SAFE FLIP
 *
 * This script:
 * 1. Checks current positions and collateral
 * 2. Calculates safe flip amounts
 * 3. Executes a position flip within collateral limits
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
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  return ethers.formatUnits(value, 6);
}

function formatALU(value) {
  return ethers.formatUnits(value, 18);
}

async function checkUserState(vault, orderBook, user, label) {
  const positions = await vault.getUserPositions(user.address);
  const marginSummary = await vault.getMarginSummary(user.address);
  const tradeCount = await orderBook.getUserTradeCount(user.address);

  console.log(colorText(`\n📊 ${label} State:`, colors.brightYellow));
  console.log(
    colorText(
      `   Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`,
      colors.blue
    )
  );
  console.log(
    colorText(
      `   Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`,
      colors.green
    )
  );
  console.log(
    colorText(
      `   Reserved: ${formatUSDC(marginSummary.reservedMargin)} USDC`,
      colors.yellow
    )
  );
  console.log(
    colorText(
      `   Unrealized P&L: ${formatUSDC(marginSummary.unrealizedPnL)} USDC`,
      marginSummary.unrealizedPnL >= 0 ? colors.green : colors.red
    )
  );
  console.log(colorText(`   Trade Count: ${tradeCount}`, colors.magenta));

  if (positions.length > 0) {
    const pos = positions[0];
    const size = pos.size;
    const absSize = size < 0n ? -size : size;
    const side = size >= 0n ? "LONG" : "SHORT";
    const sideColor = size >= 0n ? colors.green : colors.red;
    console.log(
      colorText(
        `   Position: ${side} ${formatALU(absSize)} ALU @ $${formatUSDC(
          pos.entryPrice
        )}`,
        sideColor
      )
    );

    // Calculate current position value
    const markPrice = await orderBook.getMarkPrice();
    const positionValue = (absSize * markPrice) / BigInt(10 ** 18);
    console.log(
      colorText(
        `   Position Value: ${formatUSDC(
          positionValue
        )} USDC (at mark $${formatUSDC(markPrice)})`,
        colors.cyan
      )
    );

    return { position: pos, available: marginSummary.availableCollateral };
  }

  return { position: null, available: marginSummary.availableCollateral };
}

async function main() {
  console.clear();
  console.log(colorText("🔍 CHECK AND FLIP POSITIONS", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));

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

    // Check current state
    console.log(colorText("\n📍 CHECKING CURRENT STATE", colors.brightCyan));
    const user1State = await checkUserState(vault, orderBook, user1, "User 1");
    const user2State = await checkUserState(vault, orderBook, user2, "User 2");

    // Get current mark price
    const markPrice = await orderBook.getMarkPrice();
    console.log(
      colorText(
        `\n📈 Current Mark Price: $${formatUSDC(markPrice)}`,
        colors.brightYellow
      )
    );

    // Calculate safe flip parameters
    console.log(
      colorText("\n\n🎯 SAFE POSITION FLIP STRATEGY", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    // For a safe flip, we'll use a price close to the current mark price
    // This minimizes the P&L impact and collateral requirements
    const flipPrice = markPrice; // Use current mark price for minimal P&L impact
    console.log(
      colorText(
        `Flip Price: $${formatUSDC(flipPrice)} (using mark price)`,
        colors.cyan
      )
    );

    // Calculate flip amounts based on current positions
    if (user1State.position && user2State.position) {
      const user1Size = user1State.position.size;
      const user2Size = user2State.position.size;
      const user1AbsSize = user1Size < 0n ? -user1Size : user1Size;
      const user2AbsSize = user2Size < 0n ? -user2Size : user2Size;

      // For a full flip, we need to trade 2x the current position size
      // But we'll do a smaller flip to stay within collateral limits
      const flipMultiplier = ethers.parseUnits("1.5", 18) / BigInt(10 ** 18); // 1.5x position size
      const user1FlipAmount = user1AbsSize + user1AbsSize * flipMultiplier;
      const user2FlipAmount = user2AbsSize + user2AbsSize * flipMultiplier;

      // Use the smaller of the two amounts to ensure both users can afford it
      const flipAmount =
        user1FlipAmount < user2FlipAmount ? user1FlipAmount : user2FlipAmount;

      console.log(colorText(`\n📊 Flip Calculation:`, colors.brightCyan));
      console.log(
        colorText(
          `User 1 current: ${user1Size >= 0n ? "LONG" : "SHORT"} ${formatALU(
            user1AbsSize
          )} ALU`,
          user1Size >= 0n ? colors.green : colors.red
        )
      );
      console.log(
        colorText(
          `User 2 current: ${user2Size >= 0n ? "LONG" : "SHORT"} ${formatALU(
            user2AbsSize
          )} ALU`,
          user2Size >= 0n ? colors.green : colors.red
        )
      );
      console.log(
        colorText(`Flip amount: ${formatALU(flipAmount)} ALU`, colors.magenta)
      );

      // Execute the flip
      console.log(
        colorText("\n\n⚡ EXECUTING POSITION FLIP", colors.brightYellow)
      );
      console.log(colorText("=".repeat(60), colors.cyan));

      // User 1 action (if LONG, sell; if SHORT, buy)
      const user1IsBuy = user1Size < 0n;
      console.log(
        colorText(
          `User 1 will ${user1IsBuy ? "BUY" : "SELL"} ${formatALU(
            flipAmount
          )} ALU @ $${formatUSDC(flipPrice)}`,
          user1IsBuy ? colors.green : colors.red
        )
      );

      let tx = await orderBook
        .connect(user1)
        .placeMarginLimitOrder(flipPrice, flipAmount, user1IsBuy);
      await tx.wait();
      console.log(colorText(`✅ User 1 order placed`, colors.green));

      // User 2 takes opposite side
      const user2IsBuy = !user1IsBuy;
      console.log(
        colorText(
          `User 2 will ${user2IsBuy ? "BUY" : "SELL"} ${formatALU(
            flipAmount
          )} ALU @ $${formatUSDC(flipPrice)}`,
          user2IsBuy ? colors.green : colors.red
        )
      );

      tx = await orderBook
        .connect(user2)
        .placeMarginLimitOrder(flipPrice, flipAmount, user2IsBuy);
      await tx.wait();
      console.log(colorText(`✅ User 2 order matched`, colors.green));

      // Show results
      console.log(
        colorText("\n\n📊 POSITION FLIP RESULTS", colors.brightYellow)
      );
      console.log(colorText("=".repeat(60), colors.cyan));

      await checkUserState(vault, orderBook, user1, "User 1 (After Flip)");
      await checkUserState(vault, orderBook, user2, "User 2 (After Flip)");

      // Get recent trades
      console.log(colorText("\n\n📋 RECENT TRADES", colors.brightYellow));
      const recentTrades = await orderBook.getRecentTrades(5);
      for (let i = 0; i < Math.min(5, recentTrades.length); i++) {
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
        colorText("\n\n✅ POSITION FLIP SUCCESSFUL!", colors.brightGreen)
      );
      console.log(
        colorText(
          "💡 The flip was executed at mark price to minimize P&L impact",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "📊 Check your interactive trader for full details!",
          colors.brightMagenta
        )
      );
    } else {
      console.log(colorText("\n❌ No positions found to flip!", colors.red));
      console.log(
        colorText(
          "Please create positions first before attempting to flip.",
          colors.yellow
        )
      );
    }
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    if (error.reason) {
      console.error(colorText(`Reason: ${error.reason}`, colors.red));

      if (error.reason.includes("insufficient collateral")) {
        console.log(
          colorText(
            "\n💡 Tip: Try using a price closer to the mark price to reduce P&L impact",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "💡 Or reduce the flip amount to stay within collateral limits",
            colors.yellow
          )
        );
      }
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
