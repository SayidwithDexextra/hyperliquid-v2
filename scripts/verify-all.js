#!/usr/bin/env node

// Batch-verify contracts on Hyperliquid using Hardhat Verify with Sourcify enabled
// - Reads addresses from deployments/hyperliquid-deployment.json
// - Verifies libraries first, then core contracts, then factory
// - Skips Diamond (OrderBook) by default due to complex constructor args; see note below

const path = require("path");
const fs = require("fs");

async function main() {
  // Load Hardhat runtime programmatically
  const hre = require("hardhat");

  // Prefer .env.local at repo root
  try {
    require("dotenv").config({
      path: path.resolve(__dirname, "../../.env.local"),
    });
  } catch {}
  try {
    require("dotenv").config();
  } catch {}

  const networkName = hre.network.name;
  if (networkName !== "hyperliquid" && networkName !== "hyperliquid_testnet") {
    console.log(`ℹ️  Running on network=${networkName}. Proceeding anyway.`);
  }

  const deploymentPath = path.resolve(
    __dirname,
    `../deployments/${networkName}-deployment.json`
  );
  const fallbackMainnet = path.resolve(
    __dirname,
    `../deployments/hyperliquid-deployment.json`
  );
  const deploymentFile = fs.existsSync(deploymentPath)
    ? deploymentPath
    : fallbackMainnet;
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const c = deployment.contracts || {};
  const deployer = deployment.deployer;

  async function verifyOne({
    address,
    contract,
    constructorArguments = [],
    libraries,
  }) {
    if (
      !address ||
      address === "0x" ||
      address === "0x0000000000000000000000000000000000000000"
    ) {
      console.log(`⚠️  Skip ${contract}: empty address`);
      return;
    }
    try {
      const opts = { address, contract, constructorArguments };
      if (libraries) opts.libraries = libraries;
      console.log(`🧾 Verifying ${contract} at ${address} ...`);
      await hre.run("verify:verify", opts);
      console.log(`✅ Verified ${contract} at ${address}`);
    } catch (err) {
      const msg = (err && (err.message || err.toString())) || "";
      if (/Already Verified|Contract source code already verified/i.test(msg)) {
        console.log(`✅ Already verified: ${contract} at ${address}`);
        return;
      }
      console.log(`❌ Failed to verify ${contract} at ${address}: ${msg}`);
    }
  }

  // Verify libraries first
  await verifyOne({
    address: c.VAULT_ANALYTICS,
    contract: "src/VaultAnalytics.sol:VaultAnalytics",
  });
  await verifyOne({
    address: c.POSITION_MANAGER,
    contract: "src/PositionManager.sol:PositionManager",
  });

  // Verify MockUSDC
  await verifyOne({
    address: c.MOCK_USDC,
    contract: "src/MockUSDC.sol:MockUSDC",
    constructorArguments: [deployer],
  });

  // Shared libraries mapping for linked contracts
  const linkedLibs =
    c.VAULT_ANALYTICS && c.POSITION_MANAGER
      ? {
          VaultAnalytics: c.VAULT_ANALYTICS,
          PositionManager: c.POSITION_MANAGER,
        }
      : undefined;

  // Verify CoreVault
  await verifyOne({
    address: c.CORE_VAULT,
    contract: "src/CoreVault.sol:CoreVault",
    constructorArguments: [c.MOCK_USDC, deployer],
    libraries: linkedLibs,
  });

  // Verify LiquidationManager
  await verifyOne({
    address: c.LIQUIDATION_MANAGER,
    contract: "src/LiquidationManager.sol:LiquidationManager",
    constructorArguments: [c.MOCK_USDC, deployer],
    libraries: linkedLibs,
  });

  // Verify FuturesMarketFactory
  await verifyOne({
    address: c.FUTURES_MARKET_FACTORY,
    contract: "src/FuturesMarketFactory.sol:FuturesMarketFactory",
    constructorArguments: [c.CORE_VAULT, deployer, deployer],
  });

  // Optional: attempt to verify Diamond (OrderBook). Requires complex constructor args.
  // Sourcify can often verify without explicit args by matching metadata, but Etherscan-like flows require them.
  // We'll try, but ignore errors.
  if (c.ALUMINUM_ORDERBOOK) {
    await verifyOne({
      address: c.ALUMINUM_ORDERBOOK,
      contract: "src/diamond/Diamond.sol:Diamond",
      // No constructor args provided here. If this fails on your explorer, you can verify manually
      // or supply the full constructor args if available.
    });
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
