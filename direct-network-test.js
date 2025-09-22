#!/usr/bin/env node

// direct-network-test.js - Direct network connectivity test

const { ethers } = require("ethers");

async function main() {
  console.log("🔗 DIRECT NETWORK TEST");
  console.log("=".repeat(40));

  // Connect directly to localhost:8545
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

  try {
    // Test 1: Check network
    console.log("\n📡 Network Check:");
    const network = await provider.getNetwork();
    console.log(`Chain ID: ${network.chainId}`);
    console.log(`Name: ${network.name}`);

    // Test 2: Check latest block
    console.log("\n📦 Block Check:");
    const blockNumber = await provider.getBlockNumber();
    console.log(`Latest block: ${blockNumber}`);

    // Test 3: Check deployed addresses directly
    console.log("\n🔍 Contract Bytecode Check:");
    const addresses = [
      { name: "Vault", address: "0x276C216D241856199A83bf27b2286659e5b877D3" },
      {
        name: "OrderBook",
        address: "0xF8A8B047683062B5BBbbe9D104C9177d6b6cC086",
      },
      {
        name: "MockUSDC",
        address: "0xfaAddC93baf78e89DCf37bA67943E1bE8F37Bb8c",
      },
    ];

    for (const contract of addresses) {
      try {
        const code = await provider.getCode(contract.address);
        if (code === "0x") {
          console.log(
            `❌ ${contract.name}: NO BYTECODE at ${contract.address}`
          );
        } else {
          console.log(
            `✅ ${contract.name}: HAS BYTECODE (${code.length} chars) at ${contract.address}`
          );
        }
      } catch (error) {
        console.log(`❌ ${contract.name}: ERROR - ${error.message}`);
      }
    }

    // Test 4: Try to query a simple contract
    console.log("\n🧪 Contract Function Test:");

    // Load compiled contract ABI
    const vaultArtifact = require("./artifacts/src/CoreVault.sol/CoreVault.json");
    const vault = new ethers.Contract(
      "0x276C216D241856199A83bf27b2286659e5b877D3",
      vaultArtifact.abi,
      provider
    );

    try {
      const totalCollateral = await vault.totalCollateralDeposited();
      console.log(
        `✅ Total collateral: ${ethers.formatUnits(totalCollateral, 6)} USDC`
      );
    } catch (error) {
      console.log(`❌ totalCollateralDeposited failed: ${error.message}`);
    }

    // Test 5: Check market price with correct Market ID
    console.log("\n📊 Market Price Test:");
    const marketId =
      "0xc748740ee16fdf6587e21437fe753d0aa31895b44b89c8f704ac6a1aa0fcb80f";

    try {
      const markPrice = await vault.getMarkPrice(marketId);
      console.log(`✅ Mark price: $${ethers.formatUnits(markPrice, 6)}`);
    } catch (error) {
      console.log(`❌ getMarkPrice failed: ${error.message}`);
    }
  } catch (error) {
    console.error("❌ Network test failed:", error.message);
  }

  console.log("\n🏁 DIRECT TEST COMPLETED!");
  process.exit(0);
}

main().catch((error) => {
  console.error("💥 Test failed:", error);
  process.exit(1);
});
