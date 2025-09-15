#!/usr/bin/env node

// diagnose-contracts.js - Contract Diagnosis Script
//
// 🎯 PURPOSE:
//   Diagnose contract deployment and connection issues
//   Check if contracts are properly deployed and accessible
//
// 🚀 USAGE:
//   node scripts/diagnose-contracts.js
//   npx hardhat run scripts/diagnose-contracts.js --network localhost

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function diagnoseContracts() {
  console.log(colorText("\n🔍 CONTRACT DIAGNOSIS", colors.brightYellow));
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const signers = await ethers.getSigners();
    console.log(
      colorText(`\n👤 Available Signers: ${signers.length}`, colors.brightCyan)
    );
    signers.forEach((signer, i) => {
      console.log(colorText(`   ${i + 1}. ${signer.address}`, colors.white));
    });

    // Check network
    const network = await ethers.provider.getNetwork();
    console.log(
      colorText(
        `\n🌐 Network: ${network.name} (Chain ID: ${network.chainId})`,
        colors.brightCyan
      )
    );

    // Check contract addresses from config
    console.log(
      colorText(`\n📋 Contract Addresses from Config:`, colors.brightCyan)
    );

    const contractKeys = [
      "MOCK_USDC",
      "CENTRALIZED_VAULT",
      "FUTURES_MARKET_FACTORY",
      "TRADING_ROUTER",
      "ALUMINUM_ORDERBOOK",
    ];

    for (const key of contractKeys) {
      try {
        const address = await getContract(key)
          .then((c) => c.getAddress())
          .catch(() => "ERROR");
        console.log(colorText(`   ${key}: ${address}`, colors.white));
      } catch (error) {
        console.log(
          colorText(`   ${key}: ERROR - ${error.message}`, colors.red)
        );
      }
    }

    // Test basic contract calls
    console.log(
      colorText(`\n🧪 Testing Basic Contract Calls:`, colors.brightCyan)
    );

    // Test MockUSDC
    try {
      const mockUSDC = await getContract("MOCK_USDC");
      const name = await mockUSDC.name();
      const symbol = await mockUSDC.symbol();
      const decimals = await mockUSDC.decimals();
      console.log(
        colorText(
          `   ✅ MockUSDC: ${name} (${symbol}) - ${decimals} decimals`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ MockUSDC Error: ${error.message}`, colors.red)
      );
    }

    // Test CentralizedVault
    try {
      const vault = await getContract("CENTRALIZED_VAULT");
      const usdcAddress = await vault.usdc();
      console.log(
        colorText(
          `   ✅ CentralizedVault: USDC at ${usdcAddress}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ CentralizedVault Error: ${error.message}`, colors.red)
      );
    }

    // Test OrderBook - this is where the issue likely is
    console.log(
      colorText(`\n🔍 Testing OrderBook Contract:`, colors.brightCyan)
    );

    try {
      const orderBook = await getContract("ALUMINUM_ORDERBOOK");
      const address = await orderBook.getAddress();
      console.log(colorText(`   OrderBook Address: ${address}`, colors.white));

      // Check if contract has code
      const code = await ethers.provider.getCode(address);
      if (code === "0x") {
        console.log(
          colorText(
            `   ❌ No contract code at address - contract not deployed!`,
            colors.red
          )
        );
        return;
      } else {
        console.log(
          colorText(
            `   ✅ Contract code found (${code.length} bytes)`,
            colors.green
          )
        );
      }

      // Try to call bestBid
      try {
        const bestBid = await orderBook.bestBid();
        console.log(
          colorText(`   ✅ bestBid(): ${bestBid.toString()}`, colors.green)
        );
      } catch (error) {
        console.log(
          colorText(`   ❌ bestBid() Error: ${error.message}`, colors.red)
        );
        console.log(
          colorText(
            `   This suggests the contract ABI doesn't match the deployed contract`,
            colors.yellow
          )
        );
      }

      // Try to call bestAsk
      try {
        const bestAsk = await orderBook.bestAsk();
        console.log(
          colorText(`   ✅ bestAsk(): ${bestAsk.toString()}`, colors.green)
        );
      } catch (error) {
        console.log(
          colorText(`   ❌ bestAsk() Error: ${error.message}`, colors.red)
        );
      }

      // Try to call getMarkPrice
      try {
        const markPrice = await orderBook.getMarkPrice();
        console.log(
          colorText(
            `   ✅ getMarkPrice(): ${markPrice.toString()}`,
            colors.green
          )
        );
      } catch (error) {
        console.log(
          colorText(`   ❌ getMarkPrice() Error: ${error.message}`, colors.red)
        );
      }
    } catch (error) {
      console.log(
        colorText(
          `   ❌ OrderBook Connection Error: ${error.message}`,
          colors.red
        )
      );
    }

    // Check if we need to redeploy
    console.log(colorText(`\n🔧 RECOMMENDED ACTIONS:`, colors.brightYellow));

    try {
      const orderBook = await getContract("ALUMINUM_ORDERBOOK");
      const code = await ethers.provider.getCode(await orderBook.getAddress());

      if (code === "0x") {
        console.log(
          colorText(`   1. ❌ OrderBook contract is not deployed`, colors.red)
        );
        console.log(
          colorText(`   2. 🚀 Run: node scripts/deploy.js`, colors.yellow)
        );
        console.log(
          colorText(
            `   3. 🔄 Then try your liquidity filling scripts again`,
            colors.white
          )
        );
      } else {
        console.log(
          colorText(`   1. ✅ OrderBook contract is deployed`, colors.green)
        );
        console.log(
          colorText(
            `   2. 🔍 Check if the contract ABI matches the deployed contract`,
            colors.yellow
          )
        );
        console.log(
          colorText(
            `   3. 🔄 Try recompiling: npx hardhat compile`,
            colors.white
          )
        );
      }
    } catch (error) {
      console.log(
        colorText(`   1. ❌ Cannot connect to OrderBook contract`, colors.red)
      );
      console.log(
        colorText(`   2. 🚀 Run: node scripts/deploy.js`, colors.yellow)
      );
    }

    console.log(
      colorText(`\n📝 Additional Debugging Steps:`, colors.brightCyan)
    );
    console.log(
      colorText(
        `   • Check if Hardhat node is running: npx hardhat node`,
        colors.white
      )
    );
    console.log(
      colorText(`   • Verify network in hardhat.config.js`, colors.white)
    );
    console.log(
      colorText(
        `   • Check if contracts were deployed to the correct network`,
        colors.white
      )
    );
  } catch (error) {
    console.log(
      colorText("❌ Error during diagnosis: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the diagnosis
diagnoseContracts().catch(console.error);
