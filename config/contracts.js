// contracts.js - Centralized contract configuration
//
// 🎯 PURPOSE:
//   - Single source of truth for all contract addresses
//   - Centralized ABI exports
//   - Network-specific configurations
//   - Easy deployment management
//
// 🔄 USAGE:
//   const { getContract, ADDRESSES } = require('../config/contracts');
//   const tradingRouter = await getContract('TRADING_ROUTER');
//
// 📝 UPDATE PROCESS:
//   1. Run deployment script
//   2. Update CONTRACT_ADDRESSES below
//   3. All scripts automatically use new addresses
//
const { ethers } = require("hardhat");

// 📋 CONTRACT ADDRESSES - PRODUCTION MARGIN RELEASE DEPLOYMENT
//
// 🎯 FIXES APPLIED:
//   ✅ Fixed position netting logic for partial closes
//   ✅ Improved VWAP calculation precision
//   ✅ Fixed event emission for correct entry prices
//   ✅ Proper authorization for OrderBook -> Vault calls
//   ✅ 1:1 margin requirement by default (100% collateral)
//   ✅ Complete role-based access control
//   ✅ Production-grade margin release for partial fills
//   ✅ Cumulative tracking for margin across multiple fills
//   ✅ Correctly handles orders filled at multiple price levels
//
// 💰 TRADING BEHAVIOR:
//   • $100 position requires $100 collateral (1:1 ratio) by default
//   • Partial closes preserve original entry price
//   • VWAP calculations use improved precision
//   • All authorization issues resolved
//   • All orders use margin order functions for consistent behavior
//   • Leverage can be enabled by authorized controller if desired
//   • Spot trades transfer collateral directly between users
//   • Market orders need existing liquidity to execute
//   • Margin adjusts based on actual execution price, not limit price
//
// 🎯 MARGIN RELEASE FEATURES:
//   ✅ When limit buy order at $1.50 matches at $1.00, only $100 margin used
//   ✅ Tracks cumulative margin across multiple partial fills
//   ✅ Properly handles both full and partial fills
//   ✅ Sell orders don't adjust margin (margin based on amount, not price)
//   ✅ Exact price matches don't trigger margin adjustment
//   ✅ Gas efficient - updates happen in-place
//
const CONTRACT_ADDRESSES = {
  // Core contracts - PRODUCTION MARGIN RELEASE DEPLOYMENT
  TRADING_ROUTER: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  CENTRALIZED_VAULT: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  FUTURES_MARKET_FACTORY: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",

  // Market-specific contracts (populated during deployment)
  ORDERBOOK: "0x75537828f2ce51be7289709686A69CbFDbB714F1", // ALU-USDC-PERP market
  BTC_ORDERBOOK: "0x413b1AfCa96a3df5A686d8BFBF93d30688a7f7D9",
  ALUMINUM_ORDERBOOK: "0x75537828f2ce51be7289709686A69CbFDbB714F1", // ALU-USDC-PERP market

  // Mock contracts
  MOCK_USDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

// 📋 CONTRACT NAMES - Maps to hardhat artifacts
const CONTRACT_NAMES = {
  TRADING_ROUTER: "TradingRouter",
  CENTRALIZED_VAULT: "CentralizedVault",
  FUTURES_MARKET_FACTORY: "FuturesMarketFactory",
  ORDERBOOK: "OrderBook",
  BTC_ORDERBOOK: "OrderBook",
  ALUMINUM_ORDERBOOK: "OrderBook",
  MOCK_USDC: "MockUSDC",
};

// 📊 MARKET INFORMATION
const MARKET_INFO = {
  BTC: {
    symbol: "BTC-USD",
    marketId: ethers.keccak256(ethers.toUtf8Bytes("BTC-USD")),
    name: "Bitcoin Futures",
    orderBook: "0x413b1AfCa96a3df5A686d8BFBF93d30688a7f7D9",
    leverageEnabled: false, // 1:1 margin by default
    maxLeverage: "1x",
    marginRequirement: "100%", // 1:1 ratio
    defaultMargin: "100%", // Conservative default
    riskLevel: "LOW", // No leverage = low risk
    collateralRatio: "1:1", // $100 position = $100 collateral
    features: {
      marginRelease: true, // Margin adjusts to execution price
      cumulativeTracking: true, // Tracks margin across partial fills
      multiPriceLevel: true, // Handles fills at multiple price levels
    },
  },
  ALUMINUM: {
    symbol: "ALU-USD",
    marketId:
      "0xfe68b457e3a90fa76baaf1c579b5b85c44394aeb25d07523484d33fbf10c109e",
    name: "Aluminum Futures",
    orderBook: "0x75537828f2ce51be7289709686A69CbFDbB714F1", // Updated to match deployed address
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
  },
  // Additional markets can be created using FuturesMarketFactory
  // All new markets start with 1:1 margin by default
};

// 🌐 NETWORK CONFIGURATIONS
const NETWORK_CONFIG = {
  localhost: {
    name: "Hardhat Local",
    chainId: 31337,
    blockConfirmations: 1,
    gasLimit: 30000000,
  },
  polygon: {
    name: "Polygon Mainnet",
    chainId: 137,
    blockConfirmations: 5,
  },
  // Add more networks as needed
};

// 🔒 ROLE DEFINITIONS - For authorization management
const ROLES = {
  // CentralizedVault roles
  ORDERBOOK_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE")),
  SETTLEMENT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE")),
  FACTORY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE")),

  // Default admin role (from OpenZeppelin AccessControl)
  DEFAULT_ADMIN_ROLE:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
};

// 🔧 HELPER FUNCTIONS

/**
 * Get contract instance by name
 * @param {string} contractKey - Key from CONTRACT_ADDRESSES
 * @param {object} options - Optional parameters
 * @returns {Promise<Contract>} Contract instance
 */
async function getContract(contractKey, options = {}) {
  const address = CONTRACT_ADDRESSES[contractKey];
  const contractName = CONTRACT_NAMES[contractKey];

  if (!address) {
    throw new Error(`❌ Contract address not found for: ${contractKey}`);
  }

  if (!contractName) {
    throw new Error(`❌ Contract name not found for: ${contractKey}`);
  }

  try {
    const contract = await ethers.getContractAt(contractName, address);

    if (options.signer) {
      return contract.connect(options.signer);
    }

    return contract;
  } catch (error) {
    throw new Error(
      `❌ Failed to get contract ${contractKey}: ${error.message}`
    );
  }
}

/**
 * Get multiple contracts at once
 * @param {string[]} contractKeys - Array of contract keys
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} Object with contract instances
 */
async function getContracts(contractKeys, options = {}) {
  const contracts = {};

  for (const key of contractKeys) {
    contracts[key.toLowerCase()] = await getContract(key, options);
  }

  return contracts;
}

/**
 * Get all core trading contracts
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} Object with all core contracts
 */
async function getCoreContracts(options = {}) {
  return await getContracts(
    ["TRADING_ROUTER", "CENTRALIZED_VAULT", "FUTURES_MARKET_FACTORY"],
    options
  );
}

/**
 * Get contract address by key
 * @param {string} contractKey - Contract key
 * @returns {string} Contract address
 */
function getAddress(contractKey) {
  const address = CONTRACT_ADDRESSES[contractKey];
  if (!address) {
    throw new Error(`❌ Address not found for contract: ${contractKey}`);
  }
  return address;
}

/**
 * Update contract addresses (useful for deployment scripts)
 * @param {object} newAddresses - Object with new addresses
 */
function updateAddresses(newAddresses) {
  Object.assign(CONTRACT_ADDRESSES, newAddresses);
  console.log(
    `✅ Updated ${Object.keys(newAddresses).length} contract addresses`
  );
}

/**
 * Get current network configuration
 * @returns {object} Network config
 */
async function getNetworkConfig() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  // Find matching network config
  for (const [key, config] of Object.entries(NETWORK_CONFIG)) {
    if (config.chainId === chainId) {
      return { key, ...config };
    }
  }

  return {
    key: "unknown",
    name: "Unknown Network",
    chainId,
    blockConfirmations: 1,
  };
}

/**
 * Validate all contract addresses are set
 * @returns {boolean} True if all addresses are valid
 */
function validateAddresses() {
  const missing = [];

  for (const [key, address] of Object.entries(CONTRACT_ADDRESSES)) {
    if (!address || address === "0x0000000000000000000000000000000000000000") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing contract addresses: ${missing.join(", ")}`);
    return false;
  }

  console.log(
    `✅ All ${
      Object.keys(CONTRACT_ADDRESSES).length
    } contract addresses are valid`
  );
  return true;
}

/**
 * Display current contract configuration
 */
function displayConfig() {
  console.log("\n📋 CURRENT CONTRACT CONFIGURATION:");
  console.log("═".repeat(60));

  for (const [key, address] of Object.entries(CONTRACT_ADDRESSES)) {
    const contractName = CONTRACT_NAMES[key] || "Unknown";
    console.log(`${key.padEnd(20)} │ ${contractName.padEnd(15)} │ ${address}`);
  }

  console.log("═".repeat(60));
}

/**
 * Display full configuration including markets
 */
async function displayFullConfig() {
  console.log("\n📋 FULL SYSTEM CONFIGURATION:");
  console.log("═".repeat(80));

  console.log("\n🏢 CONTRACT ADDRESSES:");
  for (const [key, address] of Object.entries(CONTRACT_ADDRESSES)) {
    const contractName = CONTRACT_NAMES[key] || "Unknown";
    console.log(
      `  ${key.padEnd(20)} │ ${contractName.padEnd(15)} │ ${address}`
    );
  }

  console.log("\n📊 MARKET INFORMATION:");
  for (const [key, market] of Object.entries(MARKET_INFO)) {
    console.log(`  ${key}:`);
    console.log(`    Symbol: ${market.symbol}`);
    console.log(`    Market ID: ${market.marketId}`);
    console.log(`    OrderBook: ${market.orderBook}`);
    console.log(`    Margin Requirement: ${market.marginRequirement}`);
    console.log(`    Features:`);
    if (market.features) {
      for (const [feat, enabled] of Object.entries(market.features)) {
        console.log(`      - ${feat}: ${enabled ? "✅" : "❌"}`);
      }
    }
  }

  const networkConfig = await getNetworkConfig();
  console.log("\n🌐 NETWORK:");
  console.log(`  Name: ${networkConfig.name}`);
  console.log(`  Chain ID: ${networkConfig.chainId}`);

  console.log("\n🔒 ROLES:");
  for (const [key, hash] of Object.entries(ROLES)) {
    console.log(`  ${key.padEnd(20)} │ ${hash}`);
  }

  console.log("═".repeat(80));
}

/**
 * Check and display authorization status
 */
async function checkAuthorization() {
  console.log("\n🔒 AUTHORIZATION STATUS:");
  console.log("═".repeat(60));

  try {
    const vault = await getContract("CENTRALIZED_VAULT");
    const factory = await getContract("FUTURES_MARKET_FACTORY");
    const orderBook = await getContract("ORDERBOOK");

    // Check Factory -> Vault authorization
    const factoryHasRole = await vault.hasRole(
      ROLES.FACTORY_ROLE,
      await factory.getAddress()
    );
    console.log(
      `Factory has FACTORY_ROLE on Vault: ${factoryHasRole ? "✅" : "❌"}`
    );

    // Check OrderBook -> Vault authorization
    const orderBookHasRole = await vault.hasRole(
      ROLES.ORDERBOOK_ROLE,
      await orderBook.getAddress()
    );
    console.log(
      `OrderBook has ORDERBOOK_ROLE on Vault: ${orderBookHasRole ? "✅" : "❌"}`
    );

    // Check OrderBook registration
    const isRegistered = await vault.registeredOrderBooks(
      await orderBook.getAddress()
    );
    console.log(
      `OrderBook is registered in Vault: ${isRegistered ? "✅" : "❌"}`
    );

    // Check market assignment
    const marketId = MARKET_INFO.BTC.marketId;
    const assignedOrderBook = await vault.marketToOrderBook(marketId);
    const isAssigned = assignedOrderBook === (await orderBook.getAddress());
    console.log(
      `BTC market assigned to OrderBook: ${isAssigned ? "✅" : "❌"}`
    );

    console.log("═".repeat(60));
    return {
      factoryHasRole,
      orderBookHasRole,
      isRegistered,
      isAssigned,
    };
  } catch (error) {
    console.error(`❌ Error checking authorization: ${error.message}`);
    return null;
  }
}

// 📤 EXPORTS
module.exports = {
  // Main functions
  getContract,
  getContracts,
  getCoreContracts,

  // Address functions
  getAddress,
  updateAddresses,
  validateAddresses,

  // Configuration
  getNetworkConfig,
  displayConfig,
  displayFullConfig,
  checkAuthorization,

  // Constants (for backwards compatibility)
  ADDRESSES: CONTRACT_ADDRESSES,
  NAMES: CONTRACT_NAMES,
  NETWORKS: NETWORK_CONFIG,
  MARKET_INFO,
  ROLES,

  // Direct access to addresses (for scripts that need them)
  TRADING_ROUTER: () => getAddress("TRADING_ROUTER"),
  CENTRALIZED_VAULT: () => getAddress("CENTRALIZED_VAULT"),
  FUTURES_MARKET_FACTORY: () => getAddress("FUTURES_MARKET_FACTORY"),
  ORDERBOOK: () => getAddress("ORDERBOOK"),
  MOCK_USDC: () => getAddress("MOCK_USDC"),
};
