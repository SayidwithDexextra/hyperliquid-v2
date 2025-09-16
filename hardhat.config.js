require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: ".env.polygon" });

const config = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1, // Maximum optimization for deployment size
        details: {
          yul: true,
          yulDetails: {
            stackAllocation: true,
            optimizerSteps: "dhfoDgvulfnTUtnIf",
          },
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
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      gas: "auto",
      chainId: 137,
    },
    mumbai: {
      url:
        process.env.MUMBAI_RPC_URL ||
        `https://polygon-mumbai.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      gas: "auto",
      chainId: 80001,
    },
    // Add Hyper Liquid testnet/mainnet configurations as needed
    testnet: {
      url: process.env.TESTNET_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.MAINNET_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
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
