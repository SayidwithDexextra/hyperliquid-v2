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

async function checkAllMarginClearing(vault, user, marketId, userName) {
  console.log(
    colorText(`\n🔍 CHECKING ALL MARGIN SOURCES FOR ${userName}`, colors.bright)
  );
  console.log(colorText("─".repeat(70), colors.cyan));

  // 1. Check userMarginByMarket mapping
  const marginByMarket = await vault.userMarginByMarket(user.address, marketId);
  console.log(
    `📊 userMarginByMarket[${userName}][market]: ${formatUSDC(
      marginByMarket
    )} USDC`
  );

  // 2. Check user positions (including marginLocked in Position struct)
  const positions = await vault.getUserPositions(user.address);
  console.log(`📍 Active positions count: ${positions.length}`);

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (pos.marketId === marketId) {
      console.log(
        `   Position ${i}: Size: ${formatALU(
          pos.size
        )} ALU, MarginLocked: ${formatUSDC(pos.marginLocked)} USDC`
      );
    }
  }

  // 3. Check liquidated positions history
  const liquidatedPositions = await vault.getUserLiquidatedPositions(
    user.address
  );
  console.log(`💀 Liquidated positions count: ${liquidatedPositions.length}`);

  for (let i = 0; i < liquidatedPositions.length; i++) {
    const liq = liquidatedPositions[i];
    console.log(
      `   Liquidation ${i}: Size: ${formatALU(
        liq.size
      )} ALU, MarginLocked: ${formatUSDC(
        liq.marginLocked
      )} USDC, MarginLost: ${formatUSDC(liq.marginLost)} USDC`
    );
  }

  // 4. Calculate total margin used
  const marginSummary = await vault.getMarginSummary(user.address);
  console.log(`💰 Margin Summary:`);
  console.log(
    `   Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`
  );
  console.log(`   Margin Used: ${formatUSDC(marginSummary.marginUsed)} USDC`);
  console.log(
    `   Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`
  );

  // Verify no margin is locked for this market
  const hasStuckMargin = marginByMarket > 0 && positions.length === 0;

  return {
    marginByMarket: marginByMarket,
    activePositions: positions.length,
    marginUsed: marginSummary.marginUsed,
    hasStuckMargin: hasStuckMargin,
    availableCollateral: marginSummary.availableCollateral,
  };
}

async function main() {
  console.log(
    colorText("🧪 COMPREHENSIVE MARGIN CLEARING TEST", colors.bright)
  );
  console.log(colorText("═".repeat(70), colors.cyan));

  try {
    const { MARKET_INFO } = require("./config/contracts");
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const [deployer, user1, user2] = await ethers.getSigners();

    // Get market ID from config
    const marketId = MARKET_INFO.ALUMINUM.marketId;
    console.log(`🏭 Testing with market: ${marketId.substring(0, 16)}...`);
    console.log(`📊 Market symbol: ${MARKET_INFO.ALUMINUM.symbol}`);

    console.log(colorText("\n📋 STEP 1: CHECK INITIAL STATE", colors.yellow));
    const initialState = await checkAllMarginClearing(
      vault,
      user1,
      marketId,
      "User1"
    );

    if (initialState.hasStuckMargin) {
      console.log(
        colorText("\n⚠️ FOUND STUCK MARGIN - TESTING CLEANUP", colors.yellow)
      );

      // Try to clear the stuck margin using the emergency functions we created
      console.log("Attempting to release stuck margin...");

      try {
        // Use the fixPositionMargin function to correct the margin
        await vault.fixPositionMargin(user1.address, marketId);
        console.log(
          colorText("✅ Successfully fixed position margin", colors.green)
        );
      } catch (error) {
        console.log(
          colorText(
            "❌ Could not fix position margin automatically",
            colors.red
          )
        );
        console.log("Error:", error.message);

        // If the position doesn't exist, we might need to manually clear the margin
        console.log("Attempting emergency margin release...");
        try {
          const stuckAmount = await vault.userMarginByMarket(
            user1.address,
            marketId
          );
          if (stuckAmount > 0) {
            await vault.emergencyReleaseMargin(
              user1.address,
              marketId,
              stuckAmount,
              "Manual cleanup of stuck margin after liquidation"
            );
            console.log(
              colorText("✅ Emergency margin release successful", colors.green)
            );
          }
        } catch (emergencyError) {
          console.log(
            colorText("❌ Emergency margin release failed", colors.red)
          );
          console.log("Error:", emergencyError.message);
        }
      }

      // Check state after cleanup attempt
      console.log(
        colorText("\n📋 STEP 2: CHECK STATE AFTER CLEANUP", colors.yellow)
      );
      const afterCleanupState = await checkAllMarginClearing(
        vault,
        user1,
        marketId,
        "User1"
      );

      if (afterCleanupState.hasStuckMargin) {
        console.log(
          colorText(
            "\n❌ MARGIN STILL STUCK - FURTHER INVESTIGATION NEEDED",
            colors.red
          )
        );

        // Detailed debugging
        console.log("\n🔍 DEBUGGING INFORMATION:");
        const userMarketIds = await vault.getUserMarketIds(user1.address);
        console.log(`User market IDs: ${userMarketIds.length}`);

        // Check if user still has pending orders
        const pendingOrders = await vault.getUserPendingOrders(user1.address);
        console.log(`Pending orders: ${pendingOrders.length}`);
        for (let i = 0; i < pendingOrders.length; i++) {
          const order = pendingOrders[i];
          console.log(
            `   Order ${i}: MarginReserved: ${formatUSDC(
              order.marginReserved
            )} USDC`
          );
        }
      } else {
        console.log(
          colorText("\n✅ MARGIN SUCCESSFULLY CLEARED!", colors.green)
        );
      }
    } else {
      console.log(colorText("\n✅ NO STUCK MARGIN DETECTED", colors.green));
    }

    console.log(colorText("\n📊 FINAL STATE SUMMARY", colors.bright));
    const finalState = await checkAllMarginClearing(
      vault,
      user1,
      marketId,
      "User1"
    );

    console.log(colorText("\n🎯 TEST RESULTS:", colors.bright));
    console.log(
      `Margin by Market: ${formatUSDC(finalState.marginByMarket)} USDC ${
        finalState.marginByMarket === 0n
          ? colorText("✅", colors.green)
          : colorText("❌", colors.red)
      }`
    );
    console.log(
      `Active Positions: ${finalState.activePositions} ${
        finalState.activePositions === 0
          ? colorText("✅", colors.green)
          : colorText("⚠️", colors.yellow)
      }`
    );
    console.log(
      `Total Margin Used: ${formatUSDC(finalState.marginUsed)} USDC ${
        finalState.marginUsed === 0n
          ? colorText("✅", colors.green)
          : colorText("⚠️", colors.yellow)
      }`
    );
    console.log(
      `Has Stuck Margin: ${finalState.hasStuckMargin} ${
        !finalState.hasStuckMargin
          ? colorText("✅", colors.green)
          : colorText("❌", colors.red)
      }`
    );
  } catch (error) {
    console.error(colorText("❌ Test failed:", colors.red), error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
