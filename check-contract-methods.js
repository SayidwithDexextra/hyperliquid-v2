#!/usr/bin/env node

/**
 * Check Contract Methods
 *
 * This script checks what methods are actually available on the deployed contracts
 */

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function checkContractMethods() {
  console.log("🔍 CHECKING DEPLOYED CONTRACT METHODS");
  console.log("═".repeat(60));

  try {
    // Get contracts
    const orderBook = await getContract("ORDERBOOK");

    console.log(
      `📍 OrderBook Address: ${orderBook.target || orderBook.address}`
    );

    // Get the contract interface
    const interface = orderBook.interface;
    console.log("\n📋 Available Functions:");
    console.log("-".repeat(30));

    const functions = interface.fragments.filter(
      (fragment) => fragment.type === "function"
    );
    functions.forEach((func) => {
      console.log(
        `✅ ${func.name}(${func.inputs
          .map((input) => `${input.type} ${input.name}`)
          .join(", ")})`
      );
    });

    console.log("\n📋 Available View Functions (public variables):");
    console.log("-".repeat(30));

    // Try to call some basic methods to see what works
    const basicMethods = [
      "leverageEnabled",
      "marginRequirementBps",
      "maxLeverage",
      "marketId",
      "vault",
    ];

    for (const method of basicMethods) {
      try {
        const result = await orderBook[method]();
        console.log(`✅ ${method}(): ${result}`);
      } catch (error) {
        console.log(`❌ ${method}(): ${error.message.split("(")[0]}`);
      }
    }
  } catch (error) {
    console.error("❌ Error checking methods:", error.message);
  }
}

async function main() {
  await checkContractMethods();
}

if (require.main === module) {
  main().catch(console.error);
}
