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
// Ensure Node-run scripts connect to the running Hardhat node (localhost)
// This avoids ABI mismatches caused by connecting to the in-process "hardhat" network
if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}
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
  // Core contracts - MODULAR V2 DEPLOYMENT
  TRADING_ROUTER: "0xB2b580ce436E6F77A5713D80887e14788Ef49c9A",
  CORE_VAULT: "0xD49a0e9A4CD5979aE36840f542D2d7f02C4817Be", // Updated from CentralizedVault
  FUTURES_MARKET_FACTORY: "0xe1Fd27F4390DcBE165f4D60DBF821e4B9Bb02dEd",

  // Market-specific contracts (populated during deployment)
  ORDERBOOK: "0xC727B4f4e16108aeA4CEc17893a0caBfB23D02ed", // BTC-USD market
  BTC_ORDERBOOK: "0x413b1AfCa96a3df5A686d8BFBF93d30688a7f7D9",
  ALUMINUM_ORDERBOOK: "0xC727B4f4e16108aeA4CEc17893a0caBfB23D02ed", // Temporary - using same as BTC

  // Mock contracts
  MOCK_USDC: "0xde2Bd2ffEA002b8E84ADeA96e5976aF664115E2c",
};

// 📋 CONTRACT NAMES - Maps to hardhat artifacts (MODULAR V2)
const CONTRACT_NAMES = {
  TRADING_ROUTER: "TradingRouter",
  CORE_VAULT: "CoreVault", // Updated from CentralizedVault
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
      "0xf60b3de3599b2b0cf207ac31b0f4a01258f1f6af6a58ca59dd49a2a9fff7e3bf",
    name: "Aluminum Futures",
    orderBook: "0xADd379DA9113b1Ae623BCB155261bce40eEfF6e9",
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

// 🔒 ROLE DEFINITIONS - For authorization management (MODULAR V2)
const ROLES = {
  // CoreVault roles (updated from CentralizedVault)
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
    ["TRADING_ROUTER", "CORE_VAULT", "FUTURES_MARKET_FACTORY"],
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
 * Verify modular contract structure is working correctly
 */
async function verifyModularStructure() {
  console.log("\n🔍 MODULAR STRUCTURE VERIFICATION:");
  console.log("═".repeat(60));

  try {
    const vault = await getContract("CORE_VAULT");
    const orderBook = await getContract("ORDERBOOK");
    const factory = await getContract("FUTURES_MARKET_FACTORY");
    const tradingRouter = await getContract("TRADING_ROUTER");

    console.log("✅ CoreVault contract loaded successfully");
    console.log("✅ OrderBook contract loaded successfully");
    console.log("✅ FuturesMarketFactory contract loaded successfully");
    console.log("✅ TradingRouter contract loaded successfully");

    // Test method availability
    const vaultMethods = [
      "getUserPositions",
      "getMarginSummary",
      "depositCollateral",
    ];
    const orderBookMethods = [
      "placeMarginLimitOrder",
      "getUserOrders",
      "calculateMarkPrice",
    ];
    const factoryMethods = [
      "getMarketDetails",
      "getAllMarkets",
      "doesMarketExist",
    ];
    const routerMethods = [
      "marketBuyWithLeverage",
      "getUserPositionBreakdowns",
    ];

    for (const method of vaultMethods) {
      if (typeof vault[method] === "function") {
        console.log(`  ✅ CoreVault.${method}() available`);
      } else {
        console.log(`  ❌ CoreVault.${method}() missing`);
      }
    }

    for (const method of orderBookMethods) {
      if (typeof orderBook[method] === "function") {
        console.log(`  ✅ OrderBook.${method}() available`);
      } else {
        console.log(`  ❌ OrderBook.${method}() missing`);
      }
    }

    for (const method of factoryMethods) {
      if (typeof factory[method] === "function") {
        console.log(`  ✅ FuturesMarketFactory.${method}() available`);
      } else {
        console.log(`  ❌ FuturesMarketFactory.${method}() missing`);
      }
    }

    for (const method of routerMethods) {
      if (typeof tradingRouter[method] === "function") {
        console.log(`  ✅ TradingRouter.${method}() available`);
      } else {
        console.log(`  ❌ TradingRouter.${method}() missing`);
      }
    }

    console.log("═".repeat(60));
    return true;
  } catch (error) {
    console.error(`❌ Error verifying modular structure: ${error.message}`);
    return false;
  }
}

/**
 * Display full configuration including markets
 */
async function displayFullConfig() {
  console.log("\n📋 FULL SYSTEM CONFIGURATION (MODULAR V2):");
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
    const vault = await getContract("CORE_VAULT");
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
  verifyModularStructure,
  checkAuthorization,

  // Constants (for backwards compatibility)
  ADDRESSES: CONTRACT_ADDRESSES,
  NAMES: CONTRACT_NAMES,
  NETWORKS: NETWORK_CONFIG,
  MARKET_INFO,
  ROLES,

  // Direct access to addresses (for scripts that need them)
  TRADING_ROUTER: () => getAddress("TRADING_ROUTER"),
  CORE_VAULT: () => getAddress("CORE_VAULT"),
  CENTRALIZED_VAULT: () => getAddress("CORE_VAULT"), // Backwards compatibility
  FUTURES_MARKET_FACTORY: () => getAddress("FUTURES_MARKET_FACTORY"),
  ORDERBOOK: () => getAddress("ORDERBOOK"),
  MOCK_USDC: () => getAddress("MOCK_USDC"),
};
