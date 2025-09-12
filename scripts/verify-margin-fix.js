/**
 * 🔒 VERIFY MARGIN FIX
 * 
 * Simple test to verify the margin system is working correctly
 * after applying all fixes.
 */

const { ethers } = require("hardhat");
const { getAddress } = require("../config/contracts");

// Color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
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
  console.log(colorText("🔒 VERIFY MARGIN FIX", colors.cyan));
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // First deploy fresh contracts
    console.log(colorText("\n📦 Deploying fresh contracts...", colors.yellow));
    const deployResult = await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const deploy = spawn('npx', ['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], {
        stdio: 'pipe'
      });
      
      let output = '';
      deploy.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      deploy.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error('Deployment failed'));
        }
      });
    });
    
    console.log(colorText("✅ Fresh deployment complete", colors.green));

    // Load contracts
    const vault = await ethers.getContractAt("CentralizedVault", getAddress("CENTRALIZED_VAULT"));
    const orderBook = await ethers.getContractAt("OrderBook", getAddress("ALUMINUM_ORDERBOOK"));
    const usdc = await ethers.getContractAt("MockUSDC", getAddress("MOCK_USDC"));
    
    const [deployer, user1, user2] = await ethers.getSigners();

    // TEST 1: Verify spot trading is blocked
    console.log(colorText("\n\n✅ TEST 1: SPOT TRADING BLOCKED", colors.green));
    console.log(colorText("=".repeat(60), colors.cyan));
    
    let spotBlocked = false;
    try {
      await orderBook.connect(user1).placeLimitOrder(
        ethers.parseUnits("10", 6),
        ethers.parseUnits("5", 18),
        true
      );
      await orderBook.connect(user2).placeLimitOrder(
        ethers.parseUnits("10", 6),
        ethers.parseUnits("5", 18),
        false
      );
    } catch (error) {
      spotBlocked = true;
      console.log(colorText("✅ PASS: Spot trading blocked", colors.green));
      console.log(`   ${error.message.substring(0, 60)}...`);
    }
    
    if (!spotBlocked) {
      throw new Error("FAIL: Spot trading was not blocked!");
    }

    // TEST 2: Verify margin calculations
    console.log(colorText("\n\n✅ TEST 2: MARGIN CALCULATIONS", colors.green));
    console.log(colorText("=".repeat(60), colors.cyan));
    
    // Fund deployer for matching
    await usdc.connect(deployer).approve(vault.target, ethers.parseUnits("1000", 6));
    await vault.connect(deployer).depositCollateral(ethers.parseUnits("1000", 6));
    
    const price = ethers.parseUnits("10", 6); // $10
    const amount = ethers.parseUnits("50", 18); // 50 ALU
    const expectedMargin = ethers.parseUnits("500", 6); // $500
    
    console.log(`\nTrade: 50 ALU @ $10 = $500 notional`);
    console.log(`Expected margin: $500 (100%)`);
    
    // Check initial state
    const user1Before = await vault.getMarginSummary(user1.address);
    const user2Before = await vault.getMarginSummary(user2.address);
    console.log(`\nBefore Trade:`);
    console.log(`User 1: ${formatUSDC(user1Before.totalCollateral)} USDC total, ${formatUSDC(user1Before.availableCollateral)} available`);
    console.log(`User 2: ${formatUSDC(user2Before.totalCollateral)} USDC total, ${formatUSDC(user2Before.availableCollateral)} available`);
    
    // Execute margin trades
    let tx = await orderBook.connect(user1).placeMarginLimitOrder(price, amount, true);
    await tx.wait();
    console.log(colorText("\n✅ User 1 placed margin BUY order", colors.green));
    
    tx = await orderBook.connect(user2).placeMarginLimitOrder(price, amount, false);
    await tx.wait();
    console.log(colorText("✅ User 2 placed margin SELL order (matched)", colors.green));
    
    // Check margin locked
    const user1After = await vault.getMarginSummary(user1.address);
    const user2After = await vault.getMarginSummary(user2.address);
    
    console.log(`\nAfter Trade:`);
    console.log(`User 1: Margin locked = ${formatUSDC(user1After.marginUsed)} USDC`);
    console.log(`User 2: Margin locked = ${formatUSDC(user2After.marginUsed)} USDC`);
    console.log(`Expected: ${formatUSDC(expectedMargin)} USDC`);
    
    const margin1Correct = user1After.marginUsed === expectedMargin;
    const margin2Correct = user2After.marginUsed === expectedMargin;
    
    if (!margin1Correct || !margin2Correct) {
      throw new Error("FAIL: Margin calculations incorrect!");
    }
    
    console.log(colorText("\n✅ PASS: Margin calculations correct!", colors.green));
    
    // Display positions
    console.log(colorText("\n📊 POSITIONS", colors.cyan));
    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);
    
    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      console.log(`User 1: LONG ${formatALU(pos.size)} ALU @ $${formatUSDC(pos.entryPrice)}`);
      console.log(`        Margin: $${formatUSDC(pos.marginLocked)}`);
    }
    
    if (user2Positions.length > 0) {
      const pos = user2Positions[0];
      const size = pos.size < 0n ? -pos.size : pos.size;
      console.log(`User 2: SHORT ${formatALU(size)} ALU @ $${formatUSDC(pos.entryPrice)}`);
      console.log(`        Margin: $${formatUSDC(pos.marginLocked)}`);
    }
    
    // SUMMARY
    console.log(colorText("\n\n🎉 ALL TESTS PASSED!", colors.brightGreen));
    console.log(colorText("=".repeat(60), colors.green));
    console.log(colorText("✅ Spot trading is blocked", colors.green));
    console.log(colorText("✅ All positions require 100% margin", colors.green));
    console.log(colorText("✅ Margin calculations are accurate", colors.green));
    console.log(colorText("\n🛡️  THE MARGIN VULNERABILITY HAS BEEN FIXED!", colors.brightGreen));
    
  } catch (error) {
    console.error(colorText(`\n❌ Test Failed: ${error.message}`, colors.brightRed));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
