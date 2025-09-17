#!/usr/bin/env node

/**
 * Modular Structure Verification Script
 *
 * 🎯 PURPOSE: Verify that the new modular contract structure is working correctly
 *
 * 🔍 CHECKS:
 *   ✅ Contract addresses are correctly configured
 *   ✅ All expected methods are available
 *   ✅ Critical methods can be called without errors
 *   ✅ Authorization is properly set up
 *   ✅ Market data can be retrieved
 *
 * 📋 USAGE: node verify-modular-setup.js
 */

const { ethers } = require("hardhat");
const {
  verifyModularStructure,
  checkAuthorization,
  displayFullConfig,
  getCoreContracts,
  MARKET_INFO,
} = require("./config/contracts");

class ModularStructureVerifier {
  async verify() {
    console.log("🚀 HYPERLIQUID V2 MODULAR STRUCTURE VERIFICATION");
    console.log("═".repeat(80));

    let allPassed = true;

    // Step 1: Verify contract configuration
    console.log("\n📋 STEP 1: Contract Configuration");
    allPassed &= await this.verifyConfiguration();

    // Step 2: Verify contract loading
    console.log("\n🔧 STEP 2: Contract Loading");
    allPassed &= await this.verifyContractLoading();

    // Step 3: Verify method availability
    console.log("\n⚙️ STEP 3: Method Availability");
    allPassed &= await verifyModularStructure();

    // Step 4: Verify authorization
    console.log("\n🔐 STEP 4: Authorization");
    const authStatus = await checkAuthorization();
    allPassed &=
      authStatus !== null &&
      authStatus.factoryHasRole &&
      authStatus.orderBookHasRole;

    // Step 5: Test critical methods
    console.log("\n🧪 STEP 5: Critical Method Testing");
    allPassed &= await this.testCriticalMethods();

    // Step 6: Verify market data
    console.log("\n📊 STEP 6: Market Data Verification");
    allPassed &= await this.verifyMarketData();

    // Summary
    console.log("\n" + "═".repeat(80));
    console.log(
      `🎯 VERIFICATION RESULT: ${
        allPassed ? "✅ ALL PASSED" : "❌ ISSUES FOUND"
      }`
    );
    console.log("═".repeat(80));

    if (!allPassed) {
      console.log(
        "\n⚠️  Please fix the issues above before using the interactive trader."
      );
      process.exit(1);
    }

    console.log("\n🎉 Your modular contract structure is ready to use!");
    console.log("   You can now run the interactive trader with confidence.");
  }

  async verifyConfiguration() {
    try {
      await displayFullConfig();
      console.log("✅ Configuration display successful");
      return true;
    } catch (error) {
      console.error(`❌ Configuration error: ${error.message}`);
      return false;
    }
  }

  async verifyContractLoading() {
    try {
      const contracts = await getCoreContracts();

      const expectedContracts = [
        "trading_router",
        "core_vault",
        "futures_market_factory",
      ];
      for (const contractName of expectedContracts) {
        if (contracts[contractName]) {
          console.log(`✅ ${contractName} loaded successfully`);
        } else {
          console.log(`❌ ${contractName} failed to load`);
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error(`❌ Contract loading error: ${error.message}`);
      return false;
    }
  }

  async testCriticalMethods() {
    try {
      const contracts = await getCoreContracts();
      const { getContract } = require("./config/contracts");
      const orderBook = await getContract("ORDERBOOK");

      let allTestsPassed = true;

      // Test 1: CoreVault methods
      console.log("  Testing CoreVault methods...");
      try {
        const [deployer] = await ethers.getSigners();
        const globalStats = await contracts.core_vault.getGlobalStats();
        console.log("    ✅ CoreVault.getGlobalStats() works");

        const userCollateral = await contracts.core_vault.userCollateral(
          deployer.address
        );
        console.log("    ✅ CoreVault.userCollateral() works");
      } catch (error) {
        console.log(`    ❌ CoreVault methods failed: ${error.message}`);
        allTestsPassed = false;
      }

      // Test 2: OrderBook methods
      console.log("  Testing OrderBook methods...");
      try {
        const bestBid = await orderBook.bestBid();
        const bestAsk = await orderBook.bestAsk();
        console.log("    ✅ OrderBook.bestBid() and bestAsk() work");

        const markPrice = await orderBook.calculateMarkPrice();
        console.log("    ✅ OrderBook.calculateMarkPrice() works");
      } catch (error) {
        console.log(`    ❌ OrderBook methods failed: ${error.message}`);
        allTestsPassed = false;
      }

      // Test 3: Factory methods (the critical getMarketDetails)
      console.log("  Testing FuturesMarketFactory methods...");
      try {
        const allMarkets =
          await contracts.futures_market_factory.getAllMarkets();
        console.log("    ✅ FuturesMarketFactory.getAllMarkets() works");

        if (allMarkets.length > 0) {
          const marketDetails =
            await contracts.futures_market_factory.getMarketDetails(
              allMarkets[0]
            );
          console.log(
            "    ✅ FuturesMarketFactory.getMarketDetails() works (CRITICAL FIX)"
          );
        }
      } catch (error) {
        console.log(
          `    ❌ FuturesMarketFactory methods failed: ${error.message}`
        );
        allTestsPassed = false;
      }

      // Test 4: TradingRouter methods (the critical signature fix)
      console.log("  Testing TradingRouter methods...");
      try {
        const allMarkets =
          await contracts.futures_market_factory.getAllMarkets();
        if (allMarkets.length > 0) {
          const multiMarketData =
            await contracts.trading_router.getMultiMarketData([allMarkets[0]]);
          console.log("    ✅ TradingRouter.getMultiMarketData() works");

          // Verify the correct method signature exists
          if (
            typeof contracts.trading_router.marketBuyWithLeverage === "function"
          ) {
            console.log(
              "    ✅ TradingRouter.marketBuyWithLeverage() method exists (CRITICAL FIX)"
            );
          } else {
            console.log(
              "    ❌ TradingRouter.marketBuyWithLeverage() method missing"
            );
            allTestsPassed = false;
          }
        }
      } catch (error) {
        console.log(`    ❌ TradingRouter methods failed: ${error.message}`);
        allTestsPassed = false;
      }

      return allTestsPassed;
    } catch (error) {
      console.error(`❌ Critical method testing failed: ${error.message}`);
      return false;
    }
  }

  async verifyMarketData() {
    try {
      const contracts = await getCoreContracts();

      console.log("  Checking market information...");
      for (const [marketName, marketInfo] of Object.entries(MARKET_INFO)) {
        try {
          const marketId = marketInfo.marketId;
          const exists = await contracts.futures_market_factory.doesMarketExist(
            marketId
          );

          if (exists) {
            console.log(`    ✅ ${marketName} market exists and is accessible`);

            // Test the critical getMarketDetails method
            const details =
              await contracts.futures_market_factory.getMarketDetails(marketId);
            console.log(
              `    ✅ ${marketName} market details retrieved successfully`
            );
          } else {
            console.log(
              `    ⚠️  ${marketName} market not found (may need deployment)`
            );
          }
        } catch (error) {
          console.log(`    ❌ ${marketName} market error: ${error.message}`);
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error(`❌ Market data verification failed: ${error.message}`);
      return false;
    }
  }
}

// Run verification if called directly
if (require.main === module) {
  async function main() {
    const verifier = new ModularStructureVerifier();
    await verifier.verify();
  }

  main().catch((error) => {
    console.error(`💥 FATAL ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { ModularStructureVerifier };
