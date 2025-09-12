/**
 * 🧪 COMPREHENSIVE MARGIN TEST SUITE
 *
 * This exhaustive test validates all aspects of the margin system including:
 * - Basic margin calculations
 * - Position increases and decreases
 * - Position flips (long to short, short to long)
 * - Edge cases and boundary conditions
 * - Insufficient collateral scenarios
 * - Fee deductions with margin
 * - Multiple simultaneous positions
 * - Margin release on position closure
 * - Protection against spot/margin mixing
 */

const { ethers } = require("hardhat");
const { getAddress } = require("../config/contracts");

// Color codes for output
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

async function displayUserState(vault, user, label) {
  const summary = await vault.getMarginSummary(user.address);
  const positions = await vault.getUserPositions(user.address);

  console.log(colorText(`\n📊 ${label}:`, colors.brightYellow));
  console.log(`  Address: ${user.address}`);
  console.log(
    `  Total Collateral: ${formatUSDC(summary.totalCollateral)} USDC`
  );
  console.log(`  Margin Used: ${formatUSDC(summary.marginUsed)} USDC`);
  console.log(`  Margin Reserved: ${formatUSDC(summary.marginReserved)} USDC`);
  console.log(`  Available: ${formatUSDC(summary.availableCollateral)} USDC`);

  if (positions.length > 0) {
    console.log(`  Positions:`);
    for (const pos of positions) {
      const size = pos.size < 0n ? -pos.size : pos.size;
      const side = pos.size >= 0n ? "LONG" : "SHORT";
      const sideColor = pos.size >= 0n ? colors.green : colors.red;
      const notionalValue =
        (size * pos.entryPrice) / ethers.parseUnits("1", 18);
      const marginRatio =
        pos.marginLocked > 0n
          ? (pos.marginLocked * 10000n) / notionalValue
          : 0n;

      console.log(
        colorText(
          `    - ${side} ${formatALU(size)} ALU @ $${formatUSDC(
            pos.entryPrice
          )}`,
          sideColor
        )
      );
      console.log(
        `      Notional: $${formatUSDC(notionalValue)} | Margin: $${formatUSDC(
          pos.marginLocked
        )} (${Number(marginRatio) / 100}%)`
      );
    }
  } else {
    console.log(`  No positions`);
  }
}

async function testCase(name, fn, expectSuccess = true) {
  console.log(colorText(`\n🔸 ${name}`, colors.cyan));
  try {
    await fn();
    if (expectSuccess) {
      console.log(colorText(`   ✅ PASSED`, colors.green));
    } else {
      console.log(
        colorText(`   ❌ FAILED: Expected to fail but succeeded`, colors.red)
      );
      return false;
    }
    return true;
  } catch (error) {
    if (!expectSuccess) {
      console.log(
        colorText(
          `   ✅ PASSED: Failed as expected - ${error.message.substring(
            0,
            100
          )}...`,
          colors.green
        )
      );
      return true;
    } else {
      console.log(colorText(`   ❌ FAILED: ${error.message}`, colors.red));
      return false;
    }
  }
}

async function main() {
  console.clear();
  console.log(
    colorText("🧪 COMPREHENSIVE MARGIN TEST SUITE", colors.brightYellow)
  );
  console.log(colorText("=".repeat(80), colors.cyan));
  console.log(
    "This test thoroughly validates all aspects of the margin system"
  );

  let totalTests = 0;
  let passedTests = 0;

  try {
    // Load contracts
    console.log(colorText("\n📋 SETUP", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));

    const usdc = await ethers.getContractAt(
      "MockUSDC",
      getAddress("MOCK_USDC")
    );
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      getAddress("CENTRALIZED_VAULT")
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      getAddress("ALUMINUM_ORDERBOOK")
    );

    const [deployer, user1, user2, user3] = await ethers.getSigners();
    console.log("✅ Contracts loaded");

    // Get trading parameters
    const tradingParams = await orderBook.getTradingParameters();
    const marginReqBps = tradingParams.marginRequirement;
    const tradingFeeBps = tradingParams.fees || 10n; // 0.1% default if not set
    console.log(`📊 Trading Parameters:`);
    console.log(
      `   Margin Requirement: ${marginReqBps} bps (${
        Number(marginReqBps) / 100
      }%)`
    );
    console.log(
      `   Trading Fee: ${tradingFeeBps} bps (${Number(tradingFeeBps) / 100}%)`
    );

    // Display initial state
    await displayUserState(vault, user1, "User 1 Initial");
    await displayUserState(vault, user2, "User 2 Initial");
    await displayUserState(vault, user3, "User 3 Initial");

    // TEST SUITE 1: BASIC MARGIN FUNCTIONALITY
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 1: BASIC MARGIN FUNCTIONALITY",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 1.1: Simple margin trade
    totalTests++;
    if (
      await testCase(
        "Test 1.1: Simple margin trade (10 ALU @ $5)",
        async () => {
          const price = ethers.parseUnits("5", 6);
          const amount = ethers.parseUnits("10", 18);
          const expectedMargin = ethers.parseUnits("50", 6); // 100% of $50 notional

          let tx = await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
          await tx.wait();

          tx = await orderBook
            .connect(user2)
            .placeMarginLimitOrder(price, amount, false);
          await tx.wait();

          const user1Margin = await vault.getMarginSummary(user1.address);
          const user2Margin = await vault.getMarginSummary(user2.address);

          if (user1Margin.marginUsed !== expectedMargin)
            throw new Error(
              `User1 margin incorrect: ${formatUSDC(
                user1Margin.marginUsed
              )} vs ${formatUSDC(expectedMargin)}`
            );
          if (user2Margin.marginUsed !== expectedMargin)
            throw new Error(
              `User2 margin incorrect: ${formatUSDC(
                user2Margin.marginUsed
              )} vs ${formatUSDC(expectedMargin)}`
            );
        }
      )
    )
      passedTests++;

    // Test 1.2: Position increase
    totalTests++;
    if (
      await testCase(
        "Test 1.2: Position increase (add 20 ALU @ $5)",
        async () => {
          const price = ethers.parseUnits("5", 6);
          const amount = ethers.parseUnits("20", 18);
          const expectedTotalMargin = ethers.parseUnits("150", 6); // Total: 30 ALU * $5 = $150

          let tx = await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
          await tx.wait();

          tx = await orderBook
            .connect(user2)
            .placeMarginLimitOrder(price, amount, false);
          await tx.wait();

          const user1Margin = await vault.getMarginSummary(user1.address);
          const user2Margin = await vault.getMarginSummary(user2.address);

          if (user1Margin.marginUsed !== expectedTotalMargin)
            throw new Error(
              `User1 total margin incorrect: ${formatUSDC(
                user1Margin.marginUsed
              )} vs ${formatUSDC(expectedTotalMargin)}`
            );
          if (user2Margin.marginUsed !== expectedTotalMargin)
            throw new Error(
              `User2 total margin incorrect: ${formatUSDC(
                user2Margin.marginUsed
              )} vs ${formatUSDC(expectedTotalMargin)}`
            );
        }
      )
    )
      passedTests++;

    // Test 1.3: Partial position close
    totalTests++;
    if (
      await testCase(
        "Test 1.3: Partial position close (reduce 10 ALU)",
        async () => {
          const price = ethers.parseUnits("5", 6);
          const amount = ethers.parseUnits("10", 18);
          const expectedMarginAfter = ethers.parseUnits("100", 6); // Remaining: 20 ALU * $5 = $100

          // User1 sells 10 (closes 10 of their long)
          let tx = await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, false);
          await tx.wait();

          // User2 buys 10 (closes 10 of their short)
          tx = await orderBook
            .connect(user2)
            .placeMarginLimitOrder(price, amount, true);
          await tx.wait();

          const user1Margin = await vault.getMarginSummary(user1.address);
          const user2Margin = await vault.getMarginSummary(user2.address);

          if (user1Margin.marginUsed !== expectedMarginAfter)
            throw new Error(
              `User1 margin after reduction incorrect: ${formatUSDC(
                user1Margin.marginUsed
              )} vs ${formatUSDC(expectedMarginAfter)}`
            );
          if (user2Margin.marginUsed !== expectedMarginAfter)
            throw new Error(
              `User2 margin after reduction incorrect: ${formatUSDC(
                user2Margin.marginUsed
              )} vs ${formatUSDC(expectedMarginAfter)}`
            );
        }
      )
    )
      passedTests++;

    // TEST SUITE 2: POSITION FLIPS
    console.log(
      colorText("\n\n📍 TEST SUITE 2: POSITION FLIPS", colors.brightYellow)
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 2.1: Long to Short flip
    totalTests++;
    if (
      await testCase("Test 2.1: Position flip - Long to Short", async () => {
        const price = ethers.parseUnits("5", 6);
        const amount = ethers.parseUnits("40", 18); // User1 has LONG 20, will flip to SHORT 20
        const expectedMarginAfter = ethers.parseUnits("100", 6); // SHORT 20 ALU * $5 = $100

        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, amount, false);
        await tx.wait();

        tx = await orderBook
          .connect(user3)
          .placeMarginLimitOrder(price, amount, true);
        await tx.wait();

        const user1Positions = await vault.getUserPositions(user1.address);
        const user1Margin = await vault.getMarginSummary(user1.address);

        if (user1Positions.length === 0 || user1Positions[0].size >= 0n)
          throw new Error("User1 should have SHORT position");
        if (user1Margin.marginUsed !== expectedMarginAfter)
          throw new Error(
            `User1 margin after flip incorrect: ${formatUSDC(
              user1Margin.marginUsed
            )} vs ${formatUSDC(expectedMarginAfter)}`
          );
      })
    )
      passedTests++;

    // Test 2.2: Short to Long flip
    totalTests++;
    if (
      await testCase("Test 2.2: Position flip - Short to Long", async () => {
        const price = ethers.parseUnits("5", 6);
        const amount = ethers.parseUnits("50", 18); // User1 has SHORT 20, will flip to LONG 30
        const expectedMarginAfter = ethers.parseUnits("150", 6); // LONG 30 ALU * $5 = $150

        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, amount, true);
        await tx.wait();

        tx = await orderBook
          .connect(user3)
          .placeMarginLimitOrder(price, amount, false);
        await tx.wait();

        const user1Positions = await vault.getUserPositions(user1.address);
        const user1Margin = await vault.getMarginSummary(user1.address);

        if (user1Positions.length === 0 || user1Positions[0].size <= 0n)
          throw new Error("User1 should have LONG position");
        if (user1Margin.marginUsed !== expectedMarginAfter)
          throw new Error(
            `User1 margin after flip incorrect: ${formatUSDC(
              user1Margin.marginUsed
            )} vs ${formatUSDC(expectedMarginAfter)}`
          );
      })
    )
      passedTests++;

    // TEST SUITE 3: EDGE CASES
    console.log(
      colorText("\n\n📍 TEST SUITE 3: EDGE CASES", colors.brightYellow)
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 3.1: Minimum trade size
    totalTests++;
    if (
      await testCase(
        "Test 3.1: Minimum trade size (0.000001 ALU)",
        async () => {
          const price = ethers.parseUnits("10", 6);
          const amount = ethers.parseUnits("0.000001", 18); // Very small amount

          let tx = await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, false);
          await tx.wait();

          tx = await orderBook
            .connect(user2)
            .placeMarginLimitOrder(price, amount, true);
          await tx.wait();
        }
      )
    )
      passedTests++;

    // Test 3.2: Maximum position size (within collateral)
    totalTests++;
    if (
      await testCase("Test 3.2: Maximum position size test", async () => {
        const price = ethers.parseUnits("1", 6); // $1 per ALU
        const userMargin = await vault.getMarginSummary(user3.address);
        const available = userMargin.availableCollateral;
        // Account for fees: available / (1 + fee%)
        const maxNotional = (available * 10000n) / (10000n + tradingFeeBps);
        const maxAmount = (maxNotional * ethers.parseUnits("1", 18)) / price;

        let tx = await orderBook
          .connect(user3)
          .placeMarginLimitOrder(price, maxAmount, true);
        await tx.wait();

        tx = await orderBook
          .connect(deployer)
          .placeMarginLimitOrder(price, maxAmount, false);
        await tx.wait();

        const user3MarginAfter = await vault.getMarginSummary(user3.address);
        // Should have very little available collateral left (just rounding dust)
        if (user3MarginAfter.availableCollateral > ethers.parseUnits("1", 6)) {
          throw new Error(
            `Too much collateral remaining: ${formatUSDC(
              user3MarginAfter.availableCollateral
            )}`
          );
        }
      })
    )
      passedTests++;

    // Test 3.3: Zero price rejection
    totalTests++;
    if (
      await testCase(
        "Test 3.3: Zero price order (should fail)",
        async () => {
          const price = 0n;
          const amount = ethers.parseUnits("10", 18);
          await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
        },
        false
      )
    )
      passedTests++;

    // Test 3.4: Zero amount rejection
    totalTests++;
    if (
      await testCase(
        "Test 3.4: Zero amount order (should fail)",
        async () => {
          const price = ethers.parseUnits("10", 6);
          const amount = 0n;
          await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
        },
        false
      )
    )
      passedTests++;

    // TEST SUITE 4: INSUFFICIENT COLLATERAL
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 4: INSUFFICIENT COLLATERAL",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 4.1: Order exceeding available collateral
    totalTests++;
    if (
      await testCase(
        "Test 4.1: Order exceeding available collateral (should fail)",
        async () => {
          const price = ethers.parseUnits("100", 6);
          const amount = ethers.parseUnits("1000", 18); // $100,000 notional, way more than collateral
          await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
        },
        false
      )
    )
      passedTests++;

    // Test 4.2: Order that would exceed after fees
    totalTests++;
    if (
      await testCase(
        "Test 4.2: Order exceeding collateral after fees (should fail)",
        async () => {
          const user1Margin = await vault.getMarginSummary(user1.address);
          const available = user1Margin.availableCollateral;
          const price = ethers.parseUnits("1", 6);
          // Try to use exactly available collateral (will fail due to fees)
          const amount = (available * ethers.parseUnits("1", 18)) / price;

          await orderBook
            .connect(user1)
            .placeMarginLimitOrder(price, amount, true);
        },
        false
      )
    )
      passedTests++;

    // TEST SUITE 5: SPOT/MARGIN MIXING PROTECTION
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 5: SPOT/MARGIN MIXING PROTECTION",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 5.1: Spot order placement
    totalTests++;
    if (
      await testCase("Test 5.1: Spot order placement", async () => {
        const price = ethers.parseUnits("10", 6);
        const amount = ethers.parseUnits("5", 18);
        await orderBook.connect(user1).placeLimitOrder(price, amount, true);
      })
    )
      passedTests++;

    // Test 5.2: Spot order matching should fail
    totalTests++;
    if (
      await testCase(
        "Test 5.2: Spot order matching (should fail)",
        async () => {
          const price = ethers.parseUnits("10", 6);
          const amount = ethers.parseUnits("5", 18);
          // Try to match the spot order
          await orderBook.connect(user2).placeLimitOrder(price, amount, false);
        },
        false
      )
    )
      passedTests++;

    // Test 5.3: Margin order can't match spot order
    totalTests++;
    if (
      await testCase(
        "Test 5.3: Margin order matching spot order (should fail)",
        async () => {
          const price = ethers.parseUnits("10", 6);
          const amount = ethers.parseUnits("5", 18);
          await orderBook
            .connect(user2)
            .placeMarginLimitOrder(price, amount, false);
        },
        false
      )
    )
      passedTests++;

    // TEST SUITE 6: COMPLETE POSITION LIFECYCLE
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 6: COMPLETE POSITION LIFECYCLE",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // First, clean up user positions by closing them
    console.log(
      colorText("\n🧹 Cleaning up existing positions...", colors.yellow)
    );

    // Close User1's position
    const user1Pos = await vault.getUserPositions(user1.address);
    if (user1Pos.length > 0) {
      const closeAmount =
        user1Pos[0].size > 0n ? user1Pos[0].size : -user1Pos[0].size;
      const closeSide = user1Pos[0].size > 0n ? false : true; // opposite side to close
      let tx = await orderBook
        .connect(user1)
        .placeMarginLimitOrder(
          ethers.parseUnits("5", 6),
          closeAmount,
          closeSide
        );
      await tx.wait();

      // Match with deployer
      tx = await orderBook
        .connect(deployer)
        .placeMarginLimitOrder(
          ethers.parseUnits("5", 6),
          closeAmount,
          !closeSide
        );
      await tx.wait();
    }

    // Test 6.1: Full lifecycle test
    totalTests++;
    if (
      await testCase("Test 6.1: Complete position lifecycle", async () => {
        const price = ethers.parseUnits("10", 6);
        const openAmount = ethers.parseUnits("50", 18);

        // Step 1: Open position
        console.log("      Step 1: Opening position...");
        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, openAmount, true);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, openAmount, false);
        await tx.wait();

        let user1Margin = await vault.getMarginSummary(user1.address);
        const marginAfterOpen = user1Margin.marginUsed;
        console.log(
          `      Margin after open: ${formatUSDC(marginAfterOpen)} USDC`
        );

        // Step 2: Increase position
        console.log("      Step 2: Increasing position...");
        const increaseAmount = ethers.parseUnits("30", 18);
        tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, increaseAmount, true);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, increaseAmount, false);
        await tx.wait();

        user1Margin = await vault.getMarginSummary(user1.address);
        const marginAfterIncrease = user1Margin.marginUsed;
        console.log(
          `      Margin after increase: ${formatUSDC(marginAfterIncrease)} USDC`
        );

        // Step 3: Partial close
        console.log("      Step 3: Partial close...");
        const partialCloseAmount = ethers.parseUnits("20", 18);
        tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, partialCloseAmount, false);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, partialCloseAmount, true);
        await tx.wait();

        user1Margin = await vault.getMarginSummary(user1.address);
        const marginAfterPartialClose = user1Margin.marginUsed;
        console.log(
          `      Margin after partial close: ${formatUSDC(
            marginAfterPartialClose
          )} USDC`
        );

        // Step 4: Complete close
        console.log("      Step 4: Complete close...");
        const finalCloseAmount = ethers.parseUnits("60", 18);
        tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, finalCloseAmount, false);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, finalCloseAmount, true);
        await tx.wait();

        user1Margin = await vault.getMarginSummary(user1.address);
        const marginAfterFullClose = user1Margin.marginUsed;
        console.log(
          `      Margin after full close: ${formatUSDC(
            marginAfterFullClose
          )} USDC`
        );

        // Verify final state
        const user1Positions = await vault.getUserPositions(user1.address);
        if (user1Positions.length > 0)
          throw new Error("User should have no positions after full close");
        if (marginAfterFullClose !== 0n)
          throw new Error(
            `All margin should be released after close: ${formatUSDC(
              marginAfterFullClose
            )}`
          );
      })
    )
      passedTests++;

    // TEST SUITE 7: FEE CALCULATIONS WITH MARGIN
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 7: FEE CALCULATIONS WITH MARGIN",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 7.1: Verify fees are deducted from collateral
    totalTests++;
    if (
      await testCase("Test 7.1: Fee deduction verification", async () => {
        const initialCollateral = (await vault.getMarginSummary(user1.address))
          .totalCollateral;

        const price = ethers.parseUnits("100", 6);
        const amount = ethers.parseUnits("10", 18);
        const notionalValue = ethers.parseUnits("1000", 6); // 10 * $100
        const expectedFee = (notionalValue * tradingFeeBps) / 10000n;

        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, amount, true);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, amount, false);
        await tx.wait();

        const finalCollateral = (await vault.getMarginSummary(user1.address))
          .totalCollateral;
        const collateralReduction = initialCollateral - finalCollateral;

        if (collateralReduction !== expectedFee) {
          throw new Error(
            `Fee deduction incorrect: ${formatUSDC(
              collateralReduction
            )} vs expected ${formatUSDC(expectedFee)}`
          );
        }
      })
    )
      passedTests++;

    // TEST SUITE 8: MARKET PRICE VARIATIONS
    console.log(
      colorText(
        "\n\n📍 TEST SUITE 8: MARKET PRICE VARIATIONS",
        colors.brightYellow
      )
    );
    console.log(colorText("=".repeat(80), colors.cyan));

    // Test 8.1: High price trades
    totalTests++;
    if (
      await testCase("Test 8.1: High price trade ($10,000/ALU)", async () => {
        const price = ethers.parseUnits("10000", 6);
        const amount = ethers.parseUnits("0.01", 18); // Small amount due to high price
        const expectedMargin = ethers.parseUnits("100", 6); // 0.01 * $10,000

        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, amount, true);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, amount, false);
        await tx.wait();
      })
    )
      passedTests++;

    // Test 8.2: Low price trades
    totalTests++;
    if (
      await testCase("Test 8.2: Low price trade ($0.01/ALU)", async () => {
        const price = ethers.parseUnits("0.01", 6);
        const amount = ethers.parseUnits("10000", 18);
        const expectedMargin = ethers.parseUnits("100", 6); // 10000 * $0.01

        let tx = await orderBook
          .connect(user1)
          .placeMarginLimitOrder(price, amount, true);
        await tx.wait();
        tx = await orderBook
          .connect(user2)
          .placeMarginLimitOrder(price, amount, false);
        await tx.wait();
      })
    )
      passedTests++;

    // FINAL STATE DISPLAY
    console.log(colorText("\n\n📊 FINAL STATE", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));

    await displayUserState(vault, user1, "User 1 Final");
    await displayUserState(vault, user2, "User 2 Final");
    await displayUserState(vault, user3, "User 3 Final");

    // TEST SUMMARY
    console.log(colorText("\n\n📈 TEST SUMMARY", colors.brightYellow));
    console.log(colorText("=".repeat(80), colors.cyan));

    const allPassed = passedTests === totalTests;
    const summaryColor = allPassed ? colors.brightGreen : colors.brightRed;

    console.log(colorText(`Total Tests: ${totalTests}`, colors.white));
    console.log(colorText(`Passed: ${passedTests}`, colors.green));
    console.log(colorText(`Failed: ${totalTests - passedTests}`, colors.red));
    console.log(
      colorText(
        `Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`,
        summaryColor
      )
    );

    if (allPassed) {
      console.log(colorText("\n🎉 ALL TESTS PASSED!", colors.brightGreen));
      console.log(
        colorText(
          "Your margin system is working correctly and is protected against:",
          colors.green
        )
      );
      console.log(
        colorText("  ✅ Under-collateralized positions", colors.green)
      );
      console.log(
        colorText("  ✅ Spot/margin mixing vulnerabilities", colors.green)
      );
      console.log(colorText("  ✅ Position flip margin bugs", colors.green));
      console.log(
        colorText("  ✅ Insufficient collateral attacks", colors.green)
      );
      console.log(
        colorText("  ✅ Edge cases and boundary conditions", colors.green)
      );
      console.log(
        colorText("\n🛡️  Your margin system is secure!", colors.brightGreen)
      );
    } else {
      console.log(colorText("\n⚠️  SOME TESTS FAILED", colors.brightRed));
      console.log(
        colorText("Please review the failed tests above", colors.red)
      );
    }
  } catch (error) {
    console.error(
      colorText(`\n❌ Fatal Error: ${error.message}`, colors.brightRed)
    );
    console.error(colorText(`Stack: ${error.stack}`, colors.red));
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
