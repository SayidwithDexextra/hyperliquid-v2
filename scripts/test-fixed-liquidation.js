#!/usr/bin/env node

// test-fixed-liquidation.js - Test Fixed Liquidation Mechanism
//
// 🎯 PURPOSE:
//   Test the fixed liquidation mechanism after the smart contract fix
//

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(4);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function testFixedLiquidation() {
  console.log(
    colorText("\n🔧 TESTING FIXED LIQUIDATION MECHANISM", colors.brightYellow)
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const signers = await ethers.getSigners();
    const user2Address = signers[2].address; // User 2
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(colorText(`\n👤 User 2: ${user2Address}`, colors.brightCyan));
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Get all position IDs
    const positionIds = await orderBook.getUserPositions(user2Address);
    console.log(
      colorText(`\n📊 Total position IDs: ${positionIds.length}`, colors.cyan)
    );

    // Get current mark price
    const currentMarkPrice = await orderBook.getMarkPrice();
    const markPriceFloat = parseFloat(ethers.formatUnits(currentMarkPrice, 6));
    console.log(
      colorText(
        `💰 Current Mark Price: $${markPriceFloat.toFixed(4)}`,
        colors.brightGreen
      )
    );

    let liquidatedCount = 0;
    let skippedCount = 0;

    console.log(
      colorText(
        "\n┌─────────────────────────────────────────────────────────────────────────────────┐",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "│ ID │ Status    │ Side  │ Size    │ Entry Price │ Liq Price  │ Should Liquidate │",
        colors.bright
      )
    );
    console.log(
      colorText(
        "├─────────────────────────────────────────────────────────────────────────────────┤",
        colors.cyan
      )
    );

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      try {
        const isolatedPos = await orderBook.getPosition(
          user2Address,
          positionId
        );

        // Skip inactive positions
        if (!isolatedPos.isActive) {
          console.log(
            colorText(
              `│ ${positionId
                .toString()
                .padStart(
                  2
                )} │ SKIPPED   │ N/A   │ N/A     │ N/A         │ N/A        │ N/A            │`,
              colors.dim
            )
          );
          skippedCount++;
          continue;
        }

        const positionSize = BigInt(isolatedPos.size.toString());
        const absSize = positionSize < 0n ? -positionSize : positionSize;
        const side = positionSize >= 0n ? "LONG" : "SHORT";
        const sideColor = positionSize >= 0n ? colors.green : colors.red;

        const size = formatAmount(absSize);
        const entryPrice = formatPrice(
          BigInt(isolatedPos.entryPrice.toString())
        );
        const liquidationPrice = formatPrice(
          BigInt(isolatedPos.liquidationPrice.toString())
        );

        // Check if position should be liquidated
        const shouldLiquidate =
          positionSize > 0n
            ? markPriceFloat <= parseFloat(liquidationPrice) // Long: liquidate if price <= liquidation price
            : markPriceFloat >= parseFloat(liquidationPrice); // Short: liquidate if price >= liquidation price

        if (shouldLiquidate) {
          try {
            console.log(
              colorText(
                `│ ${positionId
                  .toString()
                  .padStart(2)} │ LIQUIDATING│ ${colorText(
                  side.padEnd(5),
                  sideColor
                )} │ ${size.padStart(8)} │ $${entryPrice.padStart(
                  10
                )} │ $${liquidationPrice.padStart(10)} │ ⚠️ YES         │`,
                colors.yellow
              )
            );

            // Attempt liquidation with the fixed mechanism
            // Use positionId = 0 for regular margin positions
            const tx = await orderBook
              .connect(liquidator)
              .checkAndLiquidatePosition(user2Address, 0);
            const receipt = await tx.wait();

            console.log(
              colorText(
                `│ ${positionId
                  .toString()
                  .padStart(2)} │ ✅ LIQUIDATED│ ${colorText(
                  side.padEnd(5),
                  sideColor
                )} │ ${size.padStart(8)} │ $${entryPrice.padStart(
                  10
                )} │ $${liquidationPrice.padStart(10)} │ ✅ DONE       │`,
                colors.green
              )
            );
            console.log(
              colorText(`   TX: ${receipt.transactionHash}`, colors.dim)
            );

            liquidatedCount++;
          } catch (liquidateError) {
            console.log(
              colorText(
                `│ ${positionId
                  .toString()
                  .padStart(2)} │ ❌ FAILED   │ ${colorText(
                  side.padEnd(5),
                  sideColor
                )} │ ${size.padStart(8)} │ $${entryPrice.padStart(
                  10
                )} │ $${liquidationPrice.padStart(10)} │ ❌ ERROR      │`,
                colors.red
              )
            );
            console.error(
              `Liquidation error for position ${positionId}:`,
              liquidateError.message
            );
          }
        } else {
          console.log(
            colorText(
              `│ ${positionId.toString().padStart(2)} │ SKIPPED   │ ${colorText(
                side.padEnd(5),
                sideColor
              )} │ ${size.padStart(8)} │ $${entryPrice.padStart(
                10
              )} │ $${liquidationPrice.padStart(10)} │ ✅ NO         │`,
              colors.dim
            )
          );
          skippedCount++;
        }
      } catch (error) {
        console.log(
          colorText(
            `│ ${positionId
              .toString()
              .padStart(
                2
              )} │ ERROR     │ ERROR │ ERROR   │ ERROR      │ ERROR      │ ERROR         │`,
            colors.red
          )
        );
        console.error(`Error with position ${positionId}:`, error.message);
      }
    }

    console.log(
      colorText(
        "└─────────────────────────────────────────────────────────────────────────────────┘",
        colors.cyan
      )
    );

    console.log(colorText(`\n📊 LIQUIDATION SUMMARY:`, colors.brightCyan));
    console.log(
      colorText(`   ⚡ Liquidated: ${liquidatedCount}`, colors.green)
    );
    console.log(colorText(`   ⏭️  Skipped: ${skippedCount}`, colors.yellow));

    if (liquidatedCount > 0) {
      console.log(
        colorText(
          `\n🎉 Successfully liquidated ${liquidatedCount} position(s)!`,
          colors.brightGreen
        )
      );
      console.log(
        colorText(
          `   The liquidation mechanism is now working correctly.`,
          colors.white
        )
      );
    } else {
      console.log(
        colorText(
          `\n⚠️  No positions were liquidated. This could mean:`,
          colors.yellow
        )
      );
      console.log(
        colorText(`   1. All positions are already liquidated`, colors.white)
      );
      console.log(
        colorText(`   2. No positions meet liquidation criteria`, colors.white)
      );
      console.log(
        colorText(
          `   3. The liquidation mechanism still has issues`,
          colors.white
        )
      );
    }
  } catch (error) {
    console.log(
      colorText("⚠️ Could not test liquidation: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the test
testFixedLiquidation().catch(console.error);
