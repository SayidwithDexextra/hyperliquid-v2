/**
 * 🧪 AUTOMATED POSITION NETTING TEST WITH REAL TRADES
 *
 * This script automatically demonstrates position netting by executing real trades that will:
 * 1. Show up in your trade history
 * 2. Create actual positions
 * 3. Demonstrate partial closing, full closing, and position flipping
 * 4. Generate real P&L
 *
 * All trades are recorded on-chain and viewable in the interactive trader!
 * No user interaction required - the test runs automatically.
 */

const { ethers } = require("hardhat");
const { getContract, getAddress } = require("../config/contracts");

// Color codes for better visualization
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
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatUSDC(amount) {
  return ethers.formatUnits(amount, 6);
}

function formatALU(amount) {
  return ethers.formatUnits(amount, 18);
}

async function displayUserState(contracts, user, label) {
  try {
    const balance = await contracts.mockUSDC.balanceOf(user.address);
    const marginSummary = await contracts.vault.getMarginSummary(user.address);
    const positions = await contracts.vault.getUserPositions(user.address);
    const tradeCount = await contracts.orderBook.getUserTradeCount(
      user.address
    );

    console.log(colorText(`\n📊 ${label} State:`, colors.brightYellow));
    console.log(colorText(`   Address: ${user.address}`, colors.cyan));
    console.log(
      colorText(`   USDC Balance: ${formatUSDC(balance)} USDC`, colors.green)
    );
    console.log(
      colorText(
        `   Total Collateral: ${formatUSDC(
          marginSummary.totalCollateral
        )} USDC`,
        colors.blue
      )
    );
    console.log(
      colorText(
        `   Available Collateral: ${formatUSDC(
          marginSummary.availableCollateral
        )} USDC`,
        colors.green
      )
    );
    console.log(colorText(`   Total Trades: ${tradeCount}`, colors.magenta));

    if (positions.length > 0) {
      console.log(colorText(`   Positions:`, colors.brightCyan));
      for (const position of positions) {
        const size = BigInt(position.size.toString());
        const absSize = size >= 0n ? size : -size;
        const side = size >= 0n ? "LONG" : "SHORT";
        const sideColor = size >= 0n ? colors.green : colors.red;
        const entryPrice = formatUSDC(position.entryPrice);

        console.log(
          colorText(
            `     - ${side} ${formatALU(absSize)} ALU @ $${entryPrice}`,
            sideColor
          )
        );
      }
    } else {
      console.log(colorText(`   No open positions`, colors.dim));
    }
  } catch (error) {
    console.log(
      colorText(`   Error reading state: ${error.message}`, colors.red)
    );
  }
}

async function displayOrderBook(orderBook) {
  try {
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    console.log(colorText("\n📖 Order Book State:", colors.brightCyan));
    console.log(colorText(`   Buy Orders: ${buyCount}`, colors.green));
    console.log(colorText(`   Sell Orders: ${sellCount}`, colors.red));

    if (bestBid > 0) {
      console.log(
        colorText(`   Best Bid: $${formatUSDC(bestBid)}`, colors.green)
      );
    } else {
      console.log(colorText(`   Best Bid: No bids`, colors.dim));
    }

    if (bestAsk < ethers.MaxUint256) {
      console.log(
        colorText(`   Best Ask: $${formatUSDC(bestAsk)}`, colors.red)
      );
    } else {
      console.log(colorText(`   Best Ask: No asks`, colors.dim));
    }
  } catch (error) {
    console.log(
      colorText(`   Error reading order book: ${error.message}`, colors.red)
    );
  }
}

async function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  console.log(
    colorText(
      "🧪 AUTOMATED POSITION NETTING TEST WITH REAL TRADES",
      colors.brightYellow
    )
  );
  console.log(colorText("=".repeat(80), colors.cyan));
  console.log(
    colorText(
      "This test will automatically execute real trades that appear in your trade history!",
      colors.brightGreen
    )
  );
  console.log(
    colorText(
      "All positions and P&L are real and verifiable in the interactive trader.",
      colors.cyan
    )
  );
  console.log(
    colorText(
      "No user interaction required - sit back and watch!",
      colors.brightMagenta
    )
  );

  try {
    // Load contracts
    console.log(colorText("\n🔧 Loading contracts...", colors.yellow));
    const contracts = {
      mockUSDC: await getContract("MOCK_USDC"),
      vault: await getContract("CENTRALIZED_VAULT"),
      orderBook: await getContract("ALUMINUM_ORDERBOOK"),
      router: await getContract("TRADING_ROUTER"),
    };
    console.log(colorText("✅ Contracts loaded", colors.green));

    // Get signers
    const [deployer, user1, user2] = await ethers.getSigners();

    // Display initial state
    console.log(colorText("\n📊 INITIAL STATE", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    await displayUserState(contracts, user1, "User 1");
    await displayUserState(contracts, user2, "User 2");
    await displayOrderBook(contracts.orderBook);

    // Auto-proceed after showing initial state
    console.log(
      colorText(
        "\n🚀 Starting automated position netting test in 3 seconds...",
        colors.brightGreen
      )
    );
    await pause(3000);

    // TEST 1: Opening Initial Positions
    console.log(
      colorText("\n\n📍 TEST 1: OPENING INITIAL POSITIONS", colors.brightYellow)
    );
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(colorText("User 1 will go LONG 50 ALU @ $10", colors.green));
    console.log(colorText("User 2 will go SHORT 50 ALU @ $10", colors.red));
    console.log(
      colorText(
        "Position value: $500 each (within $1000 collateral limit)",
        colors.cyan
      )
    );

    // Place matching orders
    const initialPrice = ethers.parseUnits("10", 6); // $10
    const initialAmount = ethers.parseUnits("50", 18); // 50 ALU

    console.log(colorText("\n⏳ Placing orders...", colors.yellow));

    // User1 places buy order
    let tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      initialPrice,
      initialAmount,
      true // isBuy
    );
    await tx.wait();
    console.log(colorText("✅ User 1 buy order placed", colors.green));

    // User2 places sell order (should match immediately)
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      initialPrice,
      initialAmount,
      false // isSell
    );
    await tx.wait();
    console.log(
      colorText(
        "✅ User 2 sell order placed (should match with User 1)",
        colors.green
      )
    );

    // Display state after initial trades
    await displayUserState(contracts, user1, "User 1");
    await displayUserState(contracts, user2, "User 2");

    console.log(
      colorText(
        "\n⏳ Continuing to partial closing test in 2 seconds...",
        colors.cyan
      )
    );
    await pause(2000);

    // TEST 2: Partial Position Closing
    console.log(
      colorText(
        "\n\n📍 TEST 2: PARTIAL POSITION CLOSING (NETTING)",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(
      colorText("User 1 will close 20 ALU of their 50 ALU LONG", colors.green)
    );
    console.log(
      colorText("User 2 will close 20 ALU of their 50 ALU SHORT", colors.red)
    );

    const partialAmount = ethers.parseUnits("20", 18); // 20 ALU

    console.log(
      colorText("\n⏳ Placing partial close orders...", colors.yellow)
    );

    // User1 sells 40 ALU to partially close long
    tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      initialPrice,
      partialAmount,
      false // sell to close long
    );
    await tx.wait();
    console.log(
      colorText("✅ User 1 partial close order placed", colors.green)
    );

    // User2 buys 40 ALU to partially close short
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      initialPrice,
      partialAmount,
      true // buy to close short
    );
    await tx.wait();
    console.log(
      colorText("✅ User 2 partial close order placed", colors.green)
    );

    // Display state after partial closing
    console.log(
      colorText(
        "\n📊 After partial closing (positions should be 30 ALU each):",
        colors.brightCyan
      )
    );
    await displayUserState(contracts, user1, "User 1");
    await displayUserState(contracts, user2, "User 2");

    console.log(
      colorText(
        "\n⏳ Continuing to position flip test in 2 seconds...",
        colors.cyan
      )
    );
    await pause(2000);

    // TEST 3: Position Flipping
    console.log(
      colorText("\n\n📍 TEST 3: POSITION FLIPPING", colors.brightYellow)
    );
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(
      colorText(
        "User 1 will sell 40 ALU (closes 30 LONG, opens 10 SHORT)",
        colors.magenta
      )
    );
    console.log(
      colorText(
        "User 2 will buy 40 ALU (closes 30 SHORT, opens 10 LONG)",
        colors.magenta
      )
    );

    const flipAmount = ethers.parseUnits("40", 18); // 40 ALU
    const flipPrice = ethers.parseUnits("10", 6); // $10 (same price to reduce margin requirement)

    console.log(
      colorText("\n⏳ Placing position flip orders...", colors.yellow)
    );

    // User1 sells 120 ALU (flips from long to short)
    tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      false // sell
    );
    await tx.wait();
    console.log(colorText("✅ User 1 flip order placed", colors.green));

    // User2 buys 120 ALU (flips from short to long)
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      true // buy
    );
    await tx.wait();
    console.log(colorText("✅ User 2 flip order placed", colors.green));

    // Display state after flipping
    console.log(colorText("\n📊 After position flipping:", colors.brightCyan));
    await displayUserState(contracts, user1, "User 1");
    await displayUserState(contracts, user2, "User 2");

    console.log(
      colorText(
        "\n⏳ Continuing to final position closing in 2 seconds...",
        colors.cyan
      )
    );
    await pause(2000);

    // TEST 4: Close All Positions
    console.log(
      colorText("\n\n📍 TEST 4: CLOSE ALL POSITIONS", colors.brightYellow)
    );
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(
      colorText("Both users will close their 10 ALU positions", colors.cyan)
    );

    const closeAmount = ethers.parseUnits("10", 18); // 10 ALU
    const closePrice = ethers.parseUnits("10", 6); // $10

    console.log(colorText("\n⏳ Placing final close orders...", colors.yellow));

    // User1 buys 60 ALU to close short
    tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      closePrice,
      closeAmount,
      true // buy to close short
    );
    await tx.wait();
    console.log(colorText("✅ User 1 close order placed", colors.green));

    // User2 sells 60 ALU to close long
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      closePrice,
      closeAmount,
      false // sell to close long
    );
    await tx.wait();
    console.log(colorText("✅ User 2 close order placed", colors.green));

    // Display final state
    console.log(
      colorText(
        "\n📊 FINAL STATE (all positions should be closed):",
        colors.brightCyan
      )
    );
    await displayUserState(contracts, user1, "User 1");
    await displayUserState(contracts, user2, "User 2");
    await displayOrderBook(contracts.orderBook);

    // Display trade summary
    console.log(colorText("\n\n📈 TRADE SUMMARY", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));

    const user1TradeCount = await contracts.orderBook.getUserTradeCount(
      user1.address
    );
    const user2TradeCount = await contracts.orderBook.getUserTradeCount(
      user2.address
    );

    console.log(
      colorText(`User 1 Total Trades: ${user1TradeCount}`, colors.green)
    );
    console.log(
      colorText(`User 2 Total Trades: ${user2TradeCount}`, colors.green)
    );

    // Get recent trades to show
    console.log(colorText("\n📋 Recent Trades (last 5):", colors.brightCyan));
    const recentTrades = await contracts.orderBook.getRecentTrades(5);

    for (let i = 0; i < recentTrades.length; i++) {
      const trade = recentTrades[i];
      const buyer =
        trade.buyer === user1.address
          ? "User1"
          : trade.buyer === user2.address
          ? "User2"
          : "Other";
      const seller =
        trade.seller === user1.address
          ? "User1"
          : trade.seller === user2.address
          ? "User2"
          : "Other";
      const amount = formatALU(trade.amount);
      const price = formatUSDC(trade.price);

      console.log(
        colorText(
          `   Trade ${
            i + 1
          }: ${buyer} bought ${amount} ALU from ${seller} @ $${price}`,
          colors.white
        )
      );
    }

    console.log(
      colorText("\n\n✅ POSITION NETTING TEST COMPLETE!", colors.brightGreen)
    );
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(
      colorText(
        "🎉 All trades have been executed and recorded on-chain!",
        colors.brightYellow
      )
    );
    console.log(
      colorText(
        "📊 You can now check your trade history in the interactive trader!",
        colors.brightCyan
      )
    );
    console.log(
      colorText("💡 Run: node scripts/interactive-trader.js", colors.yellow)
    );
    console.log(
      colorText(
        "    Then select option 12 to view your trade history",
        colors.yellow
      )
    );
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    console.error(colorText(`Stack: ${error.stack}`, colors.dim));
  }

  process.exit(0);
}

// Execute
main().catch(console.error);
