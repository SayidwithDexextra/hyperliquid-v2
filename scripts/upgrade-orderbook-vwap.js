#!/usr/bin/env node

// upgrade-orderbook-vwap.js - Upgrade OrderBook to include VWAP implementation
//
// 🎯 THIS SCRIPT:
//   1. Deploys new OrderBook with VWAP implementation
//   2. Grants all necessary roles and authorizations
//   3. Updates vault to use new OrderBook
//   4. Migrates market configuration
//   5. Tests VWAP functionality
//
// 🚀 USAGE:
//   node scripts/upgrade-orderbook-vwap.js
//   OR
//   npx hardhat run scripts/upgrade-orderbook-vwap.js --network localhost
//

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Color functions for better output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

async function main() {
  console.log(colorText("\n🚀 ORDERBOOK VWAP UPGRADE", "bright"));
  console.log("═".repeat(80));

  const [deployer] = await ethers.getSigners();
  console.log("📋 Deployer:", deployer.address);

  try {
    // Load deployment info
    const deploymentPath = path.join(
      __dirname,
      "../deployments/localhost-deployment.json"
    );
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(
        "No deployment found. Please run the deployment script first."
      );
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const oldOrderBookAddress =
      deployment.contracts.ALUMINUM_ORDERBOOK ||
      deployment.aluminumMarket.orderBook;
    const marketId = deployment.aluminumMarket.marketId;

    console.log("\n📊 Current Deployment:");
    console.log(`  Old OrderBook: ${oldOrderBookAddress}`);
    console.log(`  Vault: ${deployment.contracts.CENTRALIZED_VAULT}`);
    console.log(`  Market ID: ${marketId}`);

    // ============================================
    // STEP 1: DEPLOY NEW ORDERBOOK
    // ============================================
    console.log(
      colorText("\n📦 STEP 1: DEPLOYING NEW ORDERBOOK WITH VWAP", "cyan")
    );
    console.log("─".repeat(60));

    const OrderBook = await ethers.getContractFactory("OrderBook");
    const newOrderBook = await OrderBook.deploy(
      deployment.contracts.CENTRALIZED_VAULT,
      marketId,
      deployer.address // fee recipient
    );
    await newOrderBook.waitForDeployment();

    const newOrderBookAddress = await newOrderBook.getAddress();
    console.log("✅ New OrderBook deployed at:", newOrderBookAddress);

    // ============================================
    // STEP 2: GRANT AUTHORIZATIONS
    // ============================================
    console.log(colorText("\n🔒 STEP 2: SETTING UP AUTHORIZATION", "cyan"));
    console.log("─".repeat(60));

    const CentralizedVault = await ethers.getContractFactory(
      "CentralizedVault"
    );
    const vault = CentralizedVault.attach(
      deployment.contracts.CENTRALIZED_VAULT
    );

    // We need FACTORY_ROLE to register OrderBook
    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );

    // Temporarily grant FACTORY_ROLE to deployer
    console.log("  🔧 Granting temporary FACTORY_ROLE to deployer...");
    await vault.grantRole(FACTORY_ROLE, deployer.address);
    console.log("     ✅ FACTORY_ROLE granted");

    // Register new OrderBook with vault
    console.log("  🔧 Registering new OrderBook with vault...");
    await vault.registerOrderBook(newOrderBookAddress);
    console.log("     ✅ OrderBook registered (includes ORDERBOOK_ROLE)");

    // Assign market to new OrderBook
    console.log("  🔧 Assigning market to new OrderBook...");
    await vault.assignMarketToOrderBook(marketId, newOrderBookAddress);
    console.log("     ✅ Market assigned to OrderBook");

    // Revoke temporary FACTORY_ROLE from deployer
    console.log("  🔧 Revoking temporary FACTORY_ROLE from deployer...");
    await vault.revokeRole(FACTORY_ROLE, deployer.address);
    console.log("     ✅ FACTORY_ROLE revoked");

    // ============================================
    // STEP 3: CONFIGURE VWAP
    // ============================================
    console.log(colorText("\n⚙️  STEP 3: CONFIGURING VWAP SETTINGS", "cyan"));
    console.log("─".repeat(60));

    // Check default VWAP settings
    const defaultTimeWindow = await newOrderBook.vwapTimeWindow();
    const minVolume = await newOrderBook.minVolumeForVWAP();
    const useVWAP = await newOrderBook.useVWAPForMarkPrice();

    console.log("  📊 Default VWAP Configuration:");
    console.log(
      `     Time Window: ${defaultTimeWindow} seconds (${
        Number(defaultTimeWindow) / 3600
      } hours)`
    );
    console.log(`     Min Volume: ${ethers.formatUnits(minVolume, 18)} units`);
    console.log(`     Use VWAP: ${useVWAP}`);

    // Configure VWAP if needed
    if (Number(defaultTimeWindow) !== 3600) {
      console.log("  🔧 Adjusting VWAP configuration...");
      await newOrderBook.configureVWAP(
        3600, // 1 hour window
        ethers.parseUnits("100", 18), // 100 units minimum
        true // use VWAP for mark price
      );
      console.log("     ✅ VWAP configured");
    }

    // ============================================
    // STEP 4: UPDATE DEPLOYMENT INFO
    // ============================================
    console.log(colorText("\n📝 STEP 4: UPDATING DEPLOYMENT INFO", "cyan"));
    console.log("─".repeat(60));

    // Update deployment file
    deployment.contracts.ALUMINUM_ORDERBOOK_OLD = oldOrderBookAddress;
    deployment.contracts.ALUMINUM_ORDERBOOK = newOrderBookAddress;
    deployment.aluminumMarket.orderBook = newOrderBookAddress;
    deployment.aluminumMarket.orderBookOld = oldOrderBookAddress;
    deployment.aluminumMarket.vwapEnabled = true;
    deployment.lastUpgrade = {
      timestamp: new Date().toISOString(),
      type: "OrderBook VWAP Upgrade",
      oldContract: oldOrderBookAddress,
      newContract: newOrderBookAddress,
    };

    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
    console.log("  ✅ Updated deployment info");

    // Update contracts.js config
    await updateContractsFile(newOrderBookAddress);
    console.log("  ✅ Updated config/contracts.js");

    // ============================================
    // STEP 5: VERIFY VWAP FUNCTIONALITY
    // ============================================
    console.log(colorText("\n🧪 STEP 5: VERIFYING VWAP FUNCTIONALITY", "cyan"));
    console.log("─".repeat(60));

    // Test VWAP calculation
    try {
      const vwapData = await newOrderBook.calculateVWAP(3600);
      console.log("  ✅ VWAP calculation working");
      console.log(
        `     VWAP: ${
          vwapData.vwap > 0
            ? ethers.formatUnits(vwapData.vwap, 6)
            : "No trades yet"
        }`
      );
      console.log(
        `     Volume: ${ethers.formatUnits(vwapData.totalVolume, 18)} units`
      );
      console.log(`     Trade Count: ${vwapData.tradeCount}`);
    } catch (error) {
      console.log("  ❌ VWAP calculation error:", error.message);
    }

    // Test mark price calculation
    const markPrice = await newOrderBook.calculateMarkPrice();
    console.log(
      `  ✅ Mark price calculation: $${ethers.formatUnits(markPrice, 6)}`
    );

    // Test multi-window VWAP
    try {
      const multiVWAP = await newOrderBook.getMultiWindowVWAP();
      console.log("  ✅ Multi-window VWAP working");
    } catch (error) {
      console.log("  ❌ Multi-window VWAP error:", error.message);
    }

    // ============================================
    // UPGRADE COMPLETE
    // ============================================
    console.log(colorText("\n✅ ORDERBOOK UPGRADE COMPLETE!", "green"));
    console.log("═".repeat(80));

    console.log("\n📋 UPGRADE SUMMARY:");
    console.log(`  Old OrderBook: ${oldOrderBookAddress}`);
    console.log(`  New OrderBook: ${newOrderBookAddress}`);
    console.log(`  Market ID: ${marketId}`);

    console.log("\n✨ NEW FEATURES:");
    console.log("  • Time-windowed VWAP calculation");
    console.log("  • VWAP-based mark price hierarchy");
    console.log("  • Configurable time windows (5m, 15m, 1h, 4h, 24h)");
    console.log("  • Minimum volume thresholds");
    console.log("  • Circular buffer for efficient trade history");

    console.log("\n📊 VWAP CONFIGURATION:");
    console.log("  • Default Time Window: 1 hour");
    console.log("  • Minimum Volume: 100 units");
    console.log("  • VWAP Enabled: Yes");

    console.log("\n🎯 NEXT STEPS:");
    console.log("  1. Execute some trades to generate VWAP data");
    console.log("  2. Run: node scripts/test-vwap-mark-price.js");
    console.log("  3. Monitor mark price behavior with VWAP");

    console.log("\n⚠️  NOTE:");
    console.log("  • Old OrderBook is still deployed but no longer active");
    console.log("  • All new orders must go through the new OrderBook");
    console.log(
      "  • Historical trades are not migrated (fresh VWAP calculation)"
    );

    console.log("═".repeat(80));
  } catch (error) {
    console.error(colorText("\n❌ UPGRADE FAILED:", "red"), error.message);
    console.error(error);
    process.exit(1);
  }
}

async function updateContractsFile(newOrderBookAddress) {
  const configPath = path.join(__dirname, "../config/contracts.js");

  try {
    let content = fs.readFileSync(configPath, "utf8");

    // Update ALUMINUM_ORDERBOOK address
    content = content.replace(
      /ALUMINUM_ORDERBOOK:\s*"0x[a-fA-F0-9]+"/,
      `ALUMINUM_ORDERBOOK: "${newOrderBookAddress}"`
    );

    // Update ORDERBOOK to point to new address
    content = content.replace(
      /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/,
      `ORDERBOOK: "${newOrderBookAddress}"`
    );

    // Update ALUMINUM market orderBook address
    const aluminumMatch = content.match(
      /ALUMINUM:\s*{[^}]*orderBook:\s*"0x[a-fA-F0-9]+"/s
    );
    if (aluminumMatch) {
      const updated = aluminumMatch[0].replace(
        /orderBook:\s*"0x[a-fA-F0-9]+"/,
        `orderBook: "${newOrderBookAddress}"`
      );
      content = content.replace(aluminumMatch[0], updated);
    }

    fs.writeFileSync(configPath, content);
  } catch (error) {
    console.log("  ⚠️  Could not fully update contracts.js:", error.message);
    console.log("  Please verify the configuration manually");
  }
}

// Run upgrade
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
