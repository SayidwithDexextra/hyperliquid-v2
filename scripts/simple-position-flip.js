/**
 * 🔄 SIMPLE POSITION FLIP DEMONSTRATION
 * 
 * This script demonstrates position flipping using the current order book state.
 * It shows how a user can flip from LONG to SHORT or vice versa in a single trade.
 */

const { ethers } = require("hardhat");

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
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  return ethers.formatUnits(value, 6);
}

function formatALU(value) {
  return ethers.formatUnits(value, 18);
}

async function displayUserPositions(vault, orderBook, user, label) {
  try {
    const positions = await vault.getUserPositions(user.address);
    const marginSummary = await vault.getMarginSummary(user.address);
    const tradeCount = await orderBook.getUserTradeCount(user.address);
    
    console.log(colorText(`\n📊 ${label} Position State:`, colors.brightYellow));
    console.log(colorText(`   Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`, colors.blue));
    console.log(colorText(`   Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`, colors.green));
    console.log(colorText(`   Total Trades: ${tradeCount}`, colors.magenta));
    
    if (positions.length > 0) {
      for (const position of positions) {
        const size = position.size;
        const absSize = size < 0n ? -size : size;
        const side = size >= 0n ? "LONG" : "SHORT";
        const sideColor = size >= 0n ? colors.green : colors.red;
        
        console.log(colorText(`   Position: ${side} ${formatALU(absSize)} ALU @ $${formatUSDC(position.entryPrice)}`, sideColor));
      }
    } else {
      console.log(colorText(`   No open positions`, colors.cyan));
    }
  } catch (error) {
    console.log(colorText(`   Error: ${error.message}`, colors.red));
  }
}

async function main() {
  console.clear();
  console.log(colorText("🔄 SIMPLE POSITION FLIP DEMONSTRATION", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));
  
  try {
    // Get contracts from deployment
    const MockUSDC = await ethers.getContractAt("MockUSDC", "0x0B306BF915C4d645ff596e518fAf3F9669b97016");
    const vault = await ethers.getContractAt("CentralizedVault", "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1");
    const orderBook = await ethers.getContractAt("OrderBook", "0x2b961E3959b79326A8e7F64Ef0d2d825707669b5");
    
    const [deployer, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Display current positions
    console.log(colorText("\n📍 CURRENT POSITIONS", colors.brightCyan));
    await displayUserPositions(vault, orderBook, user1, "User 1");
    await displayUserPositions(vault, orderBook, user2, "User 2");
    
    // Clean up any existing positions first
    console.log(colorText("\n🧹 CLEANING UP EXISTING POSITIONS", colors.yellow));
    
    // Cancel all open orders
    const user1Orders = await orderBook.getUserOrders(user1.address);
    for (const order of user1Orders) {
      if (order.isActive) {
        await orderBook.connect(user1).cancelOrder(order.orderId);
        console.log(colorText(`   ✅ Cancelled User 1 order ${order.orderId}`, colors.green));
      }
    }
    
    const user2Orders = await orderBook.getUserOrders(user2.address);
    for (const order of user2Orders) {
      if (order.isActive) {
        await orderBook.connect(user2).cancelOrder(order.orderId);
        console.log(colorText(`   ✅ Cancelled User 2 order ${order.orderId}`, colors.green));
      }
    }
    
    // DEMONSTRATION: Position Flipping
    console.log(colorText("\n\n🎯 POSITION FLIP DEMONSTRATION", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));
    
    // Step 1: Create initial positions
    console.log(colorText("\n📍 STEP 1: CREATE INITIAL POSITIONS", colors.brightCyan));
    console.log(colorText("User 3 → LONG 30 ALU @ $15", colors.green));
    console.log(colorText("User 4 → SHORT 30 ALU @ $15", colors.red));
    
    const initialAmount = ethers.parseUnits("30", 18);
    const initialPrice = ethers.parseUnits("15", 6);
    
    // User 3 goes long
    let tx = await orderBook.connect(user3).placeMarginLimitOrder(
      initialPrice,
      initialAmount,
      true // isBuy
    );
    await tx.wait();
    
    // User 4 goes short (matches)
    tx = await orderBook.connect(user4).placeMarginLimitOrder(
      initialPrice,
      initialAmount,
      false // isBuy
    );
    await tx.wait();
    
    console.log(colorText("✅ Initial positions created", colors.green));
    await displayUserPositions(vault, orderBook, user3, "User 3");
    await displayUserPositions(vault, orderBook, user4, "User 4");
    
    // Step 2: Flip positions
    console.log(colorText("\n\n📍 STEP 2: FLIP POSITIONS", colors.brightCyan));
    console.log(colorText("User 3 will SELL 90 ALU @ $16", colors.magenta));
    console.log(colorText("This will:", colors.cyan));
    console.log(colorText("  - Close 30 ALU LONG (with $1/ALU profit)", colors.green));
    console.log(colorText("  - Open 60 ALU SHORT", colors.red));
    
    const flipAmount = ethers.parseUnits("90", 18);
    const flipPrice = ethers.parseUnits("16", 6);
    
    // User 3 sells 90 (closes 30 long, opens 60 short)
    tx = await orderBook.connect(user3).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      false // isBuy (sell)
    );
    await tx.wait();
    
    // User 4 buys 90 (closes 30 short, opens 60 long)
    tx = await orderBook.connect(user4).placeMarginLimitOrder(
      flipPrice,
      flipAmount,
      true // isBuy
    );
    await tx.wait();
    
    console.log(colorText("\n✅ POSITIONS FLIPPED!", colors.brightGreen));
    await displayUserPositions(vault, orderBook, user3, "User 3");
    await displayUserPositions(vault, orderBook, user4, "User 4");
    
    // Show trade history
    console.log(colorText("\n\n📈 TRADE HISTORY", colors.brightYellow));
    const user3TradeCount = await orderBook.getUserTradeCount(user3.address);
    const user4TradeCount = await orderBook.getUserTradeCount(user4.address);
    
    console.log(colorText(`User 3 executed ${user3TradeCount} trades`, colors.cyan));
    console.log(colorText(`User 4 executed ${user4TradeCount} trades`, colors.cyan));
    
    // Get recent trades
    const recentTrades = await orderBook.getRecentTrades(4);
    console.log(colorText("\n📋 Recent Trades:", colors.brightCyan));
    
    for (let i = 0; i < recentTrades.length; i++) {
      const trade = recentTrades[i];
      const buyer = trade.buyer === user3.address ? "User3" : "User4";
      const seller = trade.seller === user3.address ? "User3" : "User4";
      console.log(colorText(`   ${buyer} bought ${formatALU(trade.amount)} ALU from ${seller} @ $${formatUSDC(trade.price)}`, colors.white));
    }
    
    console.log(colorText("\n\n✅ POSITION FLIP COMPLETE!", colors.brightGreen));
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(colorText("💡 Key Insights:", colors.brightYellow));
    console.log(colorText("• Positions flipped from LONG→SHORT and SHORT→LONG", colors.cyan));
    console.log(colorText("• P&L was realized on the closed portions", colors.cyan));
    console.log(colorText("• All trades are recorded in the trade history", colors.cyan));
    console.log(colorText("• Run interactive trader to see full details!", colors.cyan));
    
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    console.error(error);
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
