#!/usr/bin/env node

// deploy-vwap-orderbook.js - Deploy new VWAP-enabled OrderBook
//
// 🎯 THIS SCRIPT:
//   1. Deploys new OrderBook with VWAP implementation
//   2. Updates deployment configuration
//   3. Provides instructions for testing
//
// 🚀 USAGE:
//   node scripts/deploy-vwap-orderbook.js
//   OR
//   npx hardhat run scripts/deploy-vwap-orderbook.js --network localhost
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
  console.log(colorText("\n🚀 VWAP-ENABLED ORDERBOOK DEPLOYMENT", "bright"));
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
    console.log(`  Vault: ${deployment.contracts.CENTRALIZED_VAULT}`);
    console.log(`  Old OrderBook: ${oldOrderBookAddress}`);
    console.log(`  Market ID: ${marketId}`);

    // ============================================
    // STEP 1: DEPLOY NEW ORDERBOOK WITH VWAP
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
    // STEP 2: VERIFY VWAP FUNCTIONALITY
    // ============================================
    console.log(colorText("\n🧪 STEP 2: VERIFYING VWAP FUNCTIONALITY", "cyan"));
    console.log("─".repeat(60));

    // Check VWAP configuration
    const defaultTimeWindow = await newOrderBook.vwapTimeWindow();
    const minVolume = await newOrderBook.minVolumeForVWAP();
    const useVWAP = await newOrderBook.useVWAPForMarkPrice();

    console.log("  📊 VWAP Configuration:");
    console.log(
      `     Time Window: ${defaultTimeWindow} seconds (${
        Number(defaultTimeWindow) / 3600
      } hours)`
    );
    console.log(`     Min Volume: ${ethers.formatUnits(minVolume, 18)} units`);
    console.log(`     Use VWAP: ${useVWAP}`);

    // Test VWAP functions exist
    try {
      const vwapData = await newOrderBook.calculateVWAP(3600);
      console.log("  ✅ VWAP calculation function verified");

      const multiVWAP = await newOrderBook.getMultiWindowVWAP();
      console.log("  ✅ Multi-window VWAP function verified");

      const markPrice = await newOrderBook.calculateMarkPrice();
      console.log(
        `  ✅ Mark price calculation: $${ethers.formatUnits(markPrice, 6)}`
      );
    } catch (error) {
      console.log("  ❌ Error testing VWAP functions:", error.message);
    }

    // ============================================
    // STEP 3: UPDATE DEPLOYMENT INFO
    // ============================================
    console.log(colorText("\n📝 STEP 3: UPDATING DEPLOYMENT INFO", "cyan"));
    console.log("─".repeat(60));

    // Create new deployment info with VWAP OrderBook
    const newDeployment = {
      ...deployment,
      contracts: {
        ...deployment.contracts,
        ALUMINUM_ORDERBOOK_OLD: oldOrderBookAddress,
        ALUMINUM_ORDERBOOK_VWAP: newOrderBookAddress,
      },
      aluminumMarket: {
        ...deployment.aluminumMarket,
        orderBookOld: oldOrderBookAddress,
        orderBookVWAP: newOrderBookAddress,
        vwapEnabled: true,
      },
      vwapDeployment: {
        timestamp: new Date().toISOString(),
        orderBook: newOrderBookAddress,
        features: {
          vwapTimeWindow: Number(defaultTimeWindow),
          minVolume: ethers.formatUnits(minVolume, 18),
          useVWAPForMarkPrice: useVWAP,
        },
      },
    };

    // Save new deployment file
    const vwapDeploymentPath = path.join(
      __dirname,
      "../deployments/localhost-deployment-vwap.json"
    );
    fs.writeFileSync(
      vwapDeploymentPath,
      JSON.stringify(newDeployment, null, 2)
    );
    console.log(
      "  ✅ Created new deployment file: localhost-deployment-vwap.json"
    );

    // ============================================
    // DEPLOYMENT COMPLETE
    // ============================================
    console.log(colorText("\n✅ VWAP ORDERBOOK DEPLOYMENT COMPLETE!", "green"));
    console.log("═".repeat(80));

    console.log("\n📋 DEPLOYMENT SUMMARY:");
    console.log(`  Old OrderBook: ${oldOrderBookAddress}`);
    console.log(`  New OrderBook: ${newOrderBookAddress}`);
    console.log(`  Market ID: ${marketId}`);
    console.log(`  Vault: ${deployment.contracts.CENTRALIZED_VAULT}`);

    console.log("\n✨ VWAP FEATURES:");
    console.log("  • Time-windowed VWAP calculation (default: 1 hour)");
    console.log("  • Multi-window support (5m, 15m, 1h, 4h, 24h)");
    console.log("  • VWAP-based mark price hierarchy");
    console.log("  • Minimum volume thresholds (100 units)");
    console.log("  • Circular buffer for efficient trade history");
    console.log("  • Configurable parameters");

    console.log("\n🎯 NEXT STEPS:");
    console.log("\n1. To grant necessary roles (run as admin):");
    console.log("   ```javascript");
    console.log(
      "   const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));"
    );
    console.log(
      `   await vault.grantRole(ORDERBOOK_ROLE, '${newOrderBookAddress}');`
    );
    console.log("   ```");

    console.log("\n2. To register with vault (requires FACTORY_ROLE):");
    console.log("   ```javascript");
    console.log(`   await vault.registerOrderBook('${newOrderBookAddress}');`);
    console.log("   ```");

    console.log("\n3. To use the new OrderBook in your scripts:");
    console.log("   ```javascript");
    console.log(
      "   const OrderBook = await ethers.getContractFactory('OrderBook');"
    );
    console.log(
      `   const orderBook = OrderBook.attach('${newOrderBookAddress}');`
    );
    console.log("   ```");

    console.log("\n4. To test VWAP functionality:");
    console.log("   - Execute trades through the new OrderBook");
    console.log("   - Run: node scripts/test-vwap-mark-price.js");
    console.log("   - Monitor VWAP calculations with getVWAP()");

    console.log("\n📁 DEPLOYMENT FILES:");
    console.log("  • Original: deployments/localhost-deployment.json");
    console.log("  • With VWAP: deployments/localhost-deployment-vwap.json");

    console.log("\n⚠️  IMPORTANT NOTES:");
    console.log(
      "  • The new OrderBook is deployed but NOT yet authorized in the vault"
    );
    console.log(
      "  • To use it, you need admin access to grant roles and register it"
    );
    console.log(
      "  • For testing, you can interact with it directly without vault integration"
    );
    console.log(
      "  • Historical trades are not migrated (fresh VWAP calculation)"
    );

    console.log("═".repeat(80));

    // Create a test script that uses the new OrderBook
    await createTestScript(newOrderBookAddress, deployment);
  } catch (error) {
    console.error(colorText("\n❌ DEPLOYMENT FAILED:", "red"), error.message);
    console.error(error);
    process.exit(1);
  }
}

async function createTestScript(orderBookAddress, deployment) {
  const testScriptContent = `// test-new-vwap-orderbook.js
// Generated test script for the new VWAP OrderBook

const { ethers } = require("hardhat");

async function main() {
  console.log("\\n🧪 Testing New VWAP OrderBook");
  console.log("═".repeat(60));
  
  const [deployer, user1, user2] = await ethers.getSigners();
  
  // Connect to the new OrderBook
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach("${orderBookAddress}");
  
  // Connect to other contracts
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach("${deployment.contracts.MOCK_USDC}");
  
  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");
  const vault = CentralizedVault.attach("${deployment.contracts.CENTRALIZED_VAULT}");
  
  console.log("\\n📊 Connected to:");
  console.log(\`  OrderBook (VWAP): \${await orderBook.getAddress()}\`);
  console.log(\`  Vault: \${await vault.getAddress()}\`);
  console.log(\`  USDC: \${await usdc.getAddress()}\`);
  
  // Check VWAP configuration
  console.log("\\n⚙️  VWAP Configuration:");
  const vwapTimeWindow = await orderBook.vwapTimeWindow();
  const minVolume = await orderBook.minVolumeForVWAP();
  const useVWAP = await orderBook.useVWAPForMarkPrice();
  
  console.log(\`  Time Window: \${vwapTimeWindow} seconds\`);
  console.log(\`  Min Volume: \${ethers.formatUnits(minVolume, 18)} units\`);
  console.log(\`  Use VWAP: \${useVWAP}\`);
  
  // Get current VWAP data
  console.log("\\n📈 Current VWAP Data:");
  try {
    const vwapData = await orderBook.calculateVWAP(3600);
    console.log(\`  VWAP Price: $\${ethers.formatUnits(vwapData.vwap, 6)}\`);
    console.log(\`  Volume: \${ethers.formatUnits(vwapData.totalVolume, 18)} units\`);
    console.log(\`  Trade Count: \${vwapData.tradeCount}\`);
    console.log(\`  Is Valid: \${vwapData.isValid}\`);
  } catch (error) {
    console.log("  Error getting VWAP:", error.message);
  }
  
  // Get mark price
  const markPrice = await orderBook.calculateMarkPrice();
  console.log(\`\\n💰 Current Mark Price: $\${ethers.formatUnits(markPrice, 6)}\`);
  
  console.log("\\n✅ VWAP OrderBook is ready for testing!");
  console.log("\\nTo execute trades, ensure:");
  console.log("1. OrderBook has ORDERBOOK_ROLE in vault");
  console.log("2. OrderBook is registered with vault");
  console.log("3. Users have USDC and collateral deposited");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

  const testScriptPath = path.join(__dirname, "test-new-vwap-orderbook.js");
  fs.writeFileSync(testScriptPath, testScriptContent);
  console.log("\n📄 Created test script: scripts/test-new-vwap-orderbook.js");
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
