/**
 * 🧪 SIMPLE MARGIN TEST
 *
 * Tests basic margin functionality with the fixed contracts
 */

const { ethers } = require("hardhat");
const { getAddress } = require("../config/contracts");

async function main() {
  console.log("\n🧪 SIMPLE MARGIN TEST");
  console.log("====================\n");

  try {
    // Load contracts
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

    const [deployer, user1, user2] = await ethers.getSigners();

    // Check initial state
    console.log("📊 Initial State:");
    const user1Initial = await vault.getMarginSummary(user1.address);
    const user2Initial = await vault.getMarginSummary(user2.address);
    console.log(
      `User 1 - Collateral: ${ethers.formatUnits(
        user1Initial.totalCollateral,
        6
      )} USDC`
    );
    console.log(
      `User 2 - Collateral: ${ethers.formatUnits(
        user2Initial.totalCollateral,
        6
      )} USDC`
    );

    // Test 1: Simple margin trade
    console.log("\n📍 Test 1: Margin Trade (10 ALU @ $5)");
    console.log("=====================================");

    const price = ethers.parseUnits("5", 6); // $5
    const amount = ethers.parseUnits("10", 18); // 10 ALU
    const expectedMargin = ethers.parseUnits("50", 6); // $50 (100% margin)

    // Both users place margin orders
    console.log("Placing margin orders...");

    let tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, amount, true);
    await tx.wait();
    console.log("✅ User 1 margin buy order placed");

    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, amount, false);
    await tx.wait();
    console.log("✅ User 2 margin sell order placed and matched");

    // Check margin after trade
    const user1After = await vault.getMarginSummary(user1.address);
    const user2After = await vault.getMarginSummary(user2.address);

    console.log("\n📊 After Trade:");
    console.log(
      `User 1 - Margin Used: ${ethers.formatUnits(
        user1After.marginUsed,
        6
      )} USDC (expected: 50)`
    );
    console.log(
      `User 2 - Margin Used: ${ethers.formatUnits(
        user2After.marginUsed,
        6
      )} USDC (expected: 50)`
    );

    // Verify positions
    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);

    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      console.log(
        `\nUser 1 Position: LONG ${ethers.formatUnits(
          pos.size,
          18
        )} ALU @ $${ethers.formatUnits(pos.entryPrice, 6)}`
      );
      console.log(
        `  Margin Locked: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`
      );
    }

    if (user2Positions.length > 0) {
      const pos = user2Positions[0];
      const size = pos.size < 0n ? -pos.size : pos.size;
      console.log(
        `\nUser 2 Position: SHORT ${ethers.formatUnits(
          size,
          18
        )} ALU @ $${ethers.formatUnits(pos.entryPrice, 6)}`
      );
      console.log(
        `  Margin Locked: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`
      );
    }

    // Test 2: Position increase
    console.log("\n📍 Test 2: Position Increase (20 ALU @ $5)");
    console.log("=========================================");

    const increaseAmount = ethers.parseUnits("20", 18);

    tx = await orderBook
      .connect(user1)
      .placeMarginLimitOrder(price, increaseAmount, true);
    await tx.wait();
    console.log("✅ User 1 additional buy order placed");

    tx = await orderBook
      .connect(user2)
      .placeMarginLimitOrder(price, increaseAmount, false);
    await tx.wait();
    console.log("✅ User 2 additional sell order placed and matched");

    // Check final state
    const user1Final = await vault.getMarginSummary(user1.address);
    const user2Final = await vault.getMarginSummary(user2.address);

    console.log("\n📊 Final State:");
    console.log(
      `User 1 - Total Margin Used: ${ethers.formatUnits(
        user1Final.marginUsed,
        6
      )} USDC (expected: 150)`
    );
    console.log(
      `User 2 - Total Margin Used: ${ethers.formatUnits(
        user2Final.marginUsed,
        6
      )} USDC (expected: 150)`
    );

    // Summary
    console.log("\n✅ Test Summary:");
    console.log("================");
    const user1MarginCorrect =
      user1Final.marginUsed === ethers.parseUnits("150", 6);
    const user2MarginCorrect =
      user2Final.marginUsed === ethers.parseUnits("150", 6);

    if (user1MarginCorrect && user2MarginCorrect) {
      console.log("✅ Margin calculations are working correctly!");
      console.log("✅ Positions are properly collateralized!");
    } else {
      console.log("❌ Margin calculations have issues:");
      if (!user1MarginCorrect) console.log(`  - User 1 margin incorrect`);
      if (!user2MarginCorrect) console.log(`  - User 2 margin incorrect`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
