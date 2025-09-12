/**
 * 🔄 ADVANCED POSITION FLIPPING DEMONSTRATION
 * 
 * This script demonstrates advanced position flipping scenarios:
 * 1. Uses the current state of the order book (no reset)
 * 2. Shows complete position reversal (LONG → SHORT and vice versa)
 * 3. Demonstrates P&L calculation during position flips
 * 4. Shows how margin is handled during flips
 * 
 * All trades are executed automatically and recorded on-chain!
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
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  dim: "\x1b[2m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  return ethers.formatUnits(value, 6);
}

function formatALU(value) {
  return ethers.formatUnits(value, 18);
}

async function displayPositionDetails(contracts, user, label) {
  try {
    const balance = await contracts.usdc.balanceOf(user.address);
    const marginSummary = await contracts.vault.getMarginSummary(user.address);
    const positions = await contracts.vault.getUserPositions(user.address);
    const tradeCount = await contracts.orderBook.getUserTradeCount(user.address);
    
    console.log(colorText(`\n📊 ${label} Current State:`, colors.brightYellow));
    console.log(colorText(`   Address: ${user.address}`, colors.cyan));
    console.log(colorText(`   USDC Balance: ${formatUSDC(balance)} USDC`, colors.green));
    console.log(colorText(`   Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`, colors.blue));
    console.log(colorText(`   Reserved Margin: ${formatUSDC(marginSummary.reservedMargin)} USDC`, colors.yellow));
    console.log(colorText(`   Available Collateral: ${formatUSDC(marginSummary.availableCollateral)} USDC`, colors.green));
    console.log(colorText(`   Unrealized P&L: ${formatUSDC(marginSummary.unrealizedPnL)} USDC`, 
      marginSummary.unrealizedPnL >= 0 ? colors.brightGreen : colors.brightRed));
    console.log(colorText(`   Total Trades: ${tradeCount}`, colors.magenta));
    
    if (positions.length > 0) {
      console.log(colorText(`   Positions:`, colors.brightCyan));
      for (const position of positions) {
        const size = position.size;
        const absSize = size < 0n ? -size : size;
        const side = size >= 0n ? "LONG" : "SHORT";
        const sideColor = size >= 0n ? colors.green : colors.red;
        const entryPrice = formatUSDC(position.entryPrice);
        const markPrice = await contracts.orderBook.getMarkPrice();
        const currentValue = (absSize * markPrice) / BigInt(10**18);
        const entryValue = (absSize * position.entryPrice) / BigInt(10**18);
        const pnl = size > 0n ? currentValue - entryValue : entryValue - currentValue;
        
        console.log(colorText(`     - ${side} ${formatALU(absSize)} ALU`, sideColor));
        console.log(colorText(`       Entry Price: $${entryPrice}`, colors.white));
        console.log(colorText(`       Mark Price: $${formatUSDC(markPrice)}`, colors.white));
        console.log(colorText(`       Position P&L: $${formatUSDC(pnl)}`, 
          pnl >= 0 ? colors.brightGreen : colors.brightRed));
      }
    } else {
      console.log(colorText(`   No open positions`, colors.dim));
    }
  } catch (error) {
    console.log(colorText(`   Error reading state: ${error.message}`, colors.red));
  }
}

async function displayOrderBookSummary(orderBook) {
  try {
    const buyCount = await orderBook.getBuyOrderCount();
    const sellCount = await orderBook.getSellOrderCount();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.getMarkPrice();
    
    console.log(colorText("\n📖 Order Book Summary:", colors.brightCyan));
    console.log(colorText(`   Buy Orders: ${buyCount}`, colors.green));
    console.log(colorText(`   Sell Orders: ${sellCount}`, colors.red));
    console.log(colorText(`   Mark Price: $${formatUSDC(markPrice)}`, colors.brightYellow));
    
    if (bestBid > 0) {
      console.log(colorText(`   Best Bid: $${formatUSDC(bestBid)}`, colors.green));
    } else {
      console.log(colorText(`   Best Bid: No bids`, colors.dim));
    }
    
    if (bestAsk < ethers.MaxUint256) {
      console.log(colorText(`   Best Ask: $${formatUSDC(bestAsk)}`, colors.red));
    } else {
      console.log(colorText(`   Best Ask: No asks`, colors.dim));
    }
  } catch (error) {
    console.log(colorText(`   Error reading order book: ${error.message}`, colors.red));
  }
}

async function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  console.log(colorText("🔄 ADVANCED POSITION FLIPPING DEMONSTRATION", colors.brightYellow));
  console.log(colorText("=".repeat(80), colors.cyan));
  console.log(colorText("This demo shows complete position reversals with real P&L tracking!", colors.brightGreen));
  console.log(colorText("Working with the current order book state - no reset!", colors.brightMagenta));
  
  try {
    // Load contracts
    const contracts = {
      usdc: await getContract("MockUSDC"),
      vault: await getContract("CentralizedVault"),
      factory: await getContract("FuturesMarketFactory"),
      orderBook: await getContract("AluminumOrderBook"),
    };
    console.log(colorText("✅ Contracts loaded", colors.green));
    
    // Get signers
    const [deployer, user1, user2, user3] = await ethers.getSigners();
    
    // Display current state
    console.log(colorText("\n📊 CURRENT STATE", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    await displayPositionDetails(contracts, user1, "User 1");
    await displayPositionDetails(contracts, user2, "User 2");
    await displayOrderBookSummary(contracts.orderBook);
    
    console.log(colorText("\n🚀 Starting position flip demonstration in 3 seconds...", colors.brightGreen));
    await pause(3000);
    
    // SCENARIO 1: User 1 creates a fresh LONG position
    console.log(colorText("\n\n🎯 SCENARIO 1: CREATING INITIAL LONG POSITION", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(colorText("User 1 will open a LONG position of 25 ALU @ $12", colors.green));
    console.log(colorText("This establishes our baseline for the flip demonstration", colors.cyan));
    
    const initialAmount = ethers.parseUnits("25", 18);
    const initialPrice = ethers.parseUnits("12", 6);
    
    console.log(colorText("\n⏳ Placing initial long order...", colors.yellow));
    
    // User 1 places buy order
    let tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      true, // isBuy
      initialPrice,
      initialAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 1 buy order placed", colors.green));
    
    // User 2 fills with sell order
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      false, // isBuy
      initialPrice,
      initialAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 2 sell order matched", colors.green));
    
    await displayPositionDetails(contracts, user1, "User 1");
    await displayPositionDetails(contracts, user2, "User 2");
    
    console.log(colorText("\n⏳ Preparing for position flip in 3 seconds...", colors.cyan));
    await pause(3000);
    
    // SCENARIO 2: Complete Position Flip (LONG → SHORT)
    console.log(colorText("\n\n🔄 SCENARIO 2: COMPLETE POSITION FLIP (LONG → SHORT)", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(colorText("User 1 will SELL 75 ALU @ $13", colors.magenta));
    console.log(colorText("This will:", colors.cyan));
    console.log(colorText("  1. Close the 25 ALU LONG position (with profit)", colors.green));
    console.log(colorText("  2. Open a 50 ALU SHORT position", colors.red));
    console.log(colorText("User 2 will take the opposite side", colors.blue));
    
    const flipAmount = ethers.parseUnits("75", 18);
    const flipPrice = ethers.parseUnits("13", 6); // Higher price for profit on long close
    
    console.log(colorText("\n⏳ Executing position flip...", colors.yellow));
    
    // User 1 sells 75 ALU (closes 25 long, opens 50 short)
    tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      false, // isBuy (sell)
      flipPrice,
      flipAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 1 flip order placed (SELL 75 ALU)", colors.green));
    
    // User 2 buys 75 ALU (closes 25 short, opens 50 long)
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      true, // isBuy
      flipPrice,
      flipAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 2 counter-flip order matched (BUY 75 ALU)", colors.green));
    
    console.log(colorText("\n📊 After Position Flip:", colors.brightCyan));
    await displayPositionDetails(contracts, user1, "User 1");
    await displayPositionDetails(contracts, user2, "User 2");
    
    console.log(colorText("\n⏳ Preparing for reverse flip in 3 seconds...", colors.cyan));
    await pause(3000);
    
    // SCENARIO 3: Reverse Flip (SHORT → LONG)
    console.log(colorText("\n\n🔄 SCENARIO 3: REVERSE FLIP (SHORT → LONG)", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(colorText("User 1 will BUY 100 ALU @ $11", colors.magenta));
    console.log(colorText("This will:", colors.cyan));
    console.log(colorText("  1. Close the 50 ALU SHORT position (with profit)", colors.green));
    console.log(colorText("  2. Open a 50 ALU LONG position", colors.green));
    
    const reverseAmount = ethers.parseUnits("100", 18);
    const reversePrice = ethers.parseUnits("11", 6); // Lower price for profit on short close
    
    console.log(colorText("\n⏳ Executing reverse flip...", colors.yellow));
    
    // User 1 buys 100 ALU (closes 50 short, opens 50 long)
    tx = await contracts.orderBook.connect(user1).placeMarginLimitOrder(
      true, // isBuy
      reversePrice,
      reverseAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 1 reverse flip order placed (BUY 100 ALU)", colors.green));
    
    // User 2 sells 100 ALU (closes 50 long, opens 50 short)
    tx = await contracts.orderBook.connect(user2).placeMarginLimitOrder(
      false, // isBuy (sell)
      reversePrice,
      reverseAmount
    );
    await tx.wait();
    console.log(colorText("✅ User 2 counter order matched (SELL 100 ALU)", colors.green));
    
    console.log(colorText("\n📊 After Reverse Flip:", colors.brightCyan));
    await displayPositionDetails(contracts, user1, "User 1");
    await displayPositionDetails(contracts, user2, "User 2");
    
    // Display trade summary
    console.log(colorText("\n\n📈 POSITION FLIP SUMMARY", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));
    
    const user1TradeCount = await contracts.orderBook.getUserTradeCount(user1.address);
    const user2TradeCount = await contracts.orderBook.getUserTradeCount(user2.address);
    
    console.log(colorText(`User 1 Total Trades: ${user1TradeCount}`, colors.green));
    console.log(colorText(`User 2 Total Trades: ${user2TradeCount}`, colors.green));
    
    // Get recent trades
    console.log(colorText("\n📋 Recent Trades (showing flips):", colors.brightCyan));
    const recentTrades = await contracts.orderBook.getRecentTrades(6);
    
    for (let i = 0; i < recentTrades.length; i++) {
      const trade = recentTrades[i];
      const buyer = trade.buyer === user1.address ? "User1" : trade.buyer === user2.address ? "User2" : "Other";
      const seller = trade.seller === user1.address ? "User1" : trade.seller === user2.address ? "User2" : "Other";
      const amount = formatALU(trade.amount);
      const price = formatUSDC(trade.price);
      
      console.log(colorText(`   Trade ${i + 1}: ${buyer} bought ${amount} ALU from ${seller} @ $${price}`, colors.white));
    }
    
    console.log(colorText("\n\n✅ ADVANCED POSITION FLIP DEMONSTRATION COMPLETE!", colors.brightGreen));
    console.log(colorText("=".repeat(80), colors.cyan));
    console.log(colorText("🎯 Key Takeaways:", colors.brightYellow));
    console.log(colorText("   • Positions can be completely reversed in a single trade", colors.cyan));
    console.log(colorText("   • P&L is realized when closing the original position", colors.cyan));
    console.log(colorText("   • New position is opened at the execution price", colors.cyan));
    console.log(colorText("   • Margin requirements adjust automatically", colors.cyan));
    console.log(colorText("\n💡 Check the interactive trader to see all trades and P&L!", colors.yellow));
    console.log(colorText("   Run: npx hardhat run scripts/interactive-trader.js --network localhost", colors.yellow));
    
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    console.error(colorText(`Stack: ${error.stack}`, colors.dim));
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
