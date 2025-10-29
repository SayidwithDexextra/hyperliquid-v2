#!/usr/bin/env node
"use strict";

require("dotenv").config();

const readline = require("readline");
const {
  getContract,
  MARKET_INFO,
  ROLES,
  getAddress,
} = require("../config/contracts");

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function toPrice6(valueStr) {
  const val = Number(valueStr);
  if (!isFinite(val) || val <= 0) throw new Error("Invalid price");
  return BigInt(Math.round(val * 1e6));
}

function fromPrice6(bn) {
  const n = typeof bn === "bigint" ? Number(bn) : Number(bn || 0);
  return (n / 1e6).toFixed(6);
}

async function main() {
  console.log("\n=== Minimal Mark Price Updater ===\n");

  // Ensure addresses are populated from Supabase/deployments/.env
  await getContract.refreshAddresses();

  const coreVaultAddress = getAddress("CORE_VAULT");
  if (
    !coreVaultAddress ||
    coreVaultAddress === "0x0000000000000000000000000000000000000000"
  ) {
    console.error(
      "CORE_VAULT address is not configured. Check .env or deployments."
    );
    process.exit(1);
  }

  // Build markets list
  const markets = Object.values(MARKET_INFO).filter(
    (m) => m && m.active && m.marketId
  );
  if (markets.length === 0) {
    console.error("No markets available from Supabase or deployments.");
    process.exit(1);
  }

  // Present selection
  console.log("Select a market to update:");
  markets.forEach((m, i) => {
    console.log(`${String(i + 1).padStart(2)}) ${m.symbol} - ${m.name}`);
  });
  const choice = await ask("\nEnter number (or q to quit): ");
  if (choice.toLowerCase() === "q") process.exit(0);
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= markets.length) {
    console.error("Invalid selection.");
    process.exit(1);
  }

  const market = markets[index];

  // Get signer and contract
  let ethersLib;
  try {
    ethersLib = require("hardhat").ethers;
  } catch (_) {
    ethersLib = require("ethers");
  }

  const signer = (
    await (ethersLib.getSigners ? ethersLib.getSigners() : [undefined])
  )[0];
  const vault = await getContract("CORE_VAULT", { signer });

  // Display current mark price
  let current = 0;
  try {
    current = await vault.getMarkPrice(market.marketId);
  } catch (_) {}
  console.log(
    `\nCurrent mark price for ${market.symbol}: ${fromPrice6(current)}\n`
  );

  // Optional role check
  try {
    const hasRole = await vault.hasRole(
      ROLES.PRICE_REPORTER,
      await signer.getAddress()
    );
    if (!hasRole) {
      console.warn(
        "Warning: signer does not have PRICE_REPORTER role. Transaction may revert."
      );
    }
  } catch (_) {}

  // Ask for new price
  const input = await ask(
    `Enter new mark price (${market.symbol}) in human units (e.g. 2412.35): `
  );
  let price6;
  try {
    price6 = toPrice6(input);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const confirm = await ask(
    `Confirm updateMarkPrice to ${fromPrice6(price6)}? (y/N): `
  );
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }

  // Send tx
  console.log("\nSending transaction...");
  try {
    const tx = await vault.updateMarkPrice(market.marketId, price6);
    console.log(`tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Mined in block ${receipt.blockNumber}`);
    const updated = await vault.getMarkPrice(market.marketId);
    console.log(`Updated mark price: ${fromPrice6(updated)}`);
  } catch (err) {
    console.error("Transaction failed:", err?.message || err);
    process.exit(1);
  }

  console.log("\nDone.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
