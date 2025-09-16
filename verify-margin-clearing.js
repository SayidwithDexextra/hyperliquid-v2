#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bright: "\x1b[1m",
  reset: "\x1b[0m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatUSDC(value) {
  return parseFloat(ethers.formatUnits(value, 6)).toFixed(6);
}

function formatALU(value) {
  return parseFloat(ethers.formatUnits(value, 18)).toFixed(6);
}

async function checkUserMarginStatus(vault, user, userName) {
  console.log(colorText(`\n📊 ${userName} MARGIN STATUS`, colors.bright));
  console.log(colorText("─".repeat(50), colors.cyan));

  try {
    // Get margin summary
    const marginSummary = await vault.getMarginSummary(user.address);
    console.log(
      `💰 Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`
    );
    console.log(`🔒 Margin Used: ${formatUSDC(marginSummary.marginUsed)} USDC`);
    console.log(
      `💼 Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`
    );

    // Get active positions
    const positions = await vault.getUserPositions(user.address);
    console.log(`📍 Active Positions: ${positions.length}`);

    if (positions.length > 0) {
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        console.log(`   Position ${i}:`);
        console.log(`     Size: ${formatALU(pos.size)} ALU`);
        console.log(`     Entry Price: $${formatUSDC(pos.entryPrice)}`);
        console.log(`     Margin Locked: ${formatUSDC(pos.marginLocked)} USDC`);
        console.log(`     Market ID: ${pos.marketId.substring(0, 16)}...`);

        // Check the specific market margin mapping
        try {
          const marginForMarket = await vault.userMarginByMarket(
            user.address,
            pos.marketId
          );
          console.log(
            `     Market Margin: ${formatUSDC(marginForMarket)} USDC`
          );
        } catch (error) {
          console.log(`     Market Margin: Error - ${error.message}`);
        }
      }
    }

    // Get liquidated positions
    try {
      const liquidatedPositions = await vault.getUserLiquidatedPositions(
        user.address
      );
      console.log(`💀 Liquidated Positions: ${liquidatedPositions.length}`);

      if (liquidatedPositions.length > 0) {
        for (let i = 0; i < liquidatedPositions.length; i++) {
          const liq = liquidatedPositions[i];
          console.log(`   Liquidation ${i}:`);
          console.log(`     Size: ${formatALU(liq.size)} ALU`);
          console.log(`     Entry Price: $${formatUSDC(liq.entryPrice)}`);
          console.log(
            `     Liquidation Price: $${formatUSDC(liq.liquidationPrice)}`
          );
          console.log(
            `     Margin Locked: ${formatUSDC(liq.marginLocked)} USDC`
          );
          console.log(`     Margin Lost: ${formatUSDC(liq.marginLost)} USDC`);
          console.log(`     Reason: ${liq.reason}`);
        }
      }
    } catch (error) {
      console.log(`💀 Liquidated Positions: Error - ${error.message}`);
    }

    return {
      totalCollateral: marginSummary.totalCollateral,
      marginUsed: marginSummary.marginUsed,
      availableCollateral: marginSummary.availableCollateral,
      activePositions: positions.length,
      positions: positions,
    };
  } catch (error) {
    console.log(
      colorText(`❌ Error checking ${userName}: ${error.message}`, colors.red)
    );
    return null;
  }
}

async function main() {
  console.log(colorText("🔍 MARGIN CLEARING VERIFICATION", colors.bright));
  console.log(colorText("═".repeat(60), colors.cyan));

  try {
    const vault = await getContract("CENTRALIZED_VAULT");
    const [deployer, user1, user2, user3] = await ethers.getSigners();

    console.log(`🏦 Vault Address: ${await vault.getAddress()}`);

    // Check all users
    const users = [
      { signer: deployer, name: "Deployer" },
      { signer: user1, name: "User1" },
      { signer: user2, name: "User2" },
      { signer: user3, name: "User3" },
    ];

    for (const user of users) {
      const status = await checkUserMarginStatus(vault, user.signer, user.name);

      if (status && status.marginUsed > 0) {
        console.log(
          colorText(`\n⚠️ ${user.name} HAS LOCKED MARGIN`, colors.yellow)
        );

        // Check if this is legitimate (has active positions) or stuck
        if (status.activePositions === 0) {
          console.log(
            colorText(
              `❌ STUCK MARGIN DETECTED - ${user.name} has ${formatUSDC(
                status.marginUsed
              )} USDC locked with no active positions!`,
              colors.red
            )
          );
        } else {
          console.log(
            colorText(
              `✅ Legitimate margin usage - ${user.name} has ${status.activePositions} active position(s)`,
              colors.green
            )
          );
        }
      } else if (status && status.marginUsed === 0n) {
        console.log(
          colorText(`✅ ${user.name} - No margin locked`, colors.green)
        );
      }
    }

    console.log(colorText("\n🎯 SUMMARY", colors.bright));
    console.log(colorText("─".repeat(60), colors.cyan));

    let totalMarginUsed = 0n;
    let usersWithStuckMargin = 0;

    for (const user of users) {
      const status = await checkUserMarginStatus(vault, user.signer, user.name);
      if (status) {
        totalMarginUsed += status.marginUsed;
        if (status.marginUsed > 0 && status.activePositions === 0) {
          usersWithStuckMargin++;
        }
      }
    }

    console.log(
      `📊 Total System Margin Used: ${formatUSDC(totalMarginUsed)} USDC`
    );
    console.log(`❌ Users with Stuck Margin: ${usersWithStuckMargin}`);

    if (usersWithStuckMargin === 0) {
      console.log(
        colorText(
          "\n✅ ALL MARGIN PROPERLY MANAGED - NO ISSUES DETECTED!",
          colors.green
        )
      );
    } else {
      console.log(
        colorText(
          `\n⚠️ ${usersWithStuckMargin} USER(S) HAVE STUCK MARGIN - NEEDS INVESTIGATION`,
          colors.red
        )
      );
    }
  } catch (error) {
    console.error(colorText("❌ Test failed:", colors.red), error.message);
    console.error(error.stack);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
