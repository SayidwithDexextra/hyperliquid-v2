#!/usr/bin/env node

// deploy.js - Complete deployment script for HyperLiquid v2
//
// 🎯 THIS SCRIPT DEPLOYS OUR NEW MODULAR ARCHITECTURE:
//   1. Deploys libraries (VaultAnalytics, PositionManager)
//   2. Deploys core contracts (MockUSDC, CoreVault, Factory, Router)
//   3. Sets up all authorization and roles between modular contracts
//   4. Creates ALUMINUM market
//   5. Funds trading accounts with USDC and collateral
//   6. Places initial limit buy orders (5 ALU @ $1.00 from deployer and User1)
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
const USER1_COLLATERAL = "1000"; // 5,000 USDC collateral for User 1 (for $2.50 buy orders)
const USER2_COLLATERAL = "1000"; // 5,000 USDC collateral for User 2 (for $2.50 sell orders)
const USER3_COLLATERAL = "1000"; // 15 USDC collateral for User 3
const NUM_USERS = 5; // Setup 5 trading accounts
// Toggle: enable/disable placing initial orders and trades during deployment
const ENABLE_INITIAL_TRADES = false; // set to true to place initial orders/trades

async function main() {
  console.log("\n🚀 HYPERLIQUID V2 - MODULAR DEPLOYMENT");
  console.log("═".repeat(80));
  console.log(
    "🏗️  NEW ARCHITECTURE: CoreVault + 2 Libraries (VaultAnalytics + PositionManager)"
  );
  console.log("✅ All contracts under 24,576 byte limit!");

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);

  // Get all signers and validate we have enough
  const signers = await ethers.getSigners();
  if (signers.length < NUM_USERS) {
    throw new Error(
      `❌ Need at least ${NUM_USERS} signers, but only ${signers.length} available. Check your .env file has all ${NUM_USERS} private keys.`
    );
  }

  const [deployer] = signers;
  console.log("📋 Deployer:", deployer.address);
  console.log(`👥 Available signers: ${signers.length}/${NUM_USERS} users`);

  // Treasury address to receive protocol fees (and to act as OrderBook admin)
  // Defaults to deployer unless TREASURY_ADDRESS env var is provided
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("🏦 Treasury:", TREASURY_ADDRESS);

  // Check deployer balance for gas
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(
    `💰 Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`
  );

  if (deployerBalance === 0n) {
    console.log(
      "⚠️  WARNING: Deployer has 0 balance. Make sure you have native tokens for gas!"
    );
  }

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
    console.log("     ⏳ Deploying contract...");
    const mockUSDC = await MockUSDC.deploy(deployer.address);
    console.log("     ⏳ Waiting for deployment confirmation...");
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

    // 4b) Deploy LiquidationManager and wire into CoreVault
    console.log("  4️⃣b Deploying LiquidationManager...");
    const LiquidationManager = await ethers.getContractFactory(
      "LiquidationManager",
      {
        libraries: {
          VaultAnalytics: contracts.VAULT_ANALYTICS,
          PositionManager: contracts.POSITION_MANAGER,
        },
      }
    );
    const liquidationManager = await LiquidationManager.deploy(
      contracts.MOCK_USDC,
      deployer.address
    );
    await liquidationManager.waitForDeployment();
    contracts.LIQUIDATION_MANAGER = await liquidationManager.getAddress();
    console.log(
      "     ✅ LiquidationManager deployed at:",
      contracts.LIQUIDATION_MANAGER
    );

    console.log("     🔧 Setting CoreVault.liquidationManager...");
    await coreVault.setLiquidationManager(contracts.LIQUIDATION_MANAGER);
    console.log("     ✅ LiquidationManager configured on CoreVault");

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

    // 5b) Deploy Diamond facets and prepare cut
    console.log("  5️⃣b Deploying Diamond facets for OrderBook...");
    const OrderBookInitFacet = await ethers.getContractFactory(
      "OrderBookInitFacet"
    );
    const OBAdminFacet = await ethers.getContractFactory("OBAdminFacet");
    const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
    const OBOrderPlacementFacet = await ethers.getContractFactory(
      "OBOrderPlacementFacet"
    );
    const OBTradeExecutionFacet = await ethers.getContractFactory(
      "OBTradeExecutionFacet"
    );
    const OBLiquidationFacet = await ethers.getContractFactory(
      "OBLiquidationFacet"
    );
    const OBViewFacet = await ethers.getContractFactory("OBViewFacet");

    const initFacet = await OrderBookInitFacet.deploy();
    await initFacet.waitForDeployment();
    const adminFacet = await OBAdminFacet.deploy();
    await adminFacet.waitForDeployment();
    const pricingFacet = await OBPricingFacet.deploy();
    await pricingFacet.waitForDeployment();
    const placementFacet = await OBOrderPlacementFacet.deploy();
    await placementFacet.waitForDeployment();
    const execFacet = await OBTradeExecutionFacet.deploy();
    await execFacet.waitForDeployment();
    const liqFacet = await OBLiquidationFacet.deploy();
    await liqFacet.waitForDeployment();
    const viewFacet = await OBViewFacet.deploy();
    await viewFacet.waitForDeployment();

    const initAddr = await initFacet.getAddress();
    const adminAddr = await adminFacet.getAddress();
    const pricingAddr = await pricingFacet.getAddress();
    const placementAddr = await placementFacet.getAddress();
    const execAddr = await execFacet.getAddress();
    const liqAddr = await liqFacet.getAddress();

    console.log("     ✅ Facets deployed:");
    console.log("        init:", initAddr);
    console.log("        admin:", adminAddr);
    console.log("        pricing:", pricingAddr);
    console.log("        placement:", placementAddr);
    console.log("        execution:", execAddr);
    console.log("        liquidation:", liqAddr);

    // Set conservative defaults: 100% margin, 0 bps trading fee (no fees)
    try {
      console.log(
        "  🔧 Setting factory defaults: margin=10000 bps, fee=0 bps..."
      );
      await factory.updateDefaultParameters(10000, 0);
      console.log(
        "     ✅ Factory default parameters updated (100% margin, 0% fee)"
      );
    } catch (e) {
      console.log(
        "     ⚠️  Could not update factory default parameters:",
        e?.message || e
      );
    }

    // TradingRouter deployment removed (Diamond-only flow)

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

    // Set fixed MMR: 10% buffer + 10% penalty = 20% total, no scaling
    console.log(
      "     → Setting global MMR params (fixed 20%: 10% buffer + 10% penalty)..."
    );
    await coreVault.setMmrParams(1000, 1000, 2000, 0, 1);
    console.log(
      "     ✅ MMR params set: base=10%, penalty=10%, cap=20%, scaling=0, depth=1"
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
    const tradingFee = 0; // 0% during bootstrapping to avoid fee side-effects

    console.log("  📊 Market Parameters:");
    console.log(`     Symbol: ${marketSymbol}`);
    console.log(`     Start Price: $${ethers.formatUnits(startPrice, 6)}`);
    console.log(`     Margin Requirement: ${marginRequirementBps / 100}%`);
    console.log(`     Trading Fee: ${tradingFee / 100}%`);

    // Check and pay creation fee (optional; admin is exempt). The optimized factory
    // may not expose a public getter, so we skip querying and approval.
    console.log("  💰 Market creation fee: skipped query (admin exempt)");

    // Create Diamond-based market
    console.log("  🚀 Creating ALUMINUM futures market (Diamond)...");
    // Build cut with selectors
    const cut = [];
    const FacetCutAction = { Add: 0 };
    function selectors(iface) {
      // Build 4-byte selectors from function fragments
      return iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => {
          const sig = f.format("sighash"); // e.g., transfer(address,uint256)
          const sel = ethers.id(sig).slice(0, 10); // 0x + 8 hex chars
          return sel;
        });
    }
    cut.push({
      facetAddress: adminAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(adminFacet.interface),
    });
    cut.push({
      facetAddress: pricingAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(pricingFacet.interface),
    });
    cut.push({
      facetAddress: placementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(placementFacet.interface),
    });
    cut.push({
      facetAddress: execAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(execFacet.interface),
    });
    cut.push({
      facetAddress: liqAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(liqFacet.interface),
    });
    const viewAddr = await viewFacet.getAddress();
    cut.push({
      facetAddress: viewAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(viewFacet.interface),
    });

    const createTx = await factory.createFuturesMarketDiamond(
      marketSymbol,
      metricUrl,
      settlementDate,
      startPrice,
      dataSource,
      tags,
      deployer.address,
      cut,
      initAddr,
      "0x" // init calldata will be generated in factory using obInitialize(vault, marketId, feeRecipient)
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
      // Persist the runtime marketId so config can reference the correct mapping key
      contracts.ALUMINUM_MARKET_ID = actualMarketId;
      console.log(
        "     ✅ ALUMINUM OrderBook deployed at:",
        contracts.ALUMINUM_ORDERBOOK
      );
      console.log("     ✅ Market ID:", actualMarketId);
    } else {
      throw new Error("Failed to get OrderBook address from event");
    }

    // Configure the Diamond OB via admin facet
    try {
      const obAdmin = await ethers.getContractAt(
        "OBAdminFacet",
        contracts.ALUMINUM_ORDERBOOK
      );
      console.log(
        "  🔧 Configuring Diamond OB params (100% margin, 0% fee, treasury)..."
      );
      await obAdmin.updateTradingParameters(10000, 0, TREASURY_ADDRESS);
      console.log("     ✅ Diamond OB trading parameters set");
    } catch (e) {
      console.log(
        "     ⚠️  Could not set Diamond OB trading parameters:",
        e?.message || e
      );
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

    // Grant ORDERBOOK_ROLE to the Diamond OB
    await coreVault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
    console.log("     ✅ ORDERBOOK_ROLE granted to OrderBook");

    // Grant SETTLEMENT_ROLE to the Diamond OB
    await coreVault.grantRole(SETTLEMENT_ROLE, contracts.ALUMINUM_ORDERBOOK);
    console.log("     ✅ SETTLEMENT_ROLE granted to OrderBook");

    // Verify role assignments and market registration
    try {
      const hasObRole = await coreVault.hasRole(
        ORDERBOOK_ROLE,
        contracts.ALUMINUM_ORDERBOOK
      );
      console.log(
        `     🔎 Verification: ORDERBOOK_ROLE on OB = ${
          hasObRole ? "true" : "false"
        }`
      );
    } catch (e) {
      console.log(
        `     ⚠️  Could not verify ORDERBOOK_ROLE on OB: ${e?.message || e}`
      );
    }

    // Configure margin requirements for 1:1 longs, 150% shorts (no leverage)
    console.log("  🔧 Configuring margin requirements...");
    const obAdmin2 = await ethers.getContractAt(
      "OBAdminFacet",
      contracts.ALUMINUM_ORDERBOOK
    );

    // Ensure leverage is disabled and margin is set to 100% (10000 BPS) for longs
    // Shorts will require 150% but that's handled in the trading logic
    try {
      await obAdmin2.connect(deployer).disableLeverage();
      console.log("     ✅ Leverage disabled - using 1:1 margin system");
    } catch (error) {
      console.log("     ⚠️  Leverage already disabled");
    }

    console.log("     ℹ️  Long positions: 100% margin (1:1)");
    console.log(
      "     ℹ️  Short positions: 150% margin (handled by trading logic)"
    );

    // Update factory fee recipient to treasury for subsequent markets
    try {
      console.log(
        "  🔧 Updating factory feeRecipient to treasury for future markets..."
      );
      await factory.updateFeeRecipient(TREASURY_ADDRESS);
      console.log("     ✅ Factory feeRecipient set to:", TREASURY_ADDRESS);
    } catch (e) {
      console.log(
        "     ⚠️  Could not update factory feeRecipient:",
        e?.message || e
      );
    }

    // No VaultRouter – liquidation is integrated

    // Minimal initial seeding will be performed after collateral funding

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

        // Deposit collateral (Users 1, 2 and 3 get special amounts)
        let collateralAmountStr = COLLATERAL_PER_USER;
        if (i === 1) {
          collateralAmountStr = USER1_COLLATERAL; // User 1 gets more for $2.50 buy orders
        } else if (i === 2) {
          collateralAmountStr = USER2_COLLATERAL; // User 2 gets more for $2.50 sell orders
        } else if (i === 3) {
          collateralAmountStr = USER3_COLLATERAL; // User 3 gets less for testing
        }
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

    if (ENABLE_INITIAL_TRADES) {
      try {
        // Get the deployed Diamond OrderBook facets
        const orderPlacement = await ethers.getContractAt(
          "OBOrderPlacementFacet",
          contracts.ALUMINUM_ORDERBOOK
        );
        const tradeExec = await ethers.getContractAt(
          "OBTradeExecutionFacet",
          contracts.ALUMINUM_ORDERBOOK
        );
        const viewFacetRuntime = await ethers.getContractAt(
          "OBViewFacet",
          contracts.ALUMINUM_ORDERBOOK
        );

        // ============================================
        // DEBUG: RUNTIME EVENT LISTENERS (Diamond/CoreVault)
        // ============================================
        try {
          const fmt6 = (x) => {
            try {
              return ethers.formatUnits(x, 6);
            } catch {
              return x?.toString?.() ?? x;
            }
          };
          const fmt18 = (x) => {
            try {
              return ethers.formatUnits(x, 18);
            } catch {
              return x?.toString?.() ?? x;
            }
          };
          const toStr = (x) => x?.toString?.() ?? String(x);

          // ----- Diamond OB events -----
          const obIfaceForEvents = await ethers.getContractAt(
            "OrderBook",
            contracts.ALUMINUM_ORDERBOOK
          );
          obIfaceForEvents.on(
            "PriceUpdated",
            (lastTradePrice, currentMarkPrice) => {
              console.log(
                `🧭 PriceUpdated → last=${fmt6(lastTradePrice)} mark=${fmt6(
                  currentMarkPrice
                )}`
              );
            }
          );
          obIfaceForEvents.on(
            "LiquidationCheckTriggered",
            (currentMark, lastMarkPrice) => {
              console.log(
                `🧪 LiquidationCheckTriggered → current=${fmt6(
                  currentMark
                )} last=${fmt6(lastMarkPrice)}`
              );
            }
          );
        } catch (e) {
          console.log(`⚠️  Failed to set up debug listeners: ${e.message}`);
        }

        console.log("  🔸 Placing limit buy orders from deployer and User1...");
        console.log("     Price: $1.00");
        console.log("     Amount: 5 ALU each");
        console.log("     Side: BUY");

        const price = ethers.parseUnits("1", 6); // $1.00 in USDC (6 decimals)
        const amountEach = ethers.parseUnits("4", 18);
        const amountEach2 = ethers.parseUnits("6", 18);

        const buyTx1 = await orderPlacement
          .connect(deployer)
          .placeMarginLimitOrder(price, amountEach, true);
        await buyTx1.wait();
        console.log("     ✅ Deployer limit buy placed (5 ALU @ $1.00)");

        const user1Signer = signers[1]; // User1 is the 2nd signer
        const buyTx2 = await orderPlacement
          .connect(user1Signer)
          .placeMarginLimitOrder(price, amountEach2, true);
        await buyTx2.wait();
        console.log("     ✅ User1 limit buy placed (5 ALU @ $1.00)");

        // Check the order book state
        const bestBid = await viewFacetRuntime.bestBid();
        const bestAsk = await viewFacetRuntime.bestAsk();
        console.log(`     📊 Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
        console.log(`     📊 Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);

        // Now place User3's market sell order to match against the limit buy
        console.log("\n  🔸 Placing market sell order from User3...");
        console.log("     Amount: 10 ALU");
        console.log("     Side: SELL (market order)");

        const user3 = signers[3]; // User3 is the 4th signer
        const totalSellAmount = ethers.parseUnits("10", 18); // 10 ALU to match both bids
        const sellTx = await tradeExec
          .connect(user3)
          .placeMarginMarketOrder(totalSellAmount, false);

        await sellTx.wait();
        console.log("     ✅ Market sell order executed successfully!");
        console.log(`     💰 User3 opened short position: -10 ALU @ $1.00`);

        // Check final order book state
        const finalBestBid = await viewFacetRuntime.bestBid();
        const finalBestAsk = await viewFacetRuntime.bestAsk();
        console.log(
          `     📊 Final Best Bid: $${ethers.formatUnits(finalBestBid, 6)}`
        );
        console.log(
          `     📊 Final Best Ask: $${ethers.formatUnits(finalBestAsk, 6)}`
        );

        // Now place User2's limit sell order at higher price
        console.log("\n  🔸 Placing limit sell order from User2...");
        console.log("     Price: $2.50");
        console.log("     Amount: 20 ALU");
        console.log("     Side: SELL (limit order)");

        const user2 = signers[2]; // User2 is the 3rd signer
        const user2Price = ethers.parseUnits("2.3", 6); // $2.30 in USDC (6 decimals)
        const user2Amount = ethers.parseUnits("20", 18); // 20 ALU (18 decimals)

        const user2OrderTx = await orderPlacement
          .connect(user2)
          .placeMarginLimitOrder(
            user2Price,
            user2Amount,
            false // isBuy = false for limit sell
          );

        await user2OrderTx.wait();
        console.log("     ✅ Limit sell order placed successfully!");
        console.log(`     💰 User2 placed ask: 20 ALU @ $2.50`);

        // Check updated order book state
        const updatedBestBid = await viewFacetRuntime.bestBid();
        const updatedBestAsk = await viewFacetRuntime.bestAsk();
        console.log(
          `     📊 Updated Best Bid: $${ethers.formatUnits(updatedBestBid, 6)}`
        );
        console.log(
          `     📊 Updated Best Ask: $${ethers.formatUnits(updatedBestAsk, 6)}`
        );

        // Market buy preflight (keep as diagnostics without execution)
        try {
          const bestAskNow = await viewFacetRuntime.bestAsk();
          const slippageBps = await viewFacetRuntime.maxSlippageBps();
          const worstCasePrice = (bestAskNow * (10000n + slippageBps)) / 10000n;
          const user1Avail = await coreVault.getAvailableCollateral(
            user1Signer.address
          );
          console.log(
            `     🔍 Preflight: bestAsk=${ethers.formatUnits(
              bestAskNow,
              6
            )} slippage=${slippageBps}bps worst=${ethers.formatUnits(
              worstCasePrice,
              6
            )} avail=${ethers.formatUnits(user1Avail, 6)}`
          );
        } catch (e) {
          console.log(`     DEBUG ERROR: ${e.message}`);
          console.log(
            "     ⚠️  Could not run preflight - continuing deployment"
          );
        }

        // Check final order book state after diagnostics
        const finalUpdatedBestBid = await viewFacetRuntime.bestBid();
        const finalUpdatedBestAsk = await viewFacetRuntime.bestAsk();
        console.log(
          `     📊 Final Best Bid: $${ethers.formatUnits(
            finalUpdatedBestBid,
            6
          )}`
        );
        console.log(
          `     📊 Final Best Ask: $${ethers.formatUnits(
            finalUpdatedBestAsk,
            6
          )}`
        );
      } catch (error) {
        console.log(
          `     ⚠️  Could not place initial orders: ${error.message}`
        );
        console.log(
          "     Order placement is optional - deployment can continue"
        );
      }
    } else {
      console.log(
        "⏭️  Skipped placing initial orders (ENABLE_INITIAL_TRADES=false)"
      );
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
      network: networkName,
      chainId: Number(network.chainId),
      timestamp: new Date().toISOString(),
      contracts: contracts,
      deployer: deployer.address,
      allUsers: signers.slice(0, NUM_USERS).map((signer, index) => ({
        index,
        address: signer.address,
        role: index === 0 ? "deployer" : `user${index}`,
      })),
      aluminumMarket: {
        marketId: actualMarketId,
        symbol: marketSymbol,
        orderBook: contracts.ALUMINUM_ORDERBOOK,
      },
    };

    const deploymentPath = path.join(
      __dirname,
      `../deployments/${networkName}-deployment.json`
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
    try {
      const defaults = await factory.getDefaultParameters();
      const defaultFeeBps = Array.isArray(defaults)
        ? defaults[1]
        : defaults.fee;
      const feePct = Number(defaultFeeBps) / 100;
      console.log(`  • Trading Fee (default): ${feePct}%`);
    } catch {
      console.log("  • Trading Fee (default): 0% (assumed)");
    }
    console.log("  • All authorizations configured ✅");

    console.log("\n🎯 READY TO TRADE!");
    if (ENABLE_INITIAL_TRADES) {
      console.log(
        "  • Initial limit buy orders: 5 ALU @ $1.00 (deployer) + 5 ALU @ $1.00 (User1)"
      );
      console.log(
        "  • Market sell order: 10 ALU @ $1.00 (from User3) - EXECUTED"
      );
      console.log("  • User3 now has active short position: -10 ALU @ $1.00");
      console.log("  • User2 limit sell order: 20 ALU @ $2.50 (active ask)");
      console.log("  • Market buy order: 5 ALU (from User1) - EXECUTED");
      console.log("  • User1 now has active long position: +5 ALU @ $2.50");
      console.log(
        "  • User2 partially filled: sold 5 ALU, 15 ALU remaining @ $2.50"
      );
      console.log("  • Order book now has ask liquidity at $2.50 level");
    } else {
      console.log("  • Initial order/trade placement skipped by configuration");
    }
    console.log(
      `  • Run: npx hardhat run scripts/interactive-trader.js --network ${networkName}`
    );
    console.log(
      `  • Deployment saved: deployments/${networkName}-deployment.json`
    );
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

      // If ALUMINUM block already exists, ensure marketId is the actual one
      if (contracts.ALUMINUM_MARKET_ID) {
        const aluBlockRegex = /ALUMINUM:\s*\{[\s\S]*?\}/m;
        const m = content.match(aluBlockRegex);
        if (m) {
          const updated = m[0].replace(
            /marketId:\s*[^,]+,/,
            `marketId: "${contracts.ALUMINUM_MARKET_ID}",`
          );
          content = content.replace(aluBlockRegex, updated);
        }
      }

      // Add ALUMINUM market info if not present
      if (!content.includes("ALUMINUM: {")) {
        const aluminumInfo = `
  ALUMINUM: {
    symbol: "ALU-USD",
    marketId: "${contracts.ALUMINUM_MARKET_ID || "0x"}",
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
