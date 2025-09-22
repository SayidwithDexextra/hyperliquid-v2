#!/usr/bin/env node

// test-liquidation-fix.js - Test script to demonstrate the liquidation pipeline fix
//
// 🚨 CRITICAL FIX DEMONSTRATION:
//   This script tests that market orders now properly trigger liquidation checks
//   Previously: _checkPositionsForLiquidation() was never called
//   Now: _checkPositionsForLiquidation() is called after every market order & trade

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

// Colors for console output
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
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(
    colorText("\n🚨 TESTING LIQUIDATION PIPELINE FIX", colors.brightMagenta)
  );
  console.log("=".repeat(60));

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  // Load contracts
  const mockUSDC = await getContract("MOCK_USDC", "MockUSDC");
  const vault = await getContract("CORE_VAULT", "CoreVault");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK", "OrderBook");

  console.log(colorText("\n📋 SETUP:", colors.brightBlue));
  console.log(`MockUSDC: ${await mockUSDC.getAddress()}`);
  console.log(`CoreVault: ${await vault.getAddress()}`);
  console.log(`OrderBook: ${await orderBook.getAddress()}`);

  // Set up event listeners to track the liquidation pipeline
  console.log(
    colorText("\n🔊 Setting up debug event listeners...", colors.brightYellow)
  );

  let eventsReceived = [];

  // Market order completion events
  orderBook.on(
    "DebugMarketOrderCompleted",
    (trader, filledAmount, totalAmount, reason, event) => {
      eventsReceived.push({
        type: "MarketOrderCompleted",
        trader,
        filledAmount: ethers.formatUnits(filledAmount, 18),
        totalAmount: ethers.formatUnits(totalAmount, 18),
        reason,
        blockNumber: event.blockNumber,
      });
      console.log(colorText(`\n🎯 MARKET ORDER COMPLETED`, colors.brightBlue));
      console.log(`Trader: ${trader}`);
      console.log(`Filled: ${ethers.formatUnits(filledAmount, 18)} ALU`);
      console.log(`Reason: ${reason}`);
    }
  );

  // Trade execution events
  orderBook.on(
    "DebugTradeCompleted",
    (buyer, seller, amount, price, reason, event) => {
      eventsReceived.push({
        type: "TradeCompleted",
        buyer,
        seller,
        amount: ethers.formatUnits(amount, 18),
        price: ethers.formatUnits(price, 6),
        reason,
        blockNumber: event.blockNumber,
      });
      console.log(colorText(`\n💱 TRADE EXECUTED`, colors.brightGreen));
      console.log(`Buyer: ${buyer}`);
      console.log(`Seller: ${seller}`);
      console.log(`Amount: ${ethers.formatUnits(amount, 18)} ALU`);
      console.log(`Price: $${ethers.formatUnits(price, 6)}`);
      console.log(`Reason: ${reason}`);
    }
  );

  // Liquidation trigger events
  orderBook.on(
    "DebugLiquidationTrigger",
    (markPrice, triggerPoint, triggeringUser, event) => {
      eventsReceived.push({
        type: "LiquidationTrigger",
        markPrice: ethers.formatUnits(markPrice, 6),
        triggerPoint,
        triggeringUser,
        blockNumber: event.blockNumber,
      });
      console.log(
        colorText(`\n🔔 LIQUIDATION CHECK TRIGGERED`, colors.brightYellow)
      );
      console.log(`Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
      console.log(`Trigger Point: ${triggerPoint}`);
      console.log(`Triggering User: ${triggeringUser}`);
    }
  );

  // Liquidation check completion events
  orderBook.on(
    "DebugLiquidationCheckComplete",
    (liquidationsTriggered, completionReason, event) => {
      eventsReceived.push({
        type: "LiquidationCheckComplete",
        liquidationsTriggered: liquidationsTriggered.toString(),
        completionReason,
        blockNumber: event.blockNumber,
      });
      console.log(
        colorText(
          `\n✅ LIQUIDATION CHECK COMPLETE`,
          liquidationsTriggered > 0 ? colors.brightRed : colors.brightGreen
        )
      );
      console.log(`Liquidations Triggered: ${liquidationsTriggered}`);
      console.log(`Reason: ${completionReason}`);
    }
  );

  // Position update debug events
  orderBook.on("DebugPositionUpdate", (user, amount, price, status, event) => {
    eventsReceived.push({
      type: "PositionUpdate",
      user,
      amount: ethers.formatUnits(amount, 18),
      price: ethers.formatUnits(price, 6),
      status,
      blockNumber: event.blockNumber,
    });
    console.log(colorText(`\n🔧 POSITION UPDATE DEBUG`, colors.brightCyan));
    console.log(`User: ${user}`);
    console.log(`Amount: ${ethers.formatUnits(amount, 18)} ALU`);
    console.log(`Price: $${ethers.formatUnits(price, 6)}`);
    console.log(`Status: ${status}`);
  });

  vault.on(
    "DebugVaultPositionUpdate",
    (user, marketId, sizeDelta, price, status, event) => {
      eventsReceived.push({
        type: "VaultPositionUpdate",
        user,
        marketId,
        sizeDelta: ethers.formatUnits(sizeDelta, 18),
        price: ethers.formatUnits(price, 6),
        status,
        blockNumber: event.blockNumber,
      });
      console.log(colorText(`\n🏛️ VAULT POSITION DEBUG`, colors.brightMagenta));
      console.log(`User: ${user}`);
      console.log(`Size Delta: ${ethers.formatUnits(sizeDelta, 18)} ALU`);
      console.log(`Price: $${ethers.formatUnits(price, 6)}`);
      console.log(`Status: ${status}`);
    }
  );

  // Vault liquidation events
  vault.on(
    "DebugVaultLiquidationEntry",
    (user, marketId, liquidationType, event) => {
      eventsReceived.push({
        type: "VaultLiquidationEntry",
        user,
        marketId,
        liquidationType,
        blockNumber: event.blockNumber,
      });
      console.log(
        colorText(`\n🏛️ VAULT LIQUIDATION STARTED`, colors.brightMagenta)
      );
      console.log(`User: ${user}`);
      console.log(`Type: ${liquidationType}`);
    }
  );

  vault.on(
    "DebugVaultLiquidationComplete",
    (user, marketId, collateralDeducted, result, event) => {
      eventsReceived.push({
        type: "VaultLiquidationComplete",
        user,
        marketId,
        collateralDeducted: ethers.formatUnits(collateralDeducted, 6),
        result,
        blockNumber: event.blockNumber,
      });
      console.log(
        colorText(`\n🏛️ VAULT LIQUIDATION COMPLETE`, colors.brightCyan)
      );
      console.log(`User: ${user}`);
      console.log(
        `Collateral Deducted: $${ethers.formatUnits(collateralDeducted, 6)}`
      );
      console.log(`Result: ${result}`);
    }
  );

  console.log(colorText("✅ Event listeners set up!", colors.brightGreen));

  // Test 1: Place a market order that should trigger liquidation checks
  console.log(
    colorText(
      "\n🧪 TEST 1: Market order triggering liquidation checks",
      colors.brightCyan
    )
  );
  console.log("Placing a small market buy order to test the pipeline...");

  try {
    // Get current user3 position (should have short position from deployment)
    const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));
    const [user3Size, user3Entry, user3Margin] = await vault.getPositionSummary(
      user3.address,
      marketId
    );
    console.log(
      `\nUser3 current position: ${ethers.formatUnits(
        user3Size,
        18
      )} ALU @ $${ethers.formatUnits(user3Entry, 6)}`
    );

    // Place a small market buy order from user1
    console.log("\nPlacing market buy order from User1 (1 ALU)...");
    const buyAmount = ethers.parseUnits("1", 18); // 1 ALU

    const tx = await orderBook
      .connect(user1)
      .placeMarginMarketOrder(buyAmount, true);
    const receipt = await tx.wait();

    console.log(
      colorText(
        `\n✅ Transaction completed! Block: ${receipt.blockNumber}`,
        colors.brightGreen
      )
    );

    // Wait a moment for events to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(colorText("\n📊 EVENTS SUMMARY:", colors.brightBlue));
    console.log(`Total events received: ${eventsReceived.length}`);

    eventsReceived.forEach((event, index) => {
      console.log(`${index + 1}. ${event.type} (Block: ${event.blockNumber})`);
    });

    // Check if liquidation pipeline was triggered
    const liquidationTriggered = eventsReceived.some(
      (e) => e.type === "LiquidationTrigger"
    );
    const liquidationCompleted = eventsReceived.some(
      (e) => e.type === "LiquidationCheckComplete"
    );

    // Check position update events
    const positionUpdateAttempted = eventsReceived.some(
      (e) => e.type === "PositionUpdate" && e.status.includes("Attempting")
    );
    const positionUpdateSucceeded = eventsReceived.some(
      (e) => e.type === "PositionUpdate" && e.status.includes("SUCCESS")
    );
    const vaultPositionUpdated = eventsReceived.some(
      (e) =>
        e.type === "VaultPositionUpdate" &&
        e.status.includes("completed successfully")
    );

    console.log(
      colorText("\n🔍 LIQUIDATION PIPELINE ANALYSIS:", colors.brightMagenta)
    );
    console.log(
      `Liquidation check triggered: ${
        liquidationTriggered
          ? colorText("✅ YES", colors.brightGreen)
          : colorText("❌ NO", colors.brightRed)
      }`
    );
    console.log(
      `Liquidation check completed: ${
        liquidationCompleted
          ? colorText("✅ YES", colors.brightGreen)
          : colorText("❌ NO", colors.brightRed)
      }`
    );

    console.log(colorText("\n🔍 POSITION UPDATE ANALYSIS:", colors.brightCyan));
    console.log(
      `Position update attempted: ${
        positionUpdateAttempted
          ? colorText("✅ YES", colors.brightGreen)
          : colorText("❌ NO", colors.brightRed)
      }`
    );
    console.log(
      `Position update succeeded: ${
        positionUpdateSucceeded
          ? colorText("✅ YES", colors.brightGreen)
          : colorText("❌ NO", colors.brightRed)
      }`
    );
    console.log(
      `Vault position updated: ${
        vaultPositionUpdated
          ? colorText("✅ YES", colors.brightGreen)
          : colorText("❌ NO", colors.brightRed)
      }`
    );

    if (liquidationTriggered && liquidationCompleted) {
      console.log(
        colorText(
          "\n🎉 SUCCESS! The liquidation pipeline fix is working!",
          colors.brightGreen
        )
      );
      console.log(
        "Market orders are now properly triggering liquidation checks!"
      );
    } else {
      console.log(
        colorText(
          "\n⚠️ The liquidation pipeline may not be fully working.",
          colors.brightYellow
        )
      );
      console.log(
        "Check that the OrderBook contract has been updated with the fix."
      );
    }

    if (!positionUpdateSucceeded || !vaultPositionUpdated) {
      console.log(
        colorText("\n❌ POSITION UPDATE ISSUE DETECTED!", colors.brightRed)
      );
      console.log("This explains why your position summary isn't updating.");
      console.log("Trades are matching but position updates are failing.");

      // Show failed position update events
      const failedEvents = eventsReceived.filter(
        (e) => e.type === "PositionUpdate" && e.status.includes("FAILED")
      );
      if (failedEvents.length > 0) {
        console.log(
          colorText("\n🔍 Failed Position Updates:", colors.brightRed)
        );
        failedEvents.forEach((event) => {
          console.log(`  User: ${event.user}, Status: ${event.status}`);
        });
      }
    } else {
      console.log(
        colorText(
          "\n✅ Position updates are working correctly!",
          colors.brightGreen
        )
      );
    }
  } catch (error) {
    console.error(
      colorText(`\n❌ Error during test: ${error.message}`, colors.brightRed)
    );
    console.error(error);
  }

  // Test 2: Check if user3 is liquidatable
  console.log(
    colorText("\n🧪 TEST 2: Check User3 liquidation status", colors.brightCyan)
  );

  try {
    const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));
    const markPrice = await vault.getMarkPrice(marketId);
    const isLiquidatable = await vault.isLiquidatable(
      user3.address,
      marketId,
      markPrice
    );
    const [liquidationPrice, hasPosition] = await vault.getLiquidationPrice(
      user3.address,
      marketId
    );

    console.log(`Current mark price: $${ethers.formatUnits(markPrice, 6)}`);
    if (hasPosition) {
      console.log(
        `User3 liquidation price: $${ethers.formatUnits(liquidationPrice, 6)}`
      );
      console.log(
        `Is liquidatable: ${
          isLiquidatable
            ? colorText("✅ YES", colors.brightRed)
            : colorText("❌ NO", colors.brightGreen)
        }`
      );

      if (isLiquidatable) {
        console.log(
          colorText(
            "\n💡 User3 is liquidatable! Try placing another market order to trigger liquidation.",
            colors.brightYellow
          )
        );
      } else {
        console.log(
          colorText(
            "\n📈 User3 is healthy. To test liquidation, update the mark price above the liquidation price:",
            colors.brightBlue
          )
        );
        console.log(
          `Example: await vault.updateMarkPrice(marketId, ethers.parseUnits("${
            Math.ceil(Number(ethers.formatUnits(liquidationPrice, 6))) + 0.1
          }", 6))`
        );
      }
    } else {
      console.log("User3 has no position");
    }
  } catch (error) {
    console.error(
      colorText(
        `Error checking liquidation status: ${error.message}`,
        colors.brightRed
      )
    );
  }

  console.log(colorText("\n🏁 TEST COMPLETED!", colors.brightGreen));
  console.log("=".repeat(60));

  process.exit(0);
}

// Error handling
main().catch((error) => {
  console.error(colorText("\n💥 Test script failed:", colors.brightRed), error);
  process.exit(1);
});
