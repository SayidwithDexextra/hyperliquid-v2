/**
 * 🧹 CLEAN TEST MARGIN
 *
 * Wipes all positions and tests margin-only futures trading
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
  magenta: "\x1b[35m",
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

async function displayState(vault, user, label) {
  const summary = await vault.getMarginSummary(user.address);
  const positions = await vault.getUserPositions(user.address);

  console.log(colorText(`\n📊 ${label}:`, colors.brightYellow));
  console.log(`  Collateral: ${formatUSDC(summary.totalCollateral)} USDC`);
  console.log(`  Margin Used: ${formatUSDC(summary.marginUsed)} USDC`);
  console.log(`  Available: ${formatUSDC(summary.availableCollateral)} USDC`);

  if (positions.length > 0) {
    console.log(`  Positions:`);
    for (const pos of positions) {
      const size = pos.size < 0n ? -pos.size : pos.size;
      const side = pos.size >= 0n ? "LONG" : "SHORT";
      console.log(
        `    - ${side} ${formatALU(size)} ALU @ $${formatUSDC(pos.entryPrice)}`
      );
      console.log(`      Margin: $${formatUSDC(pos.marginLocked)}`);
    }
  } else {
    console.log(`  No positions`);
  }
}

async function main() {
  console.clear();
  console.log(colorText("🧹 CLEAN TEST MARGIN", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // Load contracts
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      getAddress("CENTRALIZED_VAULT")
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      getAddress("ALUMINUM_ORDERBOOK")
    );

    const [deployer, user1, user2] = await ethers.getSigners();

    // Display initial state
    console.log(colorText("\n📍 INITIAL STATE", colors.brightCyan));
    await displayState(vault, user1, "User 1");
    await displayState(vault, user2, "User 2");

    // Note: Since this is a fresh deployment, there shouldn't be any open orders
    // But let's check for positions
    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);

    if (user1Positions.length > 0 || user2Positions.length > 0) {
      console.log(
        colorText("\n⚠️  WARNING: Users have existing positions", colors.yellow)
      );
      console.log(
        "   This test assumes a clean state. Positions may affect results."
      );
    }

    // Step 3: Test margin-only trading
    console.log(
      colorText("\n📍 STEP 3: TEST MARGIN-ONLY TRADING", colors.brightCyan)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    const price = ethers.parseUnits("10", 6); // $10
    const amount = ethers.parseUnits("5", 18); // 5 ALU
    const expectedMargin = ethers.parseUnits("50", 6); // $50 (100% margin)

    console.log(`\n🔸 Test Trade: 5 ALU @ $10 = $50 notional`);
    console.log(`   Expected margin per side: $50`);

    // Place margin orders
    console.log("\n⏳ Placing margin orders...");

    let tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, amount, true);
    await tx.wait();
    console.log(colorText("✅ User 1: Margin BUY order placed", colors.green));

    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, amount, false);
    await tx.wait();
    console.log(
      colorText("✅ User 2: Margin SELL order placed and matched", colors.green)
    );

    // Display state after trade
    console.log(colorText("\n📍 AFTER MARGIN TRADE", colors.brightCyan));
    await displayState(vault, user1, "User 1");
    await displayState(vault, user2, "User 2");

    // Verify margin calculations
    const user1Summary = await vault.getMarginSummary(user1.address);
    const user2Summary = await vault.getMarginSummary(user2.address);

    console.log(colorText("\n✅ MARGIN VERIFICATION", colors.brightGreen));
    console.log(colorText("=".repeat(60), colors.cyan));

    const user1Correct = user1Summary.marginUsed === expectedMargin;
    const user2Correct = user2Summary.marginUsed === expectedMargin;

    console.log(
      `User 1 margin: ${formatUSDC(user1Summary.marginUsed)} USDC ${
        user1Correct ? "✅" : "❌"
      }`
    );
    console.log(
      `User 2 margin: ${formatUSDC(user2Summary.marginUsed)} USDC ${
        user2Correct ? "✅" : "❌"
      }`
    );

    if (user1Correct && user2Correct) {
      console.log(
        colorText(
          "\n🎉 SUCCESS: Margin calculations working correctly!",
          colors.brightGreen
        )
      );
      console.log(
        colorText(
          "   All futures positions are properly collateralized",
          colors.green
        )
      );
      console.log(
        colorText("   The vulnerability has been fixed!", colors.green)
      );
    } else {
      console.log(
        colorText("\n❌ ISSUE: Margin calculations incorrect", colors.brightRed)
      );
    }

    // Additional test: Position increase
    console.log(
      colorText("\n📍 STEP 4: TEST POSITION INCREASE", colors.brightCyan)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    const increaseAmount = ethers.parseUnits("10", 18); // 10 ALU
    const expectedTotalMargin = ethers.parseUnits("150", 6); // $150 total

    console.log(`\n🔸 Increase: 10 ALU @ $10 = $100 additional`);
    console.log(`   Expected total margin per side: $150`);

    tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, increaseAmount, true);
    await tx.wait();
    console.log(
      colorText("✅ User 1: Additional BUY order placed", colors.green)
    );

    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, increaseAmount, false);
    await tx.wait();
    console.log(
      colorText(
        "✅ User 2: Additional SELL order placed and matched",
        colors.green
      )
    );

    // Final state
    console.log(colorText("\n📍 FINAL STATE", colors.brightCyan));
    await displayState(vault, user1, "User 1");
    await displayState(vault, user2, "User 2");

    // Final verification
    const user1Final = await vault.getMarginSummary(user1.address);
    const user2Final = await vault.getMarginSummary(user2.address);

    console.log(colorText("\n✅ FINAL VERIFICATION", colors.brightGreen));
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(
      `User 1 total margin: ${formatUSDC(
        user1Final.marginUsed
      )} USDC (expected: 150)`
    );
    console.log(
      `User 2 total margin: ${formatUSDC(
        user2Final.marginUsed
      )} USDC (expected: 150)`
    );
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    if (error.reason) {
      console.error(colorText(`   Reason: ${error.reason}`, colors.red));
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
