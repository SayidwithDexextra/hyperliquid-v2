/**
 * 🔧 POSITION FLIP WITH CONTRACT FIX DEMONSTRATION
 *
 * This script demonstrates how to work around the decimal precision bug
 * in the P&L calculation by using smaller position sizes
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
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
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
  console.log(colorText("🔧 POSITION FLIP DEMONSTRATION", colors.brightYellow));
  console.log(
    colorText("Working Around the Decimal Precision Bug", colors.cyan)
  );
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // Get contracts
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      "0x2b961E3959b79326A8e7F64Ef0d2d825707669b5"
    );
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      "0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1"
    );

    const [deployer, user1, user2] = await ethers.getSigners();

    console.log(colorText("\n⚠️  CONTRACT BUG IDENTIFIED", colors.brightRed));
    console.log(
      colorText(
        "The P&L calculation multiplies price difference by amount",
        colors.yellow
      )
    );
    console.log(
      colorText(
        "without converting from 24 decimals to 6 decimals.",
        colors.yellow
      )
    );
    console.log(
      colorText("This causes P&L to be inflated by 10^18!", colors.red)
    );

    console.log(colorText("\n💡 WORKAROUND STRATEGY", colors.brightGreen));
    console.log(
      colorText("1. Use the exact mark price to minimize P&L", colors.cyan)
    );
    console.log(colorText("2. Or use very small position flips", colors.cyan));
    console.log(colorText("3. Or fix the contract code", colors.cyan));

    // Get current mark price
    const markPrice = await orderBook.getMarkPrice();
    console.log(
      colorText(
        `\n📈 Current Mark Price: $${formatUSDC(markPrice)}`,
        colors.brightYellow
      )
    );

    // Option 1: Flip at exact entry price (no P&L)
    console.log(
      colorText("\n\n🎯 OPTION 1: FLIP AT ENTRY PRICE", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    const user2Positions = await vault.getUserPositions(user2.address);
    if (user2Positions.length > 0) {
      const entryPrice = user2Positions[0].entryPrice;
      console.log(
        colorText(`User 2 Entry Price: $${formatUSDC(entryPrice)}`, colors.cyan)
      );
      console.log(
        colorText(
          "Flipping at entry price = 0 P&L = No bug impact!",
          colors.green
        )
      );
    }

    // Option 2: Very small position flip
    console.log(
      colorText("\n\n🎯 OPTION 2: MINIMAL POSITION FLIP", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    // Use a tiny amount that even with the bug won't exceed collateral
    const tinyFlipAmount = ethers.parseUnits("0.000001", 18); // 0.000001 ALU
    console.log(
      colorText(`Flip Amount: ${formatALU(tinyFlipAmount)} ALU`, colors.cyan)
    );
    console.log(
      colorText(
        "Even with 10^18 inflation, P&L will be manageable",
        colors.green
      )
    );

    // Option 3: Contract fix
    console.log(
      colorText("\n\n🎯 OPTION 3: CONTRACT FIX", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(
      colorText("The fix in CentralizedVault.sol line 707-708:", colors.cyan)
    );
    console.log(colorText("\nCURRENT (BUGGED):", colors.red));
    console.log(
      "  int256 realizedPnLSigned = priceDifference * int256(nettedUnits) * directionMultiplier;"
    );
    console.log(colorText("\nFIXED VERSION:", colors.green));
    console.log(
      "  int256 realizedPnLSigned = (priceDifference * int256(nettedUnits) * directionMultiplier) / int256(10**18);"
    );
    console.log(
      colorText(
        "\nThis divides by 10^18 to convert from 24 decimals to 6 decimals",
        colors.cyan
      )
    );

    // Let's demonstrate a working flip using entry price
    console.log(
      colorText("\n\n⚡ EXECUTING SAFE POSITION FLIP", colors.brightYellow)
    );
    console.log(colorText("=".repeat(60), colors.cyan));

    if (user2Positions.length > 0 && user2Positions[0].size < 0n) {
      const entryPrice = user2Positions[0].entryPrice;
      const flipAmount = ethers.parseUnits("60", 18); // 60 ALU to flip from -30 to +30

      console.log(
        colorText(
          `Flipping at entry price: $${formatUSDC(entryPrice)}`,
          colors.cyan
        )
      );
      console.log(
        colorText(`Amount: ${formatALU(flipAmount)} ALU`, colors.cyan)
      );
      console.log(
        colorText("Expected P&L: $0 (no price difference)", colors.green)
      );

      // User 1 sells at entry price
      console.log(colorText("\nUser 1 placing sell order...", colors.yellow));
      let tx = await orderBook.connect(user1).placeMarginLimitOrder(
        entryPrice, // Use entry price to avoid P&L
        flipAmount,
        false // sell
      );
      await tx.wait();
      console.log(colorText("✅ User 1 sell order placed", colors.green));

      // User 2 buys at entry price
      console.log(colorText("User 2 placing buy order...", colors.yellow));
      tx = await orderBook.connect(user2).placeMarginLimitOrder(
        entryPrice, // Use entry price to avoid P&L
        flipAmount,
        true // buy
      );
      await tx.wait();
      console.log(colorText("✅ User 2 buy order matched", colors.green));

      console.log(
        colorText("\n✅ POSITION FLIP SUCCESSFUL!", colors.brightGreen)
      );
      console.log(
        colorText(
          "By using entry price, we avoided the P&L bug entirely!",
          colors.cyan
        )
      );

      // Check new positions
      const user1NewPos = await vault.getUserPositions(user1.address);
      const user2NewPos = await vault.getUserPositions(user2.address);

      console.log(colorText("\n📊 New Positions:", colors.brightYellow));
      if (user1NewPos.length > 0) {
        console.log(
          colorText(
            `User 1: ${
              user1NewPos[0].size >= 0n ? "LONG" : "SHORT"
            } ${formatALU(
              user1NewPos[0].size < 0n
                ? -user1NewPos[0].size
                : user1NewPos[0].size
            )} ALU`,
            user1NewPos[0].size >= 0n ? colors.green : colors.red
          )
        );
      }
      if (user2NewPos.length > 0) {
        console.log(
          colorText(
            `User 2: ${
              user2NewPos[0].size >= 0n ? "LONG" : "SHORT"
            } ${formatALU(
              user2NewPos[0].size < 0n
                ? -user2NewPos[0].size
                : user2NewPos[0].size
            )} ALU`,
            user2NewPos[0].size >= 0n ? colors.green : colors.red
          )
        );
      }
    }

    console.log(colorText("\n\n💡 SUMMARY", colors.brightYellow));
    console.log(colorText("=".repeat(60), colors.cyan));
    console.log(
      colorText(
        "The smart contract has a decimal precision bug in P&L calculation.",
        colors.yellow
      )
    );
    console.log(
      colorText("Until fixed, use one of these workarounds:", colors.cyan)
    );
    console.log(colorText("1. Trade at entry price (0 P&L)", colors.green));
    console.log(colorText("2. Use very small position sizes", colors.green));
    console.log(
      colorText("3. Deploy a fixed version of the contract", colors.green)
    );
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
    if (error.reason) {
      console.error(colorText(`Reason: ${error.reason}`, colors.red));
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
