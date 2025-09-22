#!/usr/bin/env node

// contract-diagnosis.js - Deep diagnosis of contract issues

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

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
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(colorText("\n🔍 CONTRACT DIAGNOSIS", colors.brightBlue));
  console.log("=".repeat(50));

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  try {
    // Load contracts - let's use the actual deployed addresses
    console.log("Loading contracts with ACTUAL deployment addresses...");
    const vault = await ethers.getContractAt(
      "CoreVault",
      "0x276C216D241856199A83bf27b2286659e5b877D3"
    );
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      "0xF8A8B047683062B5BBbbe9D104C9177d6b6cC086"
    );

    console.log(`Vault: ${await vault.getAddress()}`);
    console.log(`OrderBook: ${await orderBook.getAddress()}`);

    const marketId =
      "0xc748740ee16fdf6587e21437fe753d0aa31895b44b89c8f704ac6a1aa0fcb80f";

    // Test 1: Check basic contract state
    console.log(
      colorText("\n🧪 Test 1: Basic Contract State", colors.brightYellow)
    );

    try {
      const totalCollateral = await vault.totalCollateralDeposited();
      console.log(
        colorText(
          `✅ Total collateral deposited: $${ethers.formatUnits(
            totalCollateral,
            6
          )}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `❌ totalCollateralDeposited failed: ${error.message}`,
          colors.red
        )
      );
    }

    try {
      const user3Collateral = await vault.userCollateral(user3.address);
      console.log(
        colorText(
          `✅ User3 collateral: $${ethers.formatUnits(user3Collateral, 6)}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`❌ userCollateral failed: ${error.message}`, colors.red)
      );
    }

    // Test 2: Check if functions exist on contracts
    console.log(
      colorText("\n🧪 Test 2: Function Existence Check", colors.brightYellow)
    );

    const vaultFunctions = [
      "getMarkPrice",
      "getPositionSummary",
      "getAvailableCollateral",
      "isLiquidatable",
      "getLiquidationPrice",
    ];

    for (const funcName of vaultFunctions) {
      const exists = typeof vault[funcName] === "function";
      console.log(
        `${exists ? "✅" : "❌"} vault.${funcName}: ${
          exists ? "EXISTS" : "MISSING"
        }`
      );
    }

    // Test 3: Check contract compilation/deployment
    console.log(
      colorText("\n🧪 Test 3: Contract Deployment Check", colors.brightYellow)
    );

    try {
      // Try to get the contract code
      const code = await ethers.provider.getCode(await vault.getAddress());
      if (code === "0x") {
        console.log(
          colorText(
            `❌ Vault has no bytecode - contract not deployed!`,
            colors.red
          )
        );
      } else {
        console.log(
          colorText(
            `✅ Vault has bytecode (${code.length} chars)`,
            colors.green
          )
        );
      }
    } catch (error) {
      console.log(
        colorText(
          `❌ Failed to get vault bytecode: ${error.message}`,
          colors.red
        )
      );
    }

    // Test 4: Try direct low-level calls
    console.log(
      colorText("\n🧪 Test 4: Low-Level Function Calls", colors.brightYellow)
    );

    try {
      // Try to call getMarkPrice with low-level call
      const getMarkPriceData = vault.interface.encodeFunctionData(
        "getMarkPrice",
        [marketId]
      );
      const result = await ethers.provider.call({
        to: await vault.getAddress(),
        data: getMarkPriceData,
      });

      if (result === "0x") {
        console.log(
          colorText(
            `❌ getMarkPrice returns empty data - function reverted`,
            colors.red
          )
        );
      } else {
        console.log(
          colorText(`✅ getMarkPrice returned data: ${result}`, colors.green)
        );
        try {
          const decoded = vault.interface.decodeFunctionResult(
            "getMarkPrice",
            result
          );
          console.log(
            colorText(
              `✅ Decoded mark price: $${ethers.formatUnits(decoded[0], 6)}`,
              colors.green
            )
          );
        } catch (decodeError) {
          console.log(
            colorText(
              `❌ Failed to decode result: ${decodeError.message}`,
              colors.red
            )
          );
        }
      }
    } catch (error) {
      console.log(
        colorText(
          `❌ Low-level getMarkPrice failed: ${error.message}`,
          colors.red
        )
      );
    }

    // Test 5: Check market registration
    console.log(
      colorText("\n🧪 Test 5: Market Registration Check", colors.brightYellow)
    );

    try {
      // Check if the market is registered in mapping
      const registeredOrderBook = await vault.marketToOrderBook(marketId);
      if (registeredOrderBook === ethers.ZeroAddress) {
        console.log(
          colorText(
            `❌ Market ${marketId} is NOT registered in vault`,
            colors.red
          )
        );
        console.log(
          colorText(
            `   This explains why mark price functions fail!`,
            colors.yellow
          )
        );
      } else {
        console.log(
          colorText(
            `✅ Market registered with OrderBook: ${registeredOrderBook}`,
            colors.green
          )
        );
      }
    } catch (error) {
      console.log(
        colorText(
          `❌ Failed to check market registration: ${error.message}`,
          colors.red
        )
      );
    }

    // Test 6: Check if there are any markets registered
    console.log(
      colorText("\n🧪 Test 6: All Registered Markets", colors.brightYellow)
    );

    try {
      const allOrderBooks = await vault.allOrderBooks();
      console.log(`Total registered order books: ${allOrderBooks.length}`);

      if (allOrderBooks.length === 0) {
        console.log(
          colorText(
            `❌ NO ORDER BOOKS REGISTERED! This is the problem!`,
            colors.brightRed
          )
        );
        console.log(
          colorText(
            `   The deployment script may have failed to register the market properly.`,
            colors.yellow
          )
        );
      } else {
        allOrderBooks.forEach((ob, index) => {
          console.log(`  ${index}: ${ob}`);
        });
      }
    } catch (error) {
      console.log(
        colorText(
          `❌ Failed to get all order books: ${error.message}`,
          colors.red
        )
      );
    }

    // Test 7: Check specific market prices array
    console.log(
      colorText("\n🧪 Test 7: Market Price Storage", colors.brightYellow)
    );

    try {
      const storedPrice = await vault.marketMarkPrices(marketId);
      console.log(
        colorText(
          `Market stored price: $${ethers.formatUnits(storedPrice, 6)}`,
          storedPrice > 0 ? colors.green : colors.red
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `❌ Failed to get stored market price: ${error.message}`,
          colors.red
        )
      );
    }
  } catch (error) {
    console.log(colorText(`❌ Diagnosis failed: ${error.message}`, colors.red));
    console.error(error);
  }

  console.log(colorText("\n🏁 DIAGNOSIS COMPLETED!", colors.brightGreen));
  process.exit(0);
}

main().catch((error) => {
  console.error(colorText("\n💥 Diagnosis failed:", colors.brightRed), error);
  process.exit(1);
});
