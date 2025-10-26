#!/usr/bin/env node

// deployfinisher.js - Grants missing roles and finalizes market setup on CoreVault
//
// Purpose: Supplement an incomplete deployment by assigning required roles to
// // existing OrderBook markets and (optionally) the factory, targeting
// // HyperLiquid mainnet (or any specified network).
//
// Usage examples:
//   - With CLI args:
//       node scripts/deployfinisher.js \
//         --coreVault 0xCOREVAULT \
//         --orderbooks 0xOB1,0xOB2 \
//         --factory 0xFACTORY
//
//   - With env vars (preferred):
//       HARDHAT_NETWORK=hyperliquid \
//       CORE_VAULT_ADDRESS=0xCOREVAULT \
//       ORDERBOOK_ADDRESSES=0xOB1,0xOB2 \
//       FUTURES_MARKET_FACTORY_ADDRESS=0xFACTORY \
//       HYPERLIQUID_MAINNET_RPC_URL=https://rpc.hyperliquid.xyz \
//       PRIVATE_KEY=0x... \
//       node scripts/deployfinisher.js
//
// Notes:
// - Idempotent: checks hasRole before grantRole.
// - Avoids redeployments; uses provided addresses only.
// - Uses .env.local at repo root if present (preferred).

const path = require("path");
const fs = require("fs");

// Prefer loading env from repo root .env.local first, then .env
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

// Resolve ethers: prefer Hardhat's ethers when run via `npx hardhat run`
let ethersLib;
try {
  ethersLib = require("hardhat").ethers;
} catch (_) {
  ethersLib = require("ethers");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function getEnv(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : v;
}

async function getSignerAndProvider() {
  // If running under Hardhat, prefer its provider and first signer
  if (ethersLib.provider && ethersLib.getSigners) {
    const [signer] = await ethersLib.getSigners();
    return { provider: ethersLib.provider, signer };
  }

  // Standalone mode: construct provider and signer from env
  const rpcUrl =
    getEnv("HYPERLIQUID_MAINNET_RPC_URL") ||
    getEnv("RPC_URL") ||
    getEnv("ALCHEMY_HTTP_URL") ||
    getEnv("INFURA_HTTP_URL");

  if (!rpcUrl) {
    throw new Error(
      "RPC URL not configured. Set HYPERLIQUID_MAINNET_RPC_URL or RPC_URL."
    );
  }

  const provider = new ethersLib.JsonRpcProvider(rpcUrl);
  const pk =
    getEnv("PREFUNDED_DEPLOYER_PRIVATE_KEY") ||
    getEnv("PRIVATE_KEY_HYPERLIQUID_MAINNET") ||
    getEnv("PRIVATE_KEY");
  if (!pk) {
    throw new Error(
      "Private key not configured. Set PRIVATE_KEY (or PREFUNDED_DEPLOYER_PRIVATE_KEY)."
    );
  }
  const signer = new ethersLib.Wallet(pk, provider);
  return { provider, signer };
}

function uniqueAddresses(list) {
  const s = new Set();
  for (const a of list) {
    if (!a) continue;
    const addr = String(a).trim();
    if (!addr) continue;
    s.add(addr);
  }
  return [...s];
}

async function main() {
  const args = parseArgs(process.argv);

  // Network hint (optional). Map user alias to config name.
  const rawNetwork = getEnv("HARDHAT_NETWORK") || args.network || "hyperliquid"; // alias for mainnet
  const networkName =
    rawNetwork === "hyperliquid_mainnet" ? "hyperliquid" : rawNetwork;

  // Resolve core addresses
  const coreVaultAddress =
    args.coreVault || getEnv("CORE_VAULT_ADDRESS") || null;

  if (!coreVaultAddress) {
    throw new Error(
      "CORE_VAULT address is required. Pass --coreVault or set CORE_VAULT_ADDRESS."
    );
  }

  const factoryAddress =
    args.factory || getEnv("FUTURES_MARKET_FACTORY_ADDRESS") || null;

  // Collect OrderBook addresses from multiple sources
  let orderBooks = [];
  if (args.orderbooks)
    orderBooks = orderBooks.concat(String(args.orderbooks).split(","));
  if (getEnv("ORDERBOOK_ADDRESSES")) {
    orderBooks = orderBooks.concat(getEnv("ORDERBOOK_ADDRESSES").split(","));
  }
  if (getEnv("ALUMINUM_ORDERBOOK"))
    orderBooks.push(getEnv("ALUMINUM_ORDERBOOK"));
  if (getEnv("BTC_ORDERBOOK")) orderBooks.push(getEnv("BTC_ORDERBOOK"));

  // Fallback: attempt to read a deployment file if present
  try {
    const deploymentsDir = path.join(__dirname, "../deployments");
    const candidate = path.join(
      deploymentsDir,
      `${networkName}-deployment.json`
    );
    if (fs.existsSync(candidate)) {
      const dep = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (dep?.aluminumMarket?.orderBook) {
        orderBooks.push(dep.aluminumMarket.orderBook);
      }
      if (Array.isArray(dep?.markets)) {
        for (const m of dep.markets) {
          if (m?.orderBook) orderBooks.push(m.orderBook);
        }
      }
    }
  } catch (_) {}

  orderBooks = uniqueAddresses(orderBooks);
  if (orderBooks.length === 0) {
    throw new Error(
      "No OrderBook addresses provided. Use --orderbooks, ORDERBOOK_ADDRESSES, or deployment file."
    );
  }

  const { signer, provider } = await getSignerAndProvider();
  const chain = await provider.getNetwork();

  console.log("\n🔧 Deployment Finisher - Role Assignment");
  console.log("═".repeat(80));
  console.log(`🌐 Network: ${networkName} (chainId=${chain.chainId})`);
  console.log(`👤 Signer:  ${await signer.getAddress()}`);
  console.log(`🏛️ CoreVault: ${coreVaultAddress}`);
  if (factoryAddress) console.log(`🏭 Factory:   ${factoryAddress}`);
  console.log(
    "────────────────────────────────────────────────────────────────────────────────"
  );

  // Minimal ABI for CoreVault role ops
  const CORE_VAULT_ABI = [
    "function grantRole(bytes32,address)",
    "function hasRole(bytes32,address) view returns (bool)",
  ];

  const coreVault = new ethersLib.Contract(
    coreVaultAddress,
    CORE_VAULT_ABI,
    signer
  );

  // Compute role identifiers
  const FACTORY_ROLE = ethersLib.keccak256(
    ethersLib.toUtf8Bytes("FACTORY_ROLE")
  );
  const SETTLEMENT_ROLE = ethersLib.keccak256(
    ethersLib.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  const ORDERBOOK_ROLE = ethersLib.keccak256(
    ethersLib.toUtf8Bytes("ORDERBOOK_ROLE")
  );

  // Ensure factory roles if a factory address is provided
  if (factoryAddress) {
    console.log("\n🔒 Ensuring factory roles on CoreVault...");
    const pairs = [
      { role: FACTORY_ROLE, name: "FACTORY_ROLE" },
      { role: SETTLEMENT_ROLE, name: "SETTLEMENT_ROLE" },
    ];
    for (const p of pairs) {
      try {
        const has = await coreVault.hasRole(p.role, factoryAddress);
        if (has) {
          console.log(`  ✅ ${p.name} already granted to ${factoryAddress}`);
        } else {
          const tx = await coreVault.grantRole(p.role, factoryAddress);
          await tx.wait();
          console.log(`  ✅ Granted ${p.name} → ${factoryAddress}`);
        }
      } catch (e) {
        console.log(
          `  ⚠️  Could not ensure ${p.name} for ${factoryAddress}: ${
            e?.message || e
          }`
        );
      }
    }
  }

  // Grant market roles to each OrderBook
  console.log("\n🏷️  Ensuring market roles for OrderBooks...");
  for (const ob of orderBooks) {
    console.log(`  • OrderBook: ${ob}`);
    // ORDERBOOK_ROLE
    try {
      const hasOb = await coreVault.hasRole(ORDERBOOK_ROLE, ob);
      if (hasOb) {
        console.log("     ✅ ORDERBOOK_ROLE already assigned");
      } else {
        const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, ob);
        await tx1.wait();
        console.log("     ✅ Granted ORDERBOOK_ROLE");
      }
    } catch (e) {
      console.log(
        `     ⚠️  Failed to assign ORDERBOOK_ROLE: ${e?.message || e}`
      );
    }

    // SETTLEMENT_ROLE
    try {
      const hasSettle = await coreVault.hasRole(SETTLEMENT_ROLE, ob);
      if (hasSettle) {
        console.log("     ✅ SETTLEMENT_ROLE already assigned");
      } else {
        const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, ob);
        await tx2.wait();
        console.log("     ✅ Granted SETTLEMENT_ROLE");
      }
    } catch (e) {
      console.log(
        `     ⚠️  Failed to assign SETTLEMENT_ROLE: ${e?.message || e}`
      );
    }
  }

  console.log("\n✅ Role assignment complete.");
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ deployfinisher failed:", err?.message || err);
    process.exit(1);
  });

