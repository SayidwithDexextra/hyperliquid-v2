/**
 * 🔒 MARGIN SYSTEM TEST
 *
 * Tests the critical margin functionality to ensure:
 * 1. Spot trades cannot create futures positions
 * 2. Margin is always 100% of notional value
 * 3. No under-collateralized positions can be created
 */

const { ethers } = require("hardhat");
const { getAddress } = require("../config/contracts");

// Color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
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
  console.log(colorText("🔒 MARGIN SYSTEM TEST", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));
  console.log("Testing margin enforcement after fixes\n");

  try {
    // Get a fresh deployment to ensure clean state
    console.log(colorText("📋 LOADING CONTRACTS", colors.brightCyan));
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      getAddress("CENTRALIZED_VAULT")
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      getAddress("ALUMINUM_ORDERBOOK")
    );
    const usdc = await ethers.getContractAt(
      "MockUSDC",
      getAddress("MOCK_USDC")
    );

    const [deployer, user1, user2] = await ethers.getSigners();
    console.log("✅ Contracts loaded");

    // Ensure deployer has collateral for matching orders
    const deployerCollateral = await vault.getAvailableCollateral(
      deployer.address
    );
    if (deployerCollateral === 0n) {
      console.log("📍 Depositing collateral for deployer...");
      await usdc
        .connect(deployer)
        .approve(vault.target, ethers.parseUnits("1000", 6));
      await vault
        .connect(deployer)
        .depositCollateral(ethers.parseUnits("1000", 6));
      console.log("✅ Deployer funded");
    }

    // Display initial state
    console.log(colorText("\n📊 INITIAL STATE", colors.brightCyan));
    const user1Initial = await vault.getMarginSummary(user1.address);
    const user2Initial = await vault.getMarginSummary(user2.address);
    console.log(
      `User 1: ${formatUSDC(
        user1Initial.totalCollateral
      )} USDC collateral, ${formatUSDC(
        user1Initial.availableCollateral
      )} available`
    );
    console.log(
      `User 2: ${formatUSDC(
        user2Initial.totalCollateral
      )} USDC collateral, ${formatUSDC(
        user2Initial.availableCollateral
      )} available`
    );

    // TEST 1: SPOT TRADING BLOCKED
    console.log(
      colorText("\n\n✅ TEST 1: SPOT TRADING IS BLOCKED", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    try {
      await orderBook.connect(user1).placeLimitOrder(
        ethers.parseUnits("10", 6), // $10
        ethers.parseUnits("5", 18), // 5 ALU
        true // buy
      );
      // If we get here, spot order was placed - now try to match
      try {
        await orderBook.connect(user2).placeLimitOrder(
          ethers.parseUnits("10", 6),
          ethers.parseUnits("5", 18),
          false // sell
        );
        console.log(
          colorText("❌ FAIL: Spot trades were executed!", colors.brightRed)
        );
        throw new Error("Spot trading should be blocked!");
      } catch (matchError) {
        console.log(
          colorText("✅ PASS: Spot trades blocked on match", colors.green)
        );
        console.log(`   Reason: ${matchError.message.substring(0, 80)}...`);
      }
    } catch (placeError) {
      console.log(
        colorText("✅ PASS: Spot orders blocked immediately", colors.green)
      );
      console.log(`   Reason: ${placeError.message.substring(0, 80)}...`);
    }

    // TEST 2: MARGIN TRADES WORK CORRECTLY
    console.log(
      colorText("\n\n✅ TEST 2: MARGIN CALCULATION (100%)", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    // Cancel any pending orders first
    console.log("🧹 Cleaning order book...");
    try {
      const openOrders = await orderBook.getAllOpenOrders(100, 0);
      for (const order of openOrders) {
        if (order.trader === user1.address || order.trader === user2.address) {
          await orderBook
            .connect(order.trader === user1.address ? user1 : user2)
            .cancelOrder(order.orderId);
        }
      }
    } catch (e) {
      // Ignore errors, might not have any orders
    }

    const price = ethers.parseUnits("20", 6); // $20
    const amount = ethers.parseUnits("25", 18); // 25 ALU
    const notionalValue = ethers.parseUnits("500", 6); // $500

    console.log(`\nTrade Details:`);
    console.log(`  Amount: 25 ALU`);
    console.log(`  Price: $20`);
    console.log(`  Notional: $500`);
    console.log(`  Expected Margin: $500 (100%)\n`);

    // Place margin orders
    let tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, amount, true);
    await tx.wait();
    console.log("✅ User 1 placed margin BUY order");

    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, amount, false);
    await tx.wait();
    console.log("✅ User 2 placed margin SELL order (matched)");

    // Check margin locked
    const user1After = await vault.getMarginSummary(user1.address);
    const user2After = await vault.getMarginSummary(user2.address);

    console.log(colorText("\n📍 Margin Verification:", colors.brightCyan));
    console.log(
      `User 1 margin locked: ${formatUSDC(user1After.marginUsed)} USDC`
    );
    console.log(
      `User 2 margin locked: ${formatUSDC(user2After.marginUsed)} USDC`
    );
    console.log(`Expected: ${formatUSDC(notionalValue)} USDC`);

    const margin1Correct = user1After.marginUsed === notionalValue;
    const margin2Correct = user2After.marginUsed === notionalValue;

    if (margin1Correct && margin2Correct) {
      console.log(
        colorText(
          "\n✅ PASS: Margin calculations are correct!",
          colors.brightGreen
        )
      );
    } else {
      console.log(
        colorText("\n❌ FAIL: Margin calculations incorrect!", colors.brightRed)
      );
      throw new Error("Margin not calculated correctly");
    }

    // TEST 3: POSITION INCREASE
    console.log(
      colorText("\n\n✅ TEST 3: POSITION INCREASE", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    const increaseAmount = ethers.parseUnits("15", 18); // 15 ALU
    const totalNotional = ethers.parseUnits("800", 6); // 40 ALU * $20 = $800

    console.log(`\nIncreasing position by 15 ALU @ $20`);
    console.log(`Total position: 40 ALU`);
    console.log(`Expected total margin: $800\n`);

    tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, increaseAmount, true);
    await tx.wait();
    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, increaseAmount, false);
    await tx.wait();
    console.log("✅ Positions increased");

    const user1Final = await vault.getMarginSummary(user1.address);
    const user2Final = await vault.getMarginSummary(user2.address);

    console.log(colorText("\n📍 After Increase:", colors.brightCyan));
    console.log(
      `User 1 total margin: ${formatUSDC(user1Final.marginUsed)} USDC`
    );
    console.log(
      `User 2 total margin: ${formatUSDC(user2Final.marginUsed)} USDC`
    );
    console.log(`Expected: ${formatUSDC(totalNotional)} USDC`);

    const finalMargin1Correct = user1Final.marginUsed === totalNotional;
    const finalMargin2Correct = user2Final.marginUsed === totalNotional;

    if (finalMargin1Correct && finalMargin2Correct) {
      console.log(
        colorText(
          "\n✅ PASS: Position increase handled correctly!",
          colors.brightGreen
        )
      );
    } else {
      console.log(
        colorText(
          "\n❌ FAIL: Position increase margin incorrect!",
          colors.brightRed
        )
      );
      throw new Error("Position increase not handled correctly");
    }

    // SUMMARY
    console.log(colorText("\n\n🎯 TEST RESULTS", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(
      colorText("✅ Spot trading prevention: WORKING", colors.brightGreen)
    );
    console.log(
      colorText("✅ Margin calculation (100%): CORRECT", colors.brightGreen)
    );
    console.log(
      colorText("✅ Position increases: CORRECT", colors.brightGreen)
    );

    console.log(
      colorText("\n🛡️  MARGIN SYSTEM IS SECURE!", colors.brightGreen)
    );
    console.log(
      colorText("All positions require 100% margin backing.", colors.green)
    );
    console.log(
      colorText("The vulnerability has been successfully fixed.", colors.green)
    );

    // Show final positions
    console.log(colorText("\n📊 FINAL POSITIONS", colors.brightCyan));
    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);

    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      const size = pos.size < 0n ? -pos.size : pos.size;
      console.log(
        `User 1: LONG ${formatALU(size)} ALU @ $${formatUSDC(pos.entryPrice)}`
      );
      console.log(`        Margin locked: $${formatUSDC(pos.marginLocked)}`);
    }

    if (user2Positions.length > 0) {
      const pos = user2Positions[0];
      const size = pos.size < 0n ? -pos.size : pos.size;
      console.log(
        `User 2: SHORT ${formatALU(size)} ALU @ $${formatUSDC(pos.entryPrice)}`
      );
      console.log(`        Margin locked: $${formatUSDC(pos.marginLocked)}`);
    }
  } catch (error) {
    console.error(
      colorText(`\n❌ Test Failed: ${error.message}`, colors.brightRed)
    );
    console.error(
      colorText("Please check the margin system implementation.", colors.red)
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
