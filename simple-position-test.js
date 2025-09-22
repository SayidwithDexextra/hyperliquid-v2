#!/usr/bin/env node

// simple-position-test.js - Simple test to check if positions are working

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

// Cache for market symbols
const marketSymbolCache = new Map();

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
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

// Helper function to safely decode marketId bytes32
async function safeDecodeMarketId(marketId, contracts) {
  try {
    // First try to decode as a string
    return ethers.decodeBytes32String(marketId);
  } catch (decodeError) {
    // Check cache first
    if (marketSymbolCache.has(marketId)) {
      return marketSymbolCache.get(marketId);
    }

    // If it's a hash, try to get the symbol from the factory
    try {
      if (contracts && contracts.factory) {
        const marketData = await contracts.factory.getMarket(marketId);
        if (marketData && marketData.marketSymbol) {
          const symbol = marketData.marketSymbol;
          marketSymbolCache.set(marketId, symbol);
          return symbol;
        }
      }
    } catch (e) {
      // Factory lookup failed, continue to fallback
    }

    // Fallback: try known market mappings
    const knownMarkets = {
      "0x438fae95c162a36afbab04e3fee0568b0c9f8041e224855381069621d7f3a32d":
        "ALU-USD",
      "0xb3d1d761d992e42284108c1c9b2e64a2e0a10c4fe4b101fae8cd4147ddf418f8":
        "ALU-USD-HASH",
    };

    if (knownMarkets[marketId]) {
      const symbol = knownMarkets[marketId];
      marketSymbolCache.set(marketId, symbol);
      return symbol;
    }

    // Final fallback: return truncated hash
    return `${marketId.slice(0, 10)}...`;
  }
}

async function main() {
  console.log(colorText("\n🧪 SIMPLE POSITION TEST", colors.brightBlue));
  console.log("=".repeat(40));

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  try {
    // Load contracts
    console.log("Loading contracts...");
    const vault = await getContract("CORE_VAULT", "CoreVault");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK", "OrderBook");
    const factory = await getContract(
      "FUTURES_MARKET_FACTORY",
      "FuturesMarketFactory"
    );

    const contracts = { vault, orderBook, factory };

    console.log(`Vault: ${await vault.getAddress()}`);
    console.log(`OrderBook: ${await orderBook.getAddress()}`);
    console.log(`Factory: ${await factory.getAddress()}`);

    // Test 1: Check if we can call basic functions
    console.log(
      colorText("\nTest 1: Basic function calls", colors.brightYellow)
    );

    // Use the exact market ID from deployment
    const marketId =
      "0x438fae95c162a36afbab04e3fee0568b0c9f8041e224855381069621d7f3a32d";
    const marketSymbol = await safeDecodeMarketId(marketId, contracts);
    console.log(`Market ID: ${marketId}`);
    console.log(`Market Symbol: ${marketSymbol}`);

    try {
      const markPrice = await vault.getMarkPrice(marketId);
      console.log(
        colorText(
          `✅ Mark price: $${ethers.formatUnits(markPrice, 6)}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`❌ getMarkPrice failed: ${error.message}`, colors.red)
      );
    }

    // Test 2: Check User3's position (should exist from deployment)
    console.log(
      colorText("\nTest 2: Check User3 position", colors.brightYellow)
    );
    console.log(`User3 address: ${user3.address}`);

    try {
      const [size, entryPrice, marginLocked] = await vault.getPositionSummary(
        user3.address,
        marketId
      );
      console.log(colorText(`✅ Position found:`, colors.green));
      console.log(`  Size: ${ethers.formatUnits(size, 18)} ALU`);
      console.log(`  Entry Price: $${ethers.formatUnits(entryPrice, 6)}`);
      console.log(`  Margin Locked: $${ethers.formatUnits(marginLocked, 6)}`);
    } catch (error) {
      console.log(
        colorText(`❌ getPositionSummary failed: ${error.message}`, colors.red)
      );
      console.log("Let's check if User3 has any positions at all...");

      try {
        // Check if user has any markets
        const userMarketIds = await vault.getUserMarketIds(user3.address);
        console.log(`User3 has ${userMarketIds.length} markets`);

        if (userMarketIds.length > 0) {
          console.log("Market IDs:");
          userMarketIds.forEach((id, index) => {
            console.log(`  ${index}: ${id}`);
          });
        }
      } catch (error2) {
        console.log(
          colorText(
            `❌ getUserMarketIds also failed: ${error2.message}`,
            colors.red
          )
        );
      }
    }

    // Test 3: Try to place a simple market order
    console.log(
      colorText("\nTest 3: Place a test market order", colors.brightYellow)
    );

    try {
      // First check available collateral
      const availableCollateral = await vault.getAvailableCollateral(
        user1.address
      );
      console.log(
        `User1 available collateral: $${ethers.formatUnits(
          availableCollateral,
          6
        )}`
      );

      if (availableCollateral > 0) {
        console.log("Placing 1 ALU market buy order from User1...");
        const buyAmount = ethers.parseUnits("1", 18);

        const tx = await orderBook
          .connect(user1)
          .placeMarginMarketOrder(buyAmount, true);
        const receipt = await tx.wait();

        console.log(
          colorText(
            `✅ Market order placed! Block: ${receipt.blockNumber}`,
            colors.green
          )
        );

        // Check events
        console.log("Events in transaction:");
        receipt.logs.forEach((log, index) => {
          try {
            const parsed =
              orderBook.interface.parseLog(log) ||
              vault.interface.parseLog(log);
            if (parsed) {
              console.log(`  ${index}: ${parsed.name}`);
            }
          } catch (e) {
            // Skip unparseable logs
          }
        });

        // Wait a bit for events
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check User1's position after trade
        try {
          const [size, entryPrice, marginLocked] =
            await vault.getPositionSummary(user1.address, marketId);
          console.log(
            colorText(`✅ User1 position after trade:`, colors.green)
          );
          console.log(`  Size: ${ethers.formatUnits(size, 18)} ALU`);
          console.log(`  Entry Price: $${ethers.formatUnits(entryPrice, 6)}`);
          console.log(
            `  Margin Locked: $${ethers.formatUnits(marginLocked, 6)}`
          );
        } catch (error) {
          console.log(
            colorText(
              `❌ User1 position check failed: ${error.message}`,
              colors.red
            )
          );
        }
      } else {
        console.log(
          colorText("❌ User1 has no available collateral", colors.red)
        );
      }
    } catch (error) {
      console.log(
        colorText(`❌ Market order failed: ${error.message}`, colors.red)
      );
    }
  } catch (error) {
    console.log(
      colorText(`❌ Test setup failed: ${error.message}`, colors.red)
    );
    console.error(error);
  }

  console.log(colorText("\n🏁 TEST COMPLETED!", colors.brightGreen));
  process.exit(0);
}

// Error handling
main().catch((error) => {
  console.error(colorText("\n💥 Test failed:", colors.brightRed), error);
  process.exit(1);
});
