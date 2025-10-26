/**
 * Contract Addresses and Configuration
 *
 * This file maintains the addresses of deployed contracts and provides utilities
 * for interacting with the contracts in both development and production environments.
 * It is automatically updated during deployments.
 */

// Import dependencies
const path = require("path");
const fs = require("fs");

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

// Current network settings - prefer Hardhat runtime network if available
let ACTIVE_NETWORK = process.env.HARDHAT_NETWORK || "hyperliquid";
try {
  // If running under Hardhat, use the active network name (e.g., 'localhost', 'hyperliquid_testnet')
  const hre = require("hardhat");
  if (hre?.network?.name) {
    ACTIVE_NETWORK = hre.network.name;
  }
} catch (_) {
  // not running under Hardhat; keep env/default
}

// Define supported networks
const NETWORKS = {
  localhost: {
    name: "Hardhat Local",
    chainId: 31337,
    blockConfirmations: 1,
  },
  polygon: {
    name: "Polygon Mainnet",
    chainId: 137,
    blockConfirmations: 5,
  },
  mumbai: {
    name: "Mumbai Testnet",
    chainId: 80001,
    blockConfirmations: 5,
  },
  hyperliquid: {
    name: "HyperLiquid Mainnet",
    chainId: 999,
    blockConfirmations: 3,
  },
  hyperliquid_testnet: {
    name: "HyperLiquid Testnet",
    chainId: 998,
    blockConfirmations: 2,
  },
};

// Contract names to address mapping
// Will be initialized from a deployment file below
let CONTRACT_ADDRESSES = {
  MOCK_USDC: "0x6F6f570F45833E249e27022648a26F4076F48f78",
  VAULT_ANALYTICS: "0xCA8c8688914e0F7096c920146cd0Ad85cD7Ae8b9",
  POSITION_MANAGER: "0xB0f05d25e41FbC2b52013099ED9616f1206Ae21B",
  CORE_VAULT: "0x5FeaeBfB4439F3516c74939A9D04e95AFE82C4ae",
  LIQUIDATION_MANAGER: "0x976fcd02f7C4773dd89C309fBF55D5923B4c98a1",
  FUTURES_MARKET_FACTORY: "0xD42912755319665397FF090fBB63B1a31aE87Cee",
  ALUMINUM_ORDERBOOK: "0x57aD6B95508a96dfC6e17efD702360B5124f4680",
  BTC_ORDERBOOK: "0x196ACcDd41754F5d1FEA0D813A39a63792bb2751", // Using same address as ALU for now
  ORDERBOOK: "0x196ACcDd41754F5d1FEA0D813A39a63792bb2751", // Generic reference
  TRADING_ROUTER: "0x3F76468754fC1FA4a79C796C580824799281aCa0", // Using CORE_VAULT for now as fallback
};

// Contract role definitions (using hardcoded values instead of ethers.js)
const CONTRACT_ROLES = {
  ADMIN: "0x41444d494e00000000000000000000000000000000000000000000000000000000",
  VAULT_MANAGER:
    "0x5641554c545f4d414e4147455200000000000000000000000000000000000000",
  ORDER_EXECUTOR:
    "0x4f524445525f45584543555445520000000000000000000000000000000000",
  LIQUIDATOR:
    "0x4c49515549444154455200000000000000000000000000000000000000000000",
  PRICE_REPORTER:
    "0x50524943455f5245504f52544552000000000000000000000000000000000000",
};

// Define market information
const MARKET_INFO = {
  "ALU-USD": {
    name: "Aluminum",
    symbol: "ALU-USD",
    marketId:
      "0xc6348f46a4dac78005a64ff26ab0e3d114645a0d336494037e628c070eb137b4",
    orderBook: "0xFC27fc4786BE01510c3564117becD13fdB077bb3",
    active: true,
  },
  "BTC-USD": {
    name: "Bitcoin",
    symbol: "BTC-USD",
    marketId:
      "0xc6348f46a4dac78005a64ff26ab0e3d114645a0d336494037e628c070eb137b4", // Using same ID for now
    orderBook: "0xFC27fc4786BE01510c3564117becD13fdB077bb3", // Using same address for now
    active: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

// Contract ABIs are loaded dynamically from artifacts when needed

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Refreshes contract addresses from deployment files
 * @returns {Object} Updated addresses
 */
function refreshAddresses() {
  try {
    // Look for network-specific deployment file
    const deploymentPath = path.join(
      __dirname,
      "..",
      "deployments",
      `${ACTIVE_NETWORK}-deployment.json`
    );

    if (fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

      // Update addresses from deployment
      if (deployment && deployment.contracts) {
        CONTRACT_ADDRESSES = { ...CONTRACT_ADDRESSES, ...deployment.contracts };

        // Also update market info if available
        if (deployment.aluminumMarket) {
          MARKET_INFO["ALU-USD"] = {
            name: "Aluminum",
            symbol: deployment.aluminumMarket.symbol || "ALU-USD",
            marketId: deployment.aluminumMarket.marketId,
            orderBook: deployment.aluminumMarket.orderBook,
            active: true,
          };
        }

        // Merge any markets[] entries into MARKET_INFO for frontend + scripts
        if (Array.isArray(deployment.markets)) {
          for (const m of deployment.markets) {
            if (!m || !m.symbol || !m.orderBook || !m.marketId) continue;
            const key = m.symbol;
            MARKET_INFO[key] = {
              name: m.symbol.split("-")[0],
              symbol: m.symbol,
              marketId: m.marketId,
              orderBook: m.orderBook,
              active: true,
            };
            // Expose convenience contract keys like <SYMBOL>_ORDERBOOK if not already present
            const alias = m.symbol
              .toUpperCase()
              .split("-")[0]
              .replace(/[^A-Z0-9]+/g, "_");
            const obKey = `${alias}_ORDERBOOK`;
            if (!CONTRACT_ADDRESSES[obKey])
              CONTRACT_ADDRESSES[obKey] = m.orderBook;
            const idKey = `${alias}_MARKET_ID`;
            if (!CONTRACT_ADDRESSES[idKey])
              CONTRACT_ADDRESSES[idKey] = m.marketId;
          }
        }

        console.log(
          `📝 Loaded contract addresses from ${ACTIVE_NETWORK}-deployment.json`
        );
      }
    } else {
      console.warn(`⚠️ No deployment file found for network ${ACTIVE_NETWORK}`);
    }

    return CONTRACT_ADDRESSES;
  } catch (error) {
    console.error(`❌ Error refreshing addresses: ${error.message}`);
    return CONTRACT_ADDRESSES;
  }
}

/**
 * Gets the address for a specific contract
 * @param {string} contractKey - The contract key
 * @returns {string} The contract address
 */
function getAddress(contractKey) {
  return (
    CONTRACT_ADDRESSES[contractKey] ||
    "0x0000000000000000000000000000000000000000"
  );
}

/**
 * Gets contract instance
 * @param {string} contractKey - The contract key
 * @param {Object} options - Options including provider, signer
 * @returns {Promise<Contract>} Ethers contract instance
 */
async function getContract(contractKey, options = {}) {
  const address = getAddress(contractKey);
  if (!address || address === "0x0000000000000000000000000000000000000000") {
    throw new Error(`No address configured for ${contractKey}`);
  }

  // Resolve ethers (prefer Hardhat's ethers if available)
  let ethersLib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ethersLib = require("hardhat").ethers;
  } catch (_) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ethersLib = require("ethers");
  }

  // Determine runner (signer/provider)
  let runner = options.signer || options.provider;
  if (!runner && ethersLib.provider) {
    runner = ethersLib.provider; // Hardhat
  }
  if (!runner && ethersLib.JsonRpcProvider) {
    const rpcUrl =
      process.env.RPC_URL ||
      process.env.ALCHEMY_HTTP_URL ||
      process.env.INFURA_HTTP_URL;
    if (rpcUrl) {
      runner = new ethersLib.JsonRpcProvider(rpcUrl);
    }
  }

  // Minimal ABIs per contract (extend as needed). These are sufficient for address checks and basic ops.
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
  ];

  const CORE_VAULT_ABI = [
    "function depositCollateral(uint256 amount)",
    "function userCollateral(address) view returns (uint256)",
    "function getAvailableCollateral(address) view returns (uint256)",
    // Portfolio/summary views used by interactive-trader
    "function getUnifiedMarginSummary(address) view returns (uint256,uint256,uint256,uint256,int256,int256,uint256,bool)",
    "function getUserPositions(address) view returns (tuple(bytes32 marketId,int256 size,uint256 entryPrice,uint256 marginLocked,uint256 socializedLossAccrued6,uint256 haircutUnits18,uint256 liquidationPrice)[])",
    "function userSocializedLoss(address) view returns (uint256)",
    // Position/market helpers
    "function marketToOrderBook(bytes32) view returns (address)",
    "function getPositionSummary(address,bytes32) view returns (int256 size,uint256 entryPrice,uint256 marginLocked)",
    "function getPositionEquity(address,bytes32) view returns (int256 equity6,uint256 notional6,bool hasPosition)",
    "function getPositionFreeMargin(address,bytes32) view returns (uint256 freeMargin6,uint256 maintenance6,bool hasPosition)",
    "function getEffectiveMaintenanceMarginBps(address,bytes32) view returns (uint256 mmrBps,uint256 fillRatio1e18,bool hasPosition)",
    // Liquidation & risk views
    "function getLiquidationPrice(address,bytes32) view returns (uint256 liquidationPrice,bool hasPosition)",
    "function isUnderLiquidationPosition(address,bytes32) view returns (bool)",
    "function getUsersWithPositionsInMarket(bytes32) view returns (address[])",
    // Risk parameters
    "function baseMmrBps() view returns (uint256)",
    "function penaltyMmrBps() view returns (uint256)",
    // Misc
    "function getEffectiveMaintenanceDetails(address,bytes32) view returns (uint256 mmrBps,uint256 fillRatio1e18,uint256 gapRatio1e18,bool hasPosition)",
    "function getMarkPrice(bytes32) view returns (uint256)",
    "function grantRole(bytes32,address)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function setLiquidationManager(address)",
    "function setMmrParams(uint16,uint16,uint16,uint16,uint8)",
    "function updateMarkPrice(bytes32,uint256)",
  ];

  const ORDERBOOK_ABI = [
    // Common read methods used across scripts
    "function bestBid() view returns (uint256)",
    "function bestAsk() view returns (uint256)",
    "function markPrice() view returns (uint256)",
    // Placement/trading (for interactive tools)
    "function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy)",
    "function placeMarginMarketOrder(uint256 amount, bool isBuy)",
  ];

  const FACTORY_ABI = [
    "function createFuturesMarketDiamond(string,string,uint256,uint256,string,string[],address,bytes4[],address,bytes) returns (address,bytes32)",
    "function getDefaultParameters() view returns (uint16,uint16)",
    "function updateDefaultParameters(uint16,uint16)",
    "event FuturesMarketCreated(bytes32 indexed marketId, address indexed orderBook)",
  ];

  // Allow caller to override ABI
  let abi = options.abi;
  if (!abi) {
    switch (contractKey) {
      case "MOCK_USDC":
        abi = ERC20_ABI;
        break;
      case "CORE_VAULT":
        abi = CORE_VAULT_ABI;
        break;
      case "ALUMINUM_ORDERBOOK":
      case "BTC_ORDERBOOK":
      case "ORDERBOOK":
        abi = ORDERBOOK_ABI;
        break;
      case "FUTURES_MARKET_FACTORY":
        abi = FACTORY_ABI;
        break;
      default:
        // Fallback to an empty ABI which is still sufficient for .getAddress()
        abi = [];
    }
  }

  // In Hardhat, prefer getContractAt to attach to deployed address
  try {
    if (ethersLib.getContractAt) {
      // Hardhat-style API
      const contract = await ethersLib.getContractAt(
        abi,
        address,
        options.signer || undefined
      );
      return contract;
    }
  } catch (_) {
    // Ignore and fallback to generic ethers.Contract
  }

  // Generic ethers v6 contract creation
  const contract = new ethersLib.Contract(address, abi, runner);
  return contract;
}

/**
 * Gets the current network configuration
 * @returns {Object} Network config
 */
function getNetworkConfig() {
  return NETWORKS[ACTIVE_NETWORK] || NETWORKS.localhost;
}

/**
 * Validates that all critical addresses are set
 * @returns {boolean} Whether validation passed
 */
function validateAddresses() {
  const requiredContracts = [
    "MOCK_USDC",
    "CORE_VAULT",
    "FUTURES_MARKET_FACTORY",
    "ALUMINUM_ORDERBOOK",
  ];

  const missingContracts = requiredContracts.filter(
    (key) =>
      !CONTRACT_ADDRESSES[key] ||
      CONTRACT_ADDRESSES[key] === "0x0000000000000000000000000000000000000000"
  );

  if (missingContracts.length > 0) {
    console.warn(
      `⚠️ Missing required contract addresses: ${missingContracts.join(", ")}`
    );
    return false;
  }

  return true;
}

/**
 * Displays the current configuration
 */
function displayConfig() {
  console.log("\n═════════════════════════════════════════");
  console.log(
    `🌐 Network: ${ACTIVE_NETWORK} (${
      NETWORKS[ACTIVE_NETWORK]?.name || "Unknown"
    })`
  );
  console.log("═════════════════════════════════════════");
  console.log("📚 CONTRACT ADDRESSES");
  console.log("═════════════════════════════════════════");

  Object.entries(CONTRACT_ADDRESSES).forEach(([key, address]) => {
    console.log(`${key.padEnd(25)} │ ${address}`);
  });

  console.log("\n📊 MARKETS");
  console.log("═════════════════════════════════════════");

  Object.entries(MARKET_INFO).forEach(([key, info]) => {
    console.log(`${key} (${info.name})`);
    console.log(`  Market ID: ${info.marketId}`);
    console.log(`  OrderBook: ${info.orderBook}`);
    console.log(`  Status: ${info.active ? "Active" : "Inactive"}`);
    console.log("───────────────────────────────────────");
  });
}

// Initialize by loading the latest deployment if available
refreshAddresses();

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  ADDRESSES: CONTRACT_ADDRESSES,
  NAMES: {
    MOCK_USDC: "Mock USDC",
    CORE_VAULT: "Core Vault",
    FUTURES_MARKET_FACTORY: "Futures Market Factory",
    ALUMINUM_ORDERBOOK: "Aluminum OrderBook",
    BTC_ORDERBOOK: "BTC OrderBook",
    TRADING_ROUTER: "Trading Router",
    ORDERBOOK: "Generic OrderBook",
    VAULT_ANALYTICS: "Vault Analytics",
    POSITION_MANAGER: "Position Manager",
    LIQUIDATION_MANAGER: "Liquidation Manager",
  },
  NETWORKS,
  MARKET_INFO,
  ROLES: CONTRACT_ROLES,
  getContract,
  getAddress,
  getNetworkConfig,
  displayConfig,
  validateAddresses,
  refreshAddresses,
};
