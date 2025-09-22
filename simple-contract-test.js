#!/usr/bin/env node

// Simple contract verification test
if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function testContracts() {
  console.log("🔍 SIMPLE CONTRACT VERIFICATION TEST");
  console.log("═".repeat(60));

  try {
    const [deployer] = await ethers.getSigners();
    console.log("✅ Deployer:", deployer.address);

    // Test 1: Basic ethers connection
    const network = await ethers.provider.getNetwork();
    console.log("✅ Network:", network.chainId.toString());

    // Test 2: Get contracts
    console.log("\n📦 LOADING CONTRACTS:");
    const coreVault = await getContract("CORE_VAULT");
    const mockUSDC = await getContract("MOCK_USDC");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    console.log("✅ CoreVault address:", await coreVault.getAddress());
    console.log("✅ MockUSDC address:", await mockUSDC.getAddress());
    console.log("✅ OrderBook address:", await orderBook.getAddress());

    // Test 3: Check bytecode exists
    console.log("\n🔍 BYTECODE VERIFICATION:");
    const coreVaultCode = await ethers.provider.getCode(
      await coreVault.getAddress()
    );
    const mockUSDCCode = await ethers.provider.getCode(
      await mockUSDC.getAddress()
    );
    const orderBookCode = await ethers.provider.getCode(
      await orderBook.getAddress()
    );

    console.log("CoreVault bytecode length:", coreVaultCode.length);
    console.log("MockUSDC bytecode length:", mockUSDCCode.length);
    console.log("OrderBook bytecode length:", orderBookCode.length);

    // Test 4: Try simple read operations
    console.log("\n📖 SIMPLE CONTRACT CALLS:");

    try {
      // Try MockUSDC (simplest contract)
      const deployerBalance = await mockUSDC.balanceOf(deployer.address);
      console.log(
        "✅ MockUSDC.balanceOf():",
        ethers.formatUnits(deployerBalance, 6),
        "USDC"
      );
    } catch (error) {
      console.log("❌ MockUSDC.balanceOf() failed:", error.message);
    }

    try {
      // Try CoreVault public variable
      const collateral = await coreVault.userCollateral(deployer.address);
      console.log(
        "✅ CoreVault.userCollateral():",
        ethers.formatUnits(collateral, 6),
        "USDC"
      );
    } catch (error) {
      console.log("❌ CoreVault.userCollateral() failed:", error.message);
    }

    try {
      // Try OrderBook simple call
      const bestBid = await orderBook.bestBid();
      console.log(
        "✅ OrderBook.bestBid():",
        ethers.formatUnits(bestBid, 6),
        "USDC"
      );
    } catch (error) {
      console.log("❌ OrderBook.bestBid() failed:", error.message);
    }

    // Test 5: Try more complex calls
    console.log("\n📊 COMPLEX CONTRACT CALLS:");

    try {
      const positions = await coreVault.getUserPositions(deployer.address);
      console.log(
        "✅ CoreVault.getUserPositions():",
        positions.length,
        "positions"
      );

      if (positions.length > 0) {
        console.log("   First position details:");
        console.log("   - Market ID:", positions[0].marketId);
        console.log("   - Size:", ethers.formatUnits(positions[0].size, 18));
        console.log(
          "   - Entry Price:",
          ethers.formatUnits(positions[0].entryPrice, 6)
        );
      }
    } catch (error) {
      console.log("❌ CoreVault.getUserPositions() failed:", error.message);
    }

    console.log("\n✅ CONTRACT VERIFICATION COMPLETE");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testContracts();
