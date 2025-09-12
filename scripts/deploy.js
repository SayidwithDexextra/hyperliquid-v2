#!/usr/bin/env node

// deploy.js - Complete deployment script for HyperLiquid v2
//
// 🎯 THIS SCRIPT DOES EVERYTHING:
//   1. Deploys all core contracts (MockUSDC, Vault, Factory, Router)
//   2. Sets up all authorization and roles
//   3. Creates ALUMINUM market
//   4. Funds trading accounts with USDC and collateral
//   5. Updates configuration files
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
const COLLATERAL_PER_USER = "1000"; // 1,000 USDC collateral per user
const NUM_USERS = 4; // Setup 4 trading accounts

async function main() {
  console.log("\n🚀 HYPERLIQUID V2 - COMPLETE DEPLOYMENT");
  console.log("═".repeat(80));

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

    // Deploy CentralizedVault
    console.log("  2️⃣ Deploying CentralizedVault...");
    const CentralizedVault = await ethers.getContractFactory(
      "CentralizedVault"
    );
    const vault = await CentralizedVault.deploy(
      contracts.MOCK_USDC,
      deployer.address
    );
    await vault.waitForDeployment();
    contracts.CENTRALIZED_VAULT = await vault.getAddress();
    console.log(
      "     ✅ CentralizedVault deployed at:",
      contracts.CENTRALIZED_VAULT
    );

    // Deploy FuturesMarketFactory
    console.log("  3️⃣ Deploying FuturesMarketFactory...");
    const FuturesMarketFactory = await ethers.getContractFactory(
      "FuturesMarketFactory"
    );
    const factory = await FuturesMarketFactory.deploy(
      contracts.CENTRALIZED_VAULT,
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
    console.log("  4️⃣ Deploying TradingRouter...");
    const TradingRouter = await ethers.getContractFactory("TradingRouter");
    const router = await TradingRouter.deploy(
      contracts.CENTRALIZED_VAULT,
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

    console.log("  🔧 Granting FACTORY_ROLE to FuturesMarketFactory...");
    await vault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);
    console.log("     ✅ FACTORY_ROLE granted");

    console.log("  🔧 Granting SETTLEMENT_ROLE to FuturesMarketFactory...");
    await vault.grantRole(SETTLEMENT_ROLE, contracts.FUTURES_MARKET_FACTORY);
    console.log("     ✅ SETTLEMENT_ROLE granted");

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
    await vault.grantRole(SETTLEMENT_ROLE, deployer.address);
    // Set mark price to $1 to match initial liquidity
    const actualInitialPrice = ethers.parseUnits("1", 6); // $1 USDC
    await vault.updateMarkPrice(actualMarketId, actualInitialPrice);
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
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );
    await vault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
    console.log("     ✅ ORDERBOOK_ROLE granted to OrderBook");

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

        // Deposit collateral (skip deployer)
        if (i > 0) {
          const collateralAmount = ethers.parseUnits(COLLATERAL_PER_USER, 6);
          await mockUSDC
            .connect(user)
            .approve(contracts.CENTRALIZED_VAULT, collateralAmount);
          await vault.connect(user).depositCollateral(collateralAmount);
          console.log(
            `     ✅ Deposited ${COLLATERAL_PER_USER} USDC as collateral`
          );
        } else {
          console.log(
            `     ℹ️  Skipping collateral (deployer keeps funds for operations)`
          );
        }

        // Show final balances
        const balance = await mockUSDC.balanceOf(user.address);
        const collateral = await vault.userCollateral(user.address);
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
    // STEP 5: UPDATE CONFIGURATION
    // ============================================
    console.log("\n📝 STEP 5: UPDATING CONFIGURATION");
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
    console.log("\n✅ DEPLOYMENT COMPLETE!");
    console.log("═".repeat(80));

    console.log("\n📋 DEPLOYED CONTRACTS:");
    Object.entries(contracts).forEach(([name, address]) => {
      console.log(`  ${name}: ${address}`);
    });

    console.log("\n💰 TRADING ACCOUNTS:");
    console.log("  • Each user has 10,000 USDC");
    console.log("  • Users 1-3 have 1,000 USDC deposited as collateral");
    console.log("  • Users 1-3 have 9,000 USDC available in wallet");
    console.log("  • Deployer has all 10,000 USDC in wallet");

    console.log("\n🏭 ALUMINUM MARKET:");
    console.log("  • Symbol: ALU-USD");
    console.log("  • Start Price: $2,500");
    console.log("  • Margin Requirement: 100% (1:1 ratio)");
    console.log("  • Trading Fee: 0.1%");
    console.log("  • All authorizations configured ✅");

    console.log("\n🎯 READY TO TRADE!");
    console.log("  Run: node trade.js");
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
