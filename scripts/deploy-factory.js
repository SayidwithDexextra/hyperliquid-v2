#!/usr/bin/env node

// deploy-factory.js - Dedicated script to deploy FuturesMarketFactory
//
// 🎯 THIS SCRIPT DEPLOYS ONLY THE FUTURES MARKET FACTORY CONTRACT.
//   It assumes that the CoreVault and other necessary contracts are already
//   deployed on the target network.
//
// 🚀 USAGE:
//   npx hardhat run scripts/deploy-factory.js --network hyperliquid_testnet
//

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { getAddress } = require("../config/contracts.js");

async function main() {
  console.log("\n🚀 HYPERLIQUID V2 - FUTURES MARKET FACTORY DEPLOYMENT");
  console.log("═".repeat(80));

  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);

  if (networkName !== "hyperliquid_testnet") {
    console.warn(
      `⚠️  WARNING: This script is intended for 'hyperliquid_testnet', but you are running on '${networkName}'.`
    );
  }

  // Get deployer and validate balance
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "❌ No deployer account found. Check your Hardhat configuration and .env file."
    );
  }
  console.log("📋 Deployer:", deployer.address);

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
    // STEP 1: GET CORE VAULT ADDRESS
    // ============================================
    console.log("\n📦 STEP 1: FETCHING CORE VAULT ADDRESS");
    console.log("─".repeat(60));

    const coreVaultAddress = "0xa5421db4FEe5aCA638c2362f5AA7e68E80F4b35C";
    console.log("     ✅ Using hardcoded CoreVault address:", coreVaultAddress);

    // ============================================
    // STEP 2: DEPLOY FUTURES MARKET FACTORY
    // ============================================
    console.log("\n🏭 STEP 2: DEPLOYING FUTURES MARKET FACTORY");
    console.log("─".repeat(60));

    const FuturesMarketFactory = await ethers.getContractFactory(
      "FuturesMarketFactory"
    );

    // The factory needs the CoreVault address, a fee recipient, and an admin.
    // We'll use the deployer's address for the fee recipient and admin,
    // similar to the main deployment script.
    const feeRecipient = deployer.address;
    const admin = deployer.address;

    console.log("  🔧 Constructor arguments:");
    console.log(`     _coreVault: ${coreVaultAddress}`);
    console.log(`     _feeRecipient: ${feeRecipient}`);
    console.log(`     _admin: ${admin}`);

    console.log("\n  🚀 Deploying contract...");
    const factory = await FuturesMarketFactory.deploy(
      coreVaultAddress,
      feeRecipient,
      admin
    );

    console.log("     ⏳ Waiting for deployment confirmation...");
    await factory.waitForDeployment();
    contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
    console.log(
      "     ✅ FuturesMarketFactory deployed at:",
      contracts.FUTURES_MARKET_FACTORY
    );

    // ============================================
    // STEP 3: UPDATE CONFIGURATION
    // ============================================
    console.log("\n📝 STEP 3: SAVING DEPLOYMENT INFO");
    console.log("─".repeat(60));

    const deploymentInfo = {
      network: networkName,
      chainId: Number(network.chainId),
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: {
        FUTURES_MARKET_FACTORY: contracts.FUTURES_MARKET_FACTORY,
      },
      dependencies: {
        CORE_VAULT: coreVaultAddress,
      },
    };

    const deploymentPath = path.join(
      __dirname,
      `../deployments/${networkName}-factory-deployment.json`
    );
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("  ✅ Saved deployment info to:", deploymentPath);

    // ============================================
    // DEPLOYMENT COMPLETE
    // ============================================
    console.log("\n✅ FACTORY DEPLOYMENT COMPLETE!");
    console.log("═".repeat(80));
    console.log("  • Contract:", contracts.FUTURES_MARKET_FACTORY);
    console.log(`  • Network: ${networkName}`);
    console.log(
      "  • You can now use this factory to create new futures markets."
    );
    console.log("═".repeat(80));
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
