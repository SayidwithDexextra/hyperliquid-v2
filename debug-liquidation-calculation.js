#!/usr/bin/env node

const { ethers } = require("hardhat");

async function main() {
  console.log("\n🔍 DEBUGGING LIQUIDATION CALCULATION");
  console.log("═".repeat(60));

  // Manual calculation based on the smart contract logic
  const entryPrice = ethers.parseUnits("1.0", 6); // $1.00 (6 decimals)
  const markPrice = ethers.parseUnits("2.5", 6); // $2.50 (6 decimals)
  const positionSize = ethers.parseUnits("10", 18); // 10 ALU (18 decimals)
  const userCollateral = ethers.parseUnits("999.99", 6); // User's collateral (6 decimals)
  const marginLocked = ethers.parseUnits("15.0", 6); // Locked margin (6 decimals)

  const DECIMAL_SCALE = BigInt(1e12); // 10^12
  const TICK_PRECISION = BigInt(1e6); // 10^6
  const LIQUIDATION_PENALTY_BPS = 500n; // 5%

  console.log("📊 Input Values:");
  console.log(`   Entry Price: ${ethers.formatUnits(entryPrice, 6)} USDC`);
  console.log(`   Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`);
  console.log(`   Position Size: ${ethers.formatUnits(positionSize, 18)} ALU`);
  console.log(
    `   User Collateral: ${ethers.formatUnits(userCollateral, 6)} USDC`
  );
  console.log(`   Margin Locked: ${ethers.formatUnits(marginLocked, 6)} USDC`);

  console.log("\n🔢 Step-by-Step Calculation:");

  // Step 1: Calculate loss per unit
  const lossPerUnit = markPrice - entryPrice;
  console.log(
    `   1. Loss per unit: ${ethers.formatUnits(
      markPrice,
      6
    )} - ${ethers.formatUnits(entryPrice, 6)} = ${ethers.formatUnits(
      lossPerUnit,
      6
    )} USDC`
  );

  // Step 2: Calculate trading loss
  const tradingLoss =
    (lossPerUnit * positionSize) / (DECIMAL_SCALE * TICK_PRECISION);
  console.log(
    `   2. Trading loss: ${ethers.formatUnits(
      lossPerUnit,
      6
    )} * ${ethers.formatUnits(
      positionSize,
      18
    )} / (${DECIMAL_SCALE.toString()} * ${TICK_PRECISION.toString()})`
  );
  console.log(
    `      = (${lossPerUnit.toString()} * ${positionSize.toString()}) / ${(
      DECIMAL_SCALE * TICK_PRECISION
    ).toString()}`
  );
  console.log(`      = ${tradingLoss.toString()}`);
  console.log(`      = ${ethers.formatUnits(tradingLoss, 6)} USDC`);

  // Step 3: Calculate penalty
  const penalty = (marginLocked * LIQUIDATION_PENALTY_BPS) / 10000n;
  console.log(
    `   3. Penalty: ${ethers.formatUnits(
      marginLocked,
      6
    )} * ${LIQUIDATION_PENALTY_BPS.toString()} / 10000 = ${ethers.formatUnits(
      penalty,
      6
    )} USDC`
  );

  // Step 4: Total loss
  const totalLoss = tradingLoss + penalty;
  console.log(
    `   4. Total loss: ${ethers.formatUnits(
      tradingLoss,
      6
    )} + ${ethers.formatUnits(penalty, 6)} = ${ethers.formatUnits(
      totalLoss,
      6
    )} USDC`
  );

  // Step 5: Check cap
  console.log(
    `   5. Cap check: totalLoss (${ethers.formatUnits(
      totalLoss,
      6
    )}) > userCollateral (${ethers.formatUnits(userCollateral, 6)})?`
  );
  console.log(
    `      Result: ${
      totalLoss > userCollateral
        ? "YES - will be capped"
        : "NO - will use calculated loss"
    }`
  );

  const finalLoss = totalLoss > userCollateral ? userCollateral : totalLoss;
  console.log(`   6. Final loss: ${ethers.formatUnits(finalLoss, 6)} USDC`);

  console.log("\n✅ Expected Result:");
  console.log(`   User should lose: ${ethers.formatUnits(finalLoss, 6)} USDC`);
  console.log(
    `   User should keep: ${ethers.formatUnits(
      userCollateral - finalLoss,
      6
    )} USDC`
  );

  if (finalLoss == totalLoss) {
    console.log(
      "\n🎯 This looks correct! Trading loss + penalty should be applied."
    );
  } else {
    console.log(
      "\n⚠️  Loss is being capped - something might be wrong with the calculation."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
