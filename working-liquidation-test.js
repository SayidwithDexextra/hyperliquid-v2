#!/usr/bin/env node

// working-liquidation-test.js - Test liquidation pipeline with working contracts

const { ethers } = require("ethers");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
  brightBlue: "\x1b[94m",
  brightYellow: "\x1b[93m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(
    colorText("\n🚨 WORKING LIQUIDATION PIPELINE TEST", colors.brightMagenta)
  );
  console.log("=".repeat(60));

  // Connect directly to localhost
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

  // Get signers
  const wallet1 = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  ); // Default hardhat account
  const wallet2 = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  ); // Account 1
  const wallet3 = new ethers.Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    provider
  ); // Account 2
  const user3Wallet = new ethers.Wallet(
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    provider
  ); // Account 3

  // Load contract artifacts and connect
  const vaultArtifact = require("./artifacts/src/CoreVault.sol/CoreVault.json");
  const orderBookArtifact = require("./artifacts/src/OrderBook.sol/OrderBook.json");

  const vault = new ethers.Contract(
    "0x276C216D241856199A83bf27b2286659e5b877D3",
    vaultArtifact.abi,
    wallet1
  );
  const orderBook = new ethers.Contract(
    "0xF8A8B047683062B5BBbbe9D104C9177d6b6cC086",
    orderBookArtifact.abi,
    wallet1
  );

  const marketId =
    "0xc748740ee16fdf6587e21437fe753d0aa31895b44b89c8f704ac6a1aa0fcb80f";

  console.log("📋 SETUP:");
  console.log(`Vault: ${await vault.getAddress()}`);
  console.log(`OrderBook: ${await orderBook.getAddress()}`);
  console.log(`Market ID: ${marketId}`);
  console.log(`User3: ${user3Wallet.address}`);

  let eventsReceived = [];

  // Set up event listeners
  console.log(
    colorText("\n🔊 Setting up debug event listeners...", colors.brightYellow)
  );

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

  console.log(colorText("✅ Event listeners set up!", colors.brightGreen));

  try {
    // Test 1: Check User3's existing position from deployment
    console.log(
      colorText(
        "\n🧪 TEST 1: Check User3's existing position",
        colors.brightCyan
      )
    );

    const [user3Size, user3Entry, user3Margin] = await vault.getPositionSummary(
      user3Wallet.address,
      marketId
    );
    console.log(`User3 position from deployment:`);
    console.log(`  Size: ${ethers.formatUnits(user3Size, 18)} ALU`);
    console.log(`  Entry Price: $${ethers.formatUnits(user3Entry, 6)}`);
    console.log(`  Margin: $${ethers.formatUnits(user3Margin, 6)}`);

    if (user3Size == 0) {
      console.log(
        colorText("❌ User3 has no position - deployment issue", colors.red)
      );
    } else {
      console.log(
        colorText("✅ User3 has a position from deployment!", colors.green)
      );
    }

    // Test 2: Place a market order from wallet2 to test the pipeline
    console.log(
      colorText(
        "\n🧪 TEST 2: Place market order to test position updates",
        colors.brightCyan
      )
    );

    const wallet2Available = await vault.getAvailableCollateral(
      wallet2.address
    );
    console.log(
      `Wallet2 available collateral: $${ethers.formatUnits(
        wallet2Available,
        6
      )}`
    );

    if (wallet2Available > 0) {
      console.log("Placing 1 ALU market buy order from Wallet2...");
      const buyAmount = ethers.parseUnits("1", 18);

      const tx = await orderBook
        .connect(wallet2)
        .placeMarginMarketOrder(buyAmount, true, {
          gasLimit: 5000000,
        });
      const receipt = await tx.wait();

      console.log(
        colorText(
          `✅ Market order transaction completed! Block: ${receipt.blockNumber}`,
          colors.brightGreen
        )
      );

      // Wait for events to propagate
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check Wallet2's position after trade
      const [wallet2Size, wallet2Entry, wallet2Margin] =
        await vault.getPositionSummary(wallet2.address, marketId);
      console.log(
        colorText(`\n📊 Wallet2 position after trade:`, colors.brightGreen)
      );
      console.log(`  Size: ${ethers.formatUnits(wallet2Size, 18)} ALU`);
      console.log(`  Entry Price: $${ethers.formatUnits(wallet2Entry, 6)}`);
      console.log(`  Margin: $${ethers.formatUnits(wallet2Margin, 6)}`);

      // Analyze events
      console.log(colorText("\n📊 EVENTS SUMMARY:", colors.brightBlue));
      console.log(`Total events received: ${eventsReceived.length}`);

      eventsReceived.forEach((event, index) => {
        console.log(
          `${index + 1}. ${event.type} - ${
            event.status || event.reason || "N/A"
          }`
        );
      });

      // Check if position updates worked
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
      const liquidationTriggered = eventsReceived.some(
        (e) => e.type === "LiquidationTrigger"
      );

      console.log(colorText("\n🔍 PIPELINE ANALYSIS:", colors.brightMagenta));
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
      console.log(
        `Liquidation check triggered: ${
          liquidationTriggered
            ? colorText("✅ YES", colors.brightGreen)
            : colorText("❌ NO", colors.brightRed)
        }`
      );

      if (
        positionUpdateSucceeded &&
        vaultPositionUpdated &&
        liquidationTriggered
      ) {
        console.log(
          colorText(
            "\n🎉 SUCCESS! The liquidation pipeline fix is working!",
            colors.brightGreen
          )
        );
        console.log("✅ Orders match correctly");
        console.log("✅ Positions update in the vault");
        console.log("✅ Liquidation checks are triggered");
      } else {
        console.log(
          colorText(
            "\n⚠️ Some parts of the pipeline may still need work",
            colors.brightYellow
          )
        );
      }
    } else {
      console.log(
        colorText("❌ Wallet2 has no available collateral", colors.red)
      );
    }
  } catch (error) {
    console.error(
      colorText(`\n❌ Error during test: ${error.message}`, colors.brightRed)
    );
    console.error(error);
  }

  console.log(colorText("\n🏁 TEST COMPLETED!", colors.brightGreen));
  process.exit(0);
}

main().catch((error) => {
  console.error(colorText("\n💥 Test failed:", colors.brightRed), error);
  process.exit(1);
});
