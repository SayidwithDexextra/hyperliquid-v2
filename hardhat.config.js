require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config(); // Load main .env file
// require("dotenv").config({ path: ".env.polygon" }); // Load specific network configs if needed

const config = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1, // Optimize purely for deployment size
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf",
          },
          peephole: true,
          inliner: true,
          jumpdestRemover: true,
          orderLiterals: true,
          deduplicate: true,
          cse: true,
          constantOptimizer: true,
        },
      },
      viaIR: true, // Enable Intermediate Representation for better optimization
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: true,
      blockGasLimit: 30000000,
      gas: 30000000,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      allowUnlimitedContractSize: true,
      blockGasLimit: 30000000,
      gas: 30000000,
    },
    ganache: {
      url: "http://127.0.0.1:7545",
      chainId: 1337,
      gas: 12000000, // Increase gas limit
      gasPrice: 20000000000, // 20 gwei
      allowUnlimitedContractSize: true, // Allow large contracts
    },
    // Polygon networks
    polygon: {
      url:
        process.env.POLYGON_RPC_URL ||
        `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      gasPrice: "auto",
      gas: "auto",
      chainId: 137,
    },
    mumbai: {
      url:
        process.env.MUMBAI_RPC_URL ||
        `https://polygon-mumbai.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      gasPrice: "auto",
      gas: "auto",
      chainId: 80001,
    },
    // HyperLiquid Network Configuration
    hyperliquid: {
      url: process.env.HYPERLIQUID_RPC_URL || "https://rpc.hyperliquid.xyz",
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 999, // HyperLiquid chain ID (corrected from RPC response)
      gasPrice: "auto",
      gas: "auto",
      timeout: 60000,
      allowUnlimitedContractSize: true,
    },
    // HyperLiquid Testnet (if available)
    hyperliquid_testnet: {
      url:
        process.env.HYPERLIQUID_TESTNET_RPC_URL ||
        "https://testnet-rpc.hyperliquid.xyz",
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 998, // HyperLiquid Testnet chain ID (placeholder - verify with docs)
      gasPrice: "auto",
      gas: "auto",
      timeout: 60000,
      allowUnlimitedContractSize: true,
    },
    // Example: Add more blockchains
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 42161,
      gasPrice: "auto",
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      accounts:
        [
          process.env.PRIVATE_KEY_DEPLOYER,
          process.env.PRIVATE_KEY_USER1,
          process.env.PRIVATE_KEY_USER2,
          process.env.PRIVATE_KEY_USER3,
        ].filter(Boolean).length > 0
          ? [
              process.env.PRIVATE_KEY_DEPLOYER,
              process.env.PRIVATE_KEY_USER1,
              process.env.PRIVATE_KEY_USER2,
              process.env.PRIVATE_KEY_USER3,
            ].filter(Boolean)
          : process.env.PRIVATE_KEY
          ? [process.env.PRIVATE_KEY]
          : [],
      chainId: 10,
      gasPrice: "auto",
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

module.exports = config;
