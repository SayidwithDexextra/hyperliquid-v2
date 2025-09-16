#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bright: "\x1b[1m",
  reset: "\x1b[0m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatUSDC(value) {
  return parseFloat(ethers.formatUnits(value, 6)).toFixed(6);
}

async function basicMarginCheck() {
  console.log(colorText("🔍 BASIC MARGIN CHECK", colors.bright));
  console.log("═".repeat(50));

  try {
    const vault = await getContract("CENTRALIZED_VAULT");
    const [deployer, user1, user2, user3] = await ethers.getSigners();

    console.log(`🏦 Vault Address: ${await vault.getAddress()}`);

    // Check basic user data using simple public mappings
    const users = [
      { signer: deployer, name: "Deployer" },
      { signer: user1, name: "User1" },
      { signer: user2, name: "User2" },
      { signer: user3, name: "User3" },
    ];

    for (const user of users) {
      console.log(
        colorText(`\n📊 ${user.name} (${user.signer.address})`, colors.yellow)
      );

      try {
        // Check basic collateral
        const collateral = await vault.userCollateral(user.signer.address);
        console.log(`   💰 Collateral: ${formatUSDC(collateral)} USDC`);

        // Check positions using the simple getter
        const positions = await vault.getUserPositions(user.signer.address);
        console.log(`   📍 Active Positions: ${positions.length}`);

        if (positions.length > 0) {
          let totalMarginFromPositions = 0n;

          for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            console.log(`     Position ${i}:`);
            console.log(`       Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
            console.log(`       Entry: $${formatUSDC(pos.entryPrice)}`);
            console.log(`       Margin: ${formatUSDC(pos.marginLocked)} USDC`);

            totalMarginFromPositions += pos.marginLocked;

            // Check market-specific margin
            try {
              const marketMargin = await vault.userMarginByMarket(
                user.signer.address,
                pos.marketId
              );
              console.log(
                `       Market Margin: ${formatUSDC(marketMargin)} USDC`
              );
            } catch (err) {
              console.log(`       Market Margin: Error - ${err.message}`);
            }
          }

          console.log(
            colorText(
              `   🔒 Total Margin from Positions: ${formatUSDC(
                totalMarginFromPositions
              )} USDC`,
              colors.cyan
            )
          );
        }

        // Try to check liquidation history
        try {
          const liquidatedCount = await vault.getUserLiquidatedPositionsCount(
            user.signer.address
          );
          console.log(`   💀 Liquidated Positions: ${liquidatedCount}`);

          if (liquidatedCount > 0) {
            for (let i = 0; i < liquidatedCount; i++) {
              const liquidated = await vault.getUserLiquidatedPosition(
                user.signer.address,
                i
              );
              console.log(`     Liquidation ${i}:`);
              console.log(
                `       Size: ${ethers.formatUnits(liquidated.size, 18)} ALU`
              );
              console.log(
                `       Margin Lost: ${formatUSDC(liquidated.marginLost)} USDC`
              );
              console.log(`       Reason: ${liquidated.reason}`);
            }
          }
        } catch (err) {
          console.log(`   💀 Liquidation history: Error - ${err.message}`);
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

    // Check global totals
    try {
      const totalMarginLocked = await vault.totalMarginLocked();
      const totalCollateralDeposited = await vault.totalCollateralDeposited();

      console.log(colorText("\n🌍 GLOBAL TOTALS", colors.bright));
      console.log(
        `   💰 Total Collateral Deposited: ${formatUSDC(
          totalCollateralDeposited
        )} USDC`
      );
      console.log(
        `   🔒 Total Margin Locked: ${formatUSDC(totalMarginLocked)} USDC`
      );
    } catch (error) {
      console.log(`   ❌ Error getting global totals: ${error.message}`);
    }

    console.log(colorText("\n✅ BASIC CHECK COMPLETE", colors.green));
  } catch (error) {
    console.error(
      colorText("❌ Basic check failed:", colors.red),
      error.message
    );
    console.error(error.stack);
  }
}

basicMarginCheck()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
