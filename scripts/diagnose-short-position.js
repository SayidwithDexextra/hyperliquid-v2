const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

async function main() {
  console.log("\n🔍 Diagnosing SHORT Position P&L Issue");
  console.log("═".repeat(60));

  try {
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user2 = signers[2];

    console.log(`\n👤 User 2: ${user2.address}`);

    // Get the position directly
    const positions = await vault.getUserPositions(user2.address);
    const position = positions[0];

    console.log(`\n📊 Position Details:`);
    console.log(`   Market ID: ${position.marketId}`);
    console.log(`   Size (raw): ${position.size}`);
    console.log(
      `   Size (formatted): ${ethers.formatUnits(position.size, 18)} ALU`
    );
    console.log(
      `   Entry Price: $${ethers.formatUnits(position.entryPrice, 6)}`
    );

    // Get mark price
    const markPrice = await vault.marketMarkPrices(position.marketId);
    console.log(`   Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

    // Check if position.size is positive or negative
    const sizeValue = BigInt(position.size.toString());
    console.log(`\n🔍 Size Analysis:`);
    console.log(`   Is size positive? ${sizeValue > 0n}`);
    console.log(`   Is size negative? ${sizeValue < 0n}`);

    // Calculate what P&L should be
    const entryPriceNum = parseFloat(
      ethers.formatUnits(position.entryPrice, 6)
    );
    const markPriceNum = parseFloat(ethers.formatUnits(markPrice, 6));
    const sizeNum = parseFloat(ethers.formatUnits(position.size, 18));

    console.log(`\n💡 P&L Calculation Breakdown:`);
    console.log(`   Entry Price: $${entryPriceNum}`);
    console.log(`   Mark Price: $${markPriceNum}`);
    console.log(`   Size: ${sizeNum} ALU`);

    // Current calculation (wrong for shorts)
    const currentCalc = (markPriceNum - entryPriceNum) * sizeNum;
    console.log(`\n❌ Current Calculation (always assumes LONG):`);
    console.log(`   (markPrice - entryPrice) × size`);
    console.log(`   ($${markPriceNum} - $${entryPriceNum}) × ${sizeNum}`);
    console.log(`   = ${currentCalc}`);

    // Correct calculation for SHORT
    const correctCalcForShort =
      (entryPriceNum - markPriceNum) * Math.abs(sizeNum);
    console.log(`\n✅ Correct Calculation for SHORT:`);
    console.log(`   (entryPrice - markPrice) × |size|`);
    console.log(
      `   ($${entryPriceNum} - $${markPriceNum}) × ${Math.abs(sizeNum)}`
    );
    console.log(`   = ${correctCalcForShort}`);

    console.log(`\n🚨 THE ISSUE:`);
    console.log(`   1. The position is stored with POSITIVE size (${sizeNum})`);
    console.log(`   2. But it's a SHORT position (should have NEGATIVE size)`);
    console.log(`   3. The P&L formula doesn't account for position direction`);
    console.log(
      `   4. Result: Massive negative P&L instead of positive profit`
    );

    // Check how position was created
    console.log(`\n📝 Solution:`);
    console.log(`   The issue is in how positions are created/updated.`);
    console.log(`   SHORT positions should have negative size values.`);
    console.log(
      `   Or the P&L calculation should check a separate 'isLong' flag.`
    );
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }
}

main().catch(console.error);
