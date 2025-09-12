/**
 * 🔍 DIAGNOSE COLLATERAL ISSUE
 *
 * This script investigates why "insufficient collateral for loss" is occurring
 * despite massive collateral deposits
 */

const { ethers } = require("hardhat");

// Color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightYellow: "\x1b[93m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  try {
    return ethers.formatUnits(value, 6);
  } catch (e) {
    return `ERROR: ${value?.toString() || "undefined"}`;
  }
}

function formatALU(value) {
  try {
    return ethers.formatUnits(value, 18);
  } catch (e) {
    return `ERROR: ${value?.toString() || "undefined"}`;
  }
}

async function main() {
  console.clear();
  console.log(colorText("🔍 DIAGNOSE COLLATERAL ISSUE", colors.brightYellow));
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // Get contracts
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1"
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      "0x2b961E3959b79326A8e7F64Ef0d2d825707669b5"
    );

    const [deployer, user1, user2] = await ethers.getSigners();

    // Check raw collateral values
    console.log(colorText("\n📊 RAW COLLATERAL VALUES", colors.brightYellow));

    const user1Collateral = await vault.userCollateral(user1.address);
    const user2Collateral = await vault.userCollateral(user2.address);

    console.log(colorText(`\nUser 1 Collateral:`, colors.cyan));
    console.log(`  Raw value: ${user1Collateral.toString()}`);
    console.log(`  Formatted: ${formatUSDC(user1Collateral)} USDC`);

    console.log(colorText(`\nUser 2 Collateral:`, colors.cyan));
    console.log(`  Raw value: ${user2Collateral.toString()}`);
    console.log(`  Formatted: ${formatUSDC(user2Collateral)} USDC`);

    // Check positions
    console.log(colorText("\n\n📍 CURRENT POSITIONS", colors.brightYellow));

    const user1Positions = await vault.getUserPositions(user1.address);
    const user2Positions = await vault.getUserPositions(user2.address);

    console.log(
      colorText(`\nUser 1 Positions: ${user1Positions.length}`, colors.cyan)
    );
    if (user1Positions.length > 0) {
      const pos = user1Positions[0];
      console.log(
        `  Size: ${pos.size.toString()} (${formatALU(pos.size)} ALU)`
      );
      console.log(`  Entry Price: ${formatUSDC(pos.entryPrice)} USDC`);
      console.log(`  Side: ${pos.size >= 0n ? "LONG" : "SHORT"}`);
    }

    console.log(
      colorText(`\nUser 2 Positions: ${user2Positions.length}`, colors.cyan)
    );
    if (user2Positions.length > 0) {
      const pos = user2Positions[0];
      console.log(
        `  Size: ${pos.size.toString()} (${formatALU(pos.size)} ALU)`
      );
      console.log(`  Entry Price: ${formatUSDC(pos.entryPrice)} USDC`);
      console.log(`  Side: ${pos.size >= 0n ? "LONG" : "SHORT"}`);
    }

    // Simulate position netting calculation
    console.log(
      colorText("\n\n🧮 SIMULATING POSITION FLIP", colors.brightYellow)
    );

    const markPrice = await orderBook.getMarkPrice();
    console.log(`Current Mark Price: ${formatUSDC(markPrice)} USDC`);

    // For User 2 (SHORT position at $10, buying at $10.5)
    if (user2Positions.length > 0 && user2Positions[0].size < 0n) {
      const pos = user2Positions[0];
      const absSize = -pos.size;
      const entryPrice = pos.entryPrice;

      console.log(
        colorText("\nUser 2 SHORT position closing calculation:", colors.yellow)
      );
      console.log(
        `  Position: SHORT ${formatALU(absSize)} ALU @ $${formatUSDC(
          entryPrice
        )}`
      );
      console.log(`  Closing at: $${formatUSDC(markPrice)}`);

      // Loss = (exitPrice - entryPrice) * size (for short positions)
      const priceDiff = markPrice - entryPrice;
      const loss = (priceDiff * absSize) / BigInt(10 ** 18);

      console.log(`  Price difference: $${formatUSDC(priceDiff)}`);
      console.log(`  Loss amount: ${formatUSDC(loss)} USDC`);
      console.log(`  User collateral: ${formatUSDC(user2Collateral)} USDC`);
      console.log(
        `  Can cover loss: ${user2Collateral >= loss ? "YES" : "NO"}`
      );

      // Check for overflow or precision issues
      console.log(colorText("\n⚠️  POTENTIAL ISSUES:", colors.red));

      // Check if the collateral value is suspiciously large
      if (user2Collateral > BigInt(10 ** 15)) {
        // More than 1 billion USDC
        console.log("  - Collateral value seems unrealistically large");
        console.log("  - This might cause overflow in calculations");
      }

      // Check margin summary
      console.log(colorText("\n📊 MARGIN SUMMARY CHECK", colors.cyan));
      try {
        const marginSummary = await vault.getMarginSummary(user2.address);
        console.log(
          `  Total Collateral: ${formatUSDC(
            marginSummary.totalCollateral
          )} USDC`
        );
        console.log(
          `  Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`
        );
        console.log(
          `  Reserved: ${formatUSDC(marginSummary.reservedMargin)} USDC`
        );
      } catch (e) {
        console.log(`  Error getting margin summary: ${e.message}`);
      }
    }

    // Check for any pending orders that might be reserving collateral
    console.log(
      colorText("\n\n🔍 CHECKING FOR HIDDEN ISSUES", colors.brightYellow)
    );

    // Get available collateral
    try {
      const user1Available = await vault.getAvailableCollateral(user1.address);
      const user2Available = await vault.getAvailableCollateral(user2.address);

      console.log(
        `User 1 Available Collateral: ${formatUSDC(user1Available)} USDC`
      );
      console.log(
        `User 2 Available Collateral: ${formatUSDC(user2Available)} USDC`
      );
    } catch (e) {
      console.log(`Error getting available collateral: ${e.message}`);
    }

    // Direct contract call to check position netting
    console.log(
      colorText(
        "\n\n🔬 TESTING POSITION NETTING CALCULATION",
        colors.brightYellow
      )
    );

    if (user2Positions.length > 0) {
      const buyAmount = ethers.parseUnits("60", 18);
      const buyPrice = markPrice;

      try {
        const nettingSummary = await vault.getPositionNettingSummary(
          user2.address,
          await vault.userPositions(user2.address, 0).then((p) => p.marketId),
          buyAmount, // Buying 60 ALU
          buyPrice
        );

        console.log("Position Netting Summary:");
        console.log(`  ${nettingSummary.summary}`);
        console.log(
          `  Realized P&L: ${formatUSDC(nettingSummary.realizedPnL)} USDC`
        );
        console.log(`  Is Profit: ${nettingSummary.isProfit}`);
        console.log(
          `  Closed Units: ${formatALU(nettingSummary.closedUnits)} ALU`
        );
      } catch (e) {
        console.log(`Error getting netting summary: ${e.message}`);
      }
    }

    console.log(colorText("\n\n💡 DIAGNOSIS COMPLETE", colors.brightGreen));
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    console.error(error);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
