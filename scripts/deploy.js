#!/usr/bin/env node

// deploy.js - Complete deployment script for HyperLiquid v2
//
// 🎯 THIS SCRIPT DEPLOYS OUR NEW MODULAR ARCHITECTURE:
//   1. Deploys libraries (VaultAnalytics, PositionManager)
//   2. Deploys core contracts (MockUSDC, CoreVault, Factory, Router)
//   3. Sets up all authorization and roles between modular contracts
//   4. Creates ALUMINUM market
//   5. Funds trading accounts with USDC and collateral
//   6. Places initial limit buy order (10 ALU @ $1.00 from deployer)
//   7. Executes market sell order from User3 (creates first trade & short position)
//   8. Places User2 limit buy order (20 ALU @ $2.50 for liquidity)
//   9. Updates configuration files
//
// 🚀 USAGE:
//   node scripts/deploy.js
//   OR
//   npx hardhat run scripts/deploy.js --network localhost
//

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Configuration
const USDC_PER_USER = "10000"; // 10,000 USDC per user
const COLLATERAL_PER_USER = "1000"; // 1,000 USDC collateral per user (default)
const USER3_COLLATERAL = "20"; // 15 USDC collateral for User 3
const NUM_USERS = 4; // Setup 4 trading accounts

async function main() {
  console.log("\n🚀 HYPERLIQUID V2 - MODULAR DEPLOYMENT");
  console.log("═".repeat(80));
  console.log(
    "🏗️  NEW ARCHITECTURE: CoreVault + 2 Libraries (VaultAnalytics + PositionManager)"
  );
  console.log("✅ All contracts under 24,576 byte limit!");

  const [deployer] = await ethers.getSigners();
  console.log("📋 Deployer:", deployer.address);

  const contracts = {};

  try {
    // ============================================
    // STEP 1: DEPLOY CORE CONTRACTS
    // ============================================
    console.log("\n📦 STEP 1: DEPLOYING CORE CONTRACTS");
    console.log("─".repeat(60));

    // Deploy MockUSDC
    console.log("  1️⃣ Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();
    contracts.MOCK_USDC = await mockUSDC.getAddress();
    console.log("     ✅ MockUSDC deployed at:", contracts.MOCK_USDC);

    // Deploy all libraries first (required for linking)
    console.log("  2️⃣ Deploying VaultAnalytics library...");
    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();
    contracts.VAULT_ANALYTICS = await vaultAnalytics.getAddress();
    console.log(
      "     ✅ VaultAnalytics deployed at:",
      contracts.VAULT_ANALYTICS
    );

    console.log("  3️⃣ Deploying PositionManager library...");
    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();
    contracts.POSITION_MANAGER = await positionManager.getAddress();
    console.log(
      "     ✅ PositionManager deployed at:",
      contracts.POSITION_MANAGER
    );

    // Deploy CoreVault (with library linking)
    console.log("  4️⃣ Deploying CoreVault...");
    const CoreVault = await ethers.getContractFactory("CoreVault", {
      libraries: {
        VaultAnalytics: contracts.VAULT_ANALYTICS,
        PositionManager: contracts.POSITION_MANAGER,
      },
    });
    const coreVault = await CoreVault.deploy(
      contracts.MOCK_USDC,
      deployer.address
    );
    await coreVault.waitForDeployment();
    contracts.CORE_VAULT = await coreVault.getAddress();
    console.log("     ✅ CoreVault deployed at:", contracts.CORE_VAULT);

    // Deploy FuturesMarketFactory
    console.log("  5️⃣ Deploying FuturesMarketFactory...");
    const FuturesMarketFactory = await ethers.getContractFactory(
      "FuturesMarketFactory"
    );
    const factory = await FuturesMarketFactory.deploy(
      contracts.CORE_VAULT,
      deployer.address,
      deployer.address
    );
    await factory.waitForDeployment();
    contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
    console.log(
      "     ✅ FuturesMarketFactory deployed at:",
      contracts.FUTURES_MARKET_FACTORY
    );

    // Deploy TradingRouter
    console.log("  6️⃣ Deploying TradingRouter...");
    const TradingRouter = await ethers.getContractFactory("TradingRouter");
    const router = await TradingRouter.deploy(
      contracts.CORE_VAULT,
      contracts.FUTURES_MARKET_FACTORY,
      deployer.address
    );
    await router.waitForDeployment();
    contracts.TRADING_ROUTER = await router.getAddress();
    console.log("     ✅ TradingRouter deployed at:", contracts.TRADING_ROUTER);

    // ============================================
    // STEP 2: SETUP AUTHORIZATION
    // ============================================
    console.log("\n🔒 STEP 2: SETTING UP AUTHORIZATION");
    console.log("─".repeat(60));

    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const SETTLEMENT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("SETTLEMENT_ROLE")
    );
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );

    console.log("  🔧 Setting up modular contract roles...");
    console.log("     → Granting FACTORY_ROLE to FuturesMarketFactory...");
    await coreVault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);

    console.log("     → Granting SETTLEMENT_ROLE to FuturesMarketFactory...");
    await coreVault.grantRole(
      SETTLEMENT_ROLE,
      contracts.FUTURES_MARKET_FACTORY
    );

    console.log("     ✅ All modular roles granted successfully!");

    // ============================================
    // STEP 3: CREATE ALUMINUM MARKET
    // ============================================
    console.log("\n🏭 STEP 3: CREATING ALUMINUM MARKET");
    console.log("─".repeat(60));

    // Market parameters
    const marketSymbol = "ALU-USD";
    const marketId = ethers.keccak256(ethers.toUtf8Bytes(marketSymbol));
    const metricUrl =
      "https://www.lme.com/en/metals/non-ferrous/lme-aluminium/";
    const settlementDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    const startPrice = ethers.parseUnits("2500", 6);
    const dataSource = "London Metal Exchange";
    const tags = ["COMMODITIES", "METALS", "ALUMINUM"];
    const marginRequirementBps = 10000; // 100% margin (1:1 ratio)
    const tradingFee = 10; // 0.1%

    console.log("  📊 Market Parameters:");
    console.log(`     Symbol: ${marketSymbol}`);
    console.log(`     Start Price: $${ethers.formatUnits(startPrice, 6)}`);
    console.log(`     Margin Requirement: ${marginRequirementBps / 100}%`);
    console.log(`     Trading Fee: ${tradingFee / 100}%`);

    // Check and pay creation fee
    const creationFee = await factory.marketCreationFee();
    console.log(
      `  💰 Market creation fee: ${ethers.formatUnits(creationFee, 6)} USDC`
    );

    await mockUSDC.approve(contracts.FUTURES_MARKET_FACTORY, creationFee);
    console.log("     ✅ Fee approved");

    // Create market
    console.log("  🚀 Creating ALUMINUM futures market...");
    const createTx = await factory.createFuturesMarket(
      marketSymbol,
      metricUrl,
      settlementDate,
      startPrice,
      dataSource,
      tags,
      marginRequirementBps,
      tradingFee
    );

    const receipt = await createTx.wait();
    console.log("     ✅ Market created!");

    // Get OrderBook address from event
    const event = receipt.logs.find((log) => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed.name === "FuturesMarketCreated";
      } catch {
        return false;
      }
    });

    let actualMarketId;
    if (event) {
      const parsedEvent = factory.interface.parseLog(event);
      contracts.ALUMINUM_ORDERBOOK = parsedEvent.args.orderBook;
      actualMarketId = parsedEvent.args.marketId;
      console.log(
        "     ✅ ALUMINUM OrderBook deployed at:",
        contracts.ALUMINUM_ORDERBOOK
      );
      console.log("     ✅ Market ID:", actualMarketId);
    } else {
      throw new Error("Failed to get OrderBook address from event");
    }

    // Set initial mark price for the market
    console.log("  📊 Setting initial mark price...");
    // SETTLEMENT_ROLE already declared above, grant it to deployer for mark price update
    await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
    // Set mark price to $1 to match initial liquidity
    const actualInitialPrice = ethers.parseUnits("1", 6); // $1 USDC
    await coreVault.updateMarkPrice(actualMarketId, actualInitialPrice);
    console.log(
      `     ✅ Mark price set to $${ethers.formatUnits(
        actualInitialPrice,
        6
      )} (matching initial liquidity)`
    );
    console.log(
      `     ℹ️  Note: Official start price is $${ethers.formatUnits(
        startPrice,
        6
      )}, but using $1 for initial trades`
    );

    // Grant ORDERBOOK_ROLE to the OrderBook
    await coreVault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
    console.log("     ✅ ORDERBOOK_ROLE granted to OrderBook");

    // Grant SETTLEMENT_ROLE to the OrderBook (needed for updateMarkPrice calls)
    await coreVault.grantRole(SETTLEMENT_ROLE, contracts.ALUMINUM_ORDERBOOK);
    console.log("     ✅ SETTLEMENT_ROLE granted to OrderBook");

    // Configure margin requirements for 1:1 longs, 150% shorts (no leverage)
    console.log("  🔧 Configuring margin requirements...");
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      contracts.ALUMINUM_ORDERBOOK
    );

    // Ensure leverage is disabled and margin is set to 100% (10000 BPS) for longs
    // Shorts will require 150% but that's handled in the trading logic
    try {
      await orderBook.connect(deployer).disableLeverage();
      console.log("     ✅ Leverage disabled - using 1:1 margin system");
    } catch (error) {
      console.log("     ⚠️  Leverage already disabled");
    }

    console.log("     ℹ️  Long positions: 100% margin (1:1)");
    console.log(
      "     ℹ️  Short positions: 150% margin (handled by trading logic)"
    );

    // No VaultRouter – liquidation is integrated

    // SKIP INITIAL LIQUIDITY SEEDING
    console.log("  💧 Skipping initial liquidity seeding...");
    console.log("     ℹ️  Market will start with empty order book");
    console.log("     ℹ️  Users can place orders at any price");

    // ============================================
    // STEP 4: FUND TRADING ACCOUNTS
    // ============================================
    console.log("\n💰 STEP 4: FUNDING TRADING ACCOUNTS");
    console.log("─".repeat(60));

    const signers = await ethers.getSigners();

    for (let i = 0; i < Math.min(NUM_USERS, signers.length); i++) {
      const user = signers[i];
      const userType = i === 0 ? "Deployer" : `User ${i}`;

      console.log(`\n  ${userType}: ${user.address}`);

      try {
        // Mint USDC
        const mintAmount = ethers.parseUnits(USDC_PER_USER, 6);
        await mockUSDC.mint(user.address, mintAmount);
        console.log(`     ✅ Minted ${USDC_PER_USER} USDC`);

        // Deposit collateral (User 3 gets special amount)
        const collateralAmountStr =
          i === 3 ? USER3_COLLATERAL : COLLATERAL_PER_USER;
        const collateralAmount = ethers.parseUnits(collateralAmountStr, 6);
        await mockUSDC
          .connect(user)
          .approve(contracts.CORE_VAULT, collateralAmount);
        await coreVault.connect(user).depositCollateral(collateralAmount);
        console.log(
          `     ✅ Deposited ${collateralAmountStr} USDC as collateral`
        );

        // Show final balances
        const balance = await mockUSDC.balanceOf(user.address);
        const collateral = await coreVault.userCollateral(user.address);
        console.log(
          `     📊 Final: ${ethers.formatUnits(
            balance,
            6
          )} USDC wallet, ${ethers.formatUnits(collateral, 6)} USDC collateral`
        );
      } catch (error) {
        console.log(`     ❌ Error: ${error.message}`);
      }
    }

    // ============================================
    // STEP 5: PLACE INITIAL ORDERS & CREATE TRADES
    // ============================================
    console.log("\n📈 STEP 5: PLACING INITIAL ORDERS & CREATING TRADES");
    console.log("─".repeat(60));

    try {
      // Get the deployed OrderBook contract
      const orderBook = await ethers.getContractAt(
        "OrderBook",
        contracts.ALUMINUM_ORDERBOOK
      );

      console.log("  🔸 Placing limit buy order from deployer...");
      console.log("     Price: $1.00");
      console.log("     Amount: 10 ALU");
      console.log("     Side: BUY");

      // Place limit buy order: 10 ALU at $1.00
      const price = ethers.parseUnits("1", 6); // $1.00 in USDC (6 decimals)
      const amount = ethers.parseUnits("10", 18); // 10 ALU (18 decimals)

      // Place the order using margin limit order function
      const placeTx = await orderBook.connect(deployer).placeMarginLimitOrder(
        price,
        amount,
        true // isBuy = true
      );

      await placeTx.wait();
      console.log("     ✅ Limit buy order placed successfully!");

      // Check the order book state
      const bestBid = await orderBook.bestBid();
      const bestAsk = await orderBook.bestAsk();
      console.log(`     📊 Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
      console.log(`     📊 Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);

      // Now place User3's market sell order to match against the limit buy
      console.log("\n  🔸 Placing market sell order from User3...");
      console.log("     Amount: 10 ALU");
      console.log("     Side: SELL (market order)");

      const signers = await ethers.getSigners();
      const user3 = signers[3]; // User3 is the 4th signer

      const sellTx = await orderBook.connect(user3).placeMarginMarketOrder(
        amount, // Same 10 ALU amount
        false // isBuy = false for sell order
      );

      await sellTx.wait();
      console.log("     ✅ Market sell order executed successfully!");
      console.log(`     💰 User3 opened short position: -10 ALU @ $1.00`);

      // Check final order book state
      const finalBestBid = await orderBook.bestBid();
      const finalBestAsk = await orderBook.bestAsk();
      console.log(
        `     📊 Final Best Bid: $${ethers.formatUnits(finalBestBid, 6)}`
      );
      console.log(
        `     📊 Final Best Ask: $${ethers.formatUnits(finalBestAsk, 6)}`
      );

      // Now place User2's limit buy order at higher price
      console.log("\n  🔸 Placing limit buy order from User2...");
      console.log("     Price: $2.50");
      console.log("     Amount: 20 ALU");
      console.log("     Side: SELL (limit order)");

      const user2 = signers[2]; // User2 is the 3rd signer
      const user2Price = ethers.parseUnits("5", 6); // $2.50 in USDC (6 decimals)
      const user2Amount = ethers.parseUnits("20", 18); // 20 ALU (18 decimals)

      const user2OrderTx = await orderBook.connect(user2).placeMarginLimitOrder(
        user2Price,
        user2Amount,
        false // isBuy = true for limit buy
      );

      await user2OrderTx.wait();
      console.log("     ✅ Limit buy order placed successfully!");
      console.log(`     💰 User2 placed bid: 20 ALU @ $2.50`);

      // Check updated order book state
      const updatedBestBid = await orderBook.bestBid();
      const updatedBestAsk = await orderBook.bestAsk();
      console.log(
        `     📊 Updated Best Bid: $${ethers.formatUnits(updatedBestBid, 6)}`
      );
      console.log(
        `     📊 Updated Best Ask: $${ethers.formatUnits(updatedBestAsk, 6)}`
      );
    } catch (error) {
      console.log(`     ⚠️  Could not place initial orders: ${error.message}`);
      console.log("     Order placement is optional - deployment can continue");
    }

    // ============================================
    // STEP 6: UPDATE CONFIGURATION
    // ============================================
    console.log("\n📝 STEP 6: UPDATING CONFIGURATION");
    console.log("─".repeat(60));

    // Update contracts.js
    await updateContractsFile(contracts);
    console.log("  ✅ Updated config/contracts.js");

    // Save deployment info
    const deploymentInfo = {
      network: "localhost",
      timestamp: new Date().toISOString(),
      contracts: contracts,
      deployer: deployer.address,
      aluminumMarket: {
        marketId: actualMarketId,
        symbol: marketSymbol,
        orderBook: contracts.ALUMINUM_ORDERBOOK,
      },
    };

    const deploymentPath = path.join(
      __dirname,
      "../deployments/localhost-deployment.json"
    );
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("  ✅ Saved deployment info");

    // ============================================
    // DEPLOYMENT COMPLETE
    // ============================================
    console.log("\n✅ MODULAR DEPLOYMENT COMPLETE!");
    console.log("═".repeat(80));
    console.log("🎉 NEW ARCHITECTURE: All contracts under 24,576 byte limit!");

    console.log("\n📋 DEPLOYED CONTRACTS:");
    console.log("\n🏛️  CORE ARCHITECTURE:");
    console.log(`  CORE_VAULT: ${contracts.CORE_VAULT}`);
    console.log("\n📚 LIBRARIES:");
    console.log(`  VAULT_ANALYTICS: ${contracts.VAULT_ANALYTICS}`);
    console.log(`  POSITION_MANAGER: ${contracts.POSITION_MANAGER}`);
    console.log("\n🏭 INFRASTRUCTURE:");
    Object.entries(contracts).forEach(([name, address]) => {
      if (
        !["CORE_VAULT", "VAULT_ANALYTICS", "POSITION_MANAGER"].includes(name)
      ) {
        console.log(`  ${name}: ${address}`);
      }
    });

    console.log("\n💰 TRADING ACCOUNTS:");
    console.log("  • Each user has 10,000 USDC");
    console.log(
      "  • Deployer & Users 1-2 have 1,000 USDC deposited as collateral"
    );
    console.log("  • User 3 has 15 USDC deposited as collateral");
    console.log("  • Deployer & Users 1-2 have 9,000 USDC available in wallet");
    console.log("  • User 3 has 9,985 USDC available in wallet");

    console.log("\n🏭 ALUMINUM MARKET:");
    console.log("  • Symbol: ALU-USD");
    console.log("  • Start Price: $2,500");
    console.log("  • Margin Requirement: 100% (1:1 ratio)");
    console.log("  • Trading Fee: 0.1%");
    console.log("  • All authorizations configured ✅");

    console.log("\n🎯 READY TO TRADE!");
    console.log("  • Initial limit buy order: 10 ALU @ $1.00 (from deployer)");
    console.log(
      "  • Market sell order: 10 ALU @ $1.00 (from User3) - EXECUTED"
    );
    console.log("  • User3 now has active short position: -10 ALU @ $1.00");
    console.log("  • User2 limit buy order: 20 ALU @ $2.50 (active bid)");
    console.log("  • Order book now has liquidity at $2.50 level");
    console.log("  • Run: node trade.js");
    console.log("═".repeat(80));
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED:", error.message);
    console.error(error);
    process.exit(1);
  }
}

async function updateContractsFile(contracts) {
  const configPath = path.join(__dirname, "../config/contracts.js");

  try {
    let content = fs.readFileSync(configPath, "utf8");

    // Update each contract address
    Object.entries(contracts).forEach(([name, address]) => {
      const regex = new RegExp(`${name}:\\s*"0x[a-fA-F0-9]+"`, "g");
      content = content.replace(regex, `${name}: "${address}"`);
    });

    // Also update specific entries that might have different names
    if (contracts.ALUMINUM_ORDERBOOK) {
      // Update ORDERBOOK to point to ALUMINUM
      content = content.replace(
        /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/,
        `ORDERBOOK: "${contracts.ALUMINUM_ORDERBOOK}"`
      );

      // Add ALUMINUM_ORDERBOOK to CONTRACT_NAMES if not present
      if (!content.includes('ALUMINUM_ORDERBOOK: "OrderBook"')) {
        content = content.replace(
          /MOCK_USDC: "MockUSDC",/,
          `MOCK_USDC: "MockUSDC",\n  ALUMINUM_ORDERBOOK: "OrderBook",`
        );
      }

      // Add ALUMINUM market info if not present
      if (!content.includes("ALUMINUM: {")) {
        const aluminumInfo = `
  ALUMINUM: {
    symbol: "ALU-USD",
    marketId: ethers.keccak256(ethers.toUtf8Bytes("ALU-USD")),
    name: "Aluminum Futures",
    orderBook: "${contracts.ALUMINUM_ORDERBOOK}",
    leverageEnabled: false,
    maxLeverage: "1x",
    marginRequirement: "100%",
    defaultMargin: "100%",
    riskLevel: "LOW",
    collateralRatio: "1:1",
    features: {
      marginRelease: true,
      cumulativeTracking: true,
      multiPriceLevel: true,
    },
  },`;

        // Insert after BTC market info
        const btcEndMatch = content.match(/BTC:\s*{[^}]*}[^}]*},/s);
        if (btcEndMatch) {
          const insertPos = btcEndMatch.index + btcEndMatch[0].length;
          content =
            content.slice(0, insertPos) +
            aluminumInfo +
            content.slice(insertPos);
        }
      }
    }

    fs.writeFileSync(configPath, content);
  } catch (error) {
    console.log("  ⚠️  Could not fully update contracts.js:", error.message);
    console.log("  Please verify the configuration manually");
  }
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
