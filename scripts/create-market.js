#!/usr/bin/env node

// create-market.js - Create a new Diamond-based market using the existing factory
//
// IMPORTANT: When using Hardhat CLI, pass script args after a "--" separator.
// If your shell is in Dexetrav5/:
//   npx hardhat run scripts/create-market.js --network localhost -- \
//     --symbol Gold-USD \
//     --metric-url "https://example.com/alu" \
//     --start-price 1 \
//     --data-source "Example Source" \
//     --tags "COMMODITIES,METALS" \
//     --margin-bps 10000 \
//     --fee-bps 0 \
//     --treasury 0xYourTreasury
// From repo root:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network localhost -- \
//     --symbol Gold-USD
//
// HyperLiquid Mainnet example:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network hyperliquid -- \
//     --symbol ALU-USD --start-price 1
//
// HyperLiquid Testnet example:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/create-market.js --network hyperliquid_testnet -- \
//     --symbol ALU-USD --start-price 1
//
// Alternatively, you can use environment variables (recommended to avoid HH305):
//   SYMBOL=Gold-USD START_PRICE=1 METRIC_URL=https://example.com \
//   npx hardhat run scripts/create-market.js --network localhost
//
// Notes:
// - Reuses the already deployed CoreVault and FuturesMarketFactory
// - Deploys fresh facet contracts for the new Diamond OrderBook
// - Grants ORDERBOOK_ROLE and SETTLEMENT_ROLE to the new OrderBook on CoreVault
// - Updates deployments/{network}-deployment.json by appending to markets[]
// - Updates Dexetrav5/config/contracts.js ORDERBOOK pointer to the new OB (optional)

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Lightweight CLI arg parser
function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function getBool(flag, fallback = false) {
  const has = process.argv.includes(flag);
  return has ? true : fallback;
}

function toBps(input, defaultValue) {
  if (input === undefined || input === null) return defaultValue;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function sanitizeSymbolForKey(symbol) {
  try {
    // Use uppercased symbol sans non-alphanumerics for contract key helpers
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

async function main() {
  console.log("\n🚀 CREATE MARKET (Diamond)");
  console.log("═".repeat(80));

  const symbol = process.env.SYMBOL || getArg("--symbol") || getArg("-s");
  if (!symbol) throw new Error("--symbol is required, e.g. --symbol ALU-USD");
  const metricUrl =
    process.env.METRIC_URL ||
    getArg("--metric-url") ||
    getArg("-u") ||
    "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || getArg("-p") || "1"; // dollars
  const dataSource =
    process.env.DATA_SOURCE ||
    getArg("--data-source") ||
    getArg("-d") ||
    "User Provided";
  const tagsCsv = process.env.TAGS || getArg("--tags") || "";
  const tags = tagsCsv
    ? tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const marginBps = toBps(
    process.env.MARGIN_BPS ?? getArg("--margin-bps"),
    10000
  ); // default 100% margin
  const feeBps = toBps(process.env.FEE_BPS ?? getArg("--fee-bps"), 0); // default 0 bps
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const switchInteractive =
    (process.env.SWITCH_INTERACTIVE ?? null) !== null
      ? String(process.env.SWITCH_INTERACTIVE) !== "false"
      : getBool("--switch-interactive", true); // update ORDERBOOK pointer

  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);

  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  // Normalize common aliases and fall back to chainId mapping
  const normalizedName = (() => {
    const n = String(rawNetworkName || "").toLowerCase();
    if (
      n === "hyperliquid_mainnet" ||
      n === "hyperliquid-mainnet" ||
      n === "hl" ||
      n === "hl_mainnet" ||
      n === "hl-mainnet"
    )
      return "hyperliquid";
    if (n === "hyperliquid-testnet" || n === "hl_testnet" || n === "hl-testnet")
      return "hyperliquid_testnet";
    return n;
  })();
  let effectiveNetworkName = normalizedName;
  if (
    (effectiveNetworkName === "hardhat" ||
      effectiveNetworkName === "unknown") &&
    Number(network.chainId) === 31337
  ) {
    effectiveNetworkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    effectiveNetworkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    effectiveNetworkName = "hyperliquid_testnet";
  }
  console.log(
    `🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`
  );
  console.log(`🪙 Symbol: ${symbol}`);
  console.log(`🔗 Metric URL: ${metricUrl}`);
  console.log(`💵 Start Price: $${startPriceStr}`);
  console.log(`🧮 Params: margin=${marginBps}bps, fee=${feeBps}bps`);
  if (tags.length) console.log(`🏷️ Tags: ${tags.join(", ")}`);

  // Resolve deployment path for the active network (map hardhat→localhost, chain→hyperliquid[_testnet])
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  // Treasury defaults to deployer unless overridden
  const treasury =
    process.env.TREASURY || getArg("--treasury") || deployer.address;
  console.log("🏦 Treasury:", treasury);

  // Resolve core contracts (prefer deployment file addresses on localhost)
  let coreVault, factory;
  try {
    let deploymentData = {};
    if (fs.existsSync(deploymentPath)) {
      deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
    const coreVaultAddr = deploymentData?.contracts?.CORE_VAULT;
    const factoryAddr = deploymentData?.contracts?.FUTURES_MARKET_FACTORY;

    if (coreVaultAddr && factoryAddr) {
      coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);
      factory = await ethers.getContractAt("FuturesMarketFactory", factoryAddr);
    } else {
      const { getContract } = require("../config/contracts");
      coreVault = await getContract("CORE_VAULT");
      factory = await getContract("FUTURES_MARKET_FACTORY");
    }
  } catch (_) {
    const { getContract } = require("../config/contracts");
    coreVault = await getContract("CORE_VAULT");
    factory = await getContract("FUTURES_MARKET_FACTORY");
  }

  // Deploy facets for the Diamond OrderBook
  console.log("\n🔧 Deploying OrderBook facets...");
  const OrderBookInitFacet = await ethers.getContractFactory(
    "OrderBookInitFacet"
  );
  const OBAdminFacet = await ethers.getContractFactory("OBAdminFacet");
  const OBPricingFacet = await ethers.getContractFactory("OBPricingFacet");
  const OBOrderPlacementFacet = await ethers.getContractFactory(
    "OBOrderPlacementFacet"
  );
  const OBTradeExecutionFacet = await ethers.getContractFactory(
    "OBTradeExecutionFacet"
  );
  const OBLiquidationFacet = await ethers.getContractFactory(
    "OBLiquidationFacet"
  );
  const OBViewFacet = await ethers.getContractFactory("OBViewFacet");
  const OBSettlementFacet = await ethers.getContractFactory(
    "OBSettlementFacet"
  );

  const initFacet = await OrderBookInitFacet.deploy();
  await initFacet.waitForDeployment();
  const adminFacet = await OBAdminFacet.deploy();
  await adminFacet.waitForDeployment();
  const pricingFacet = await OBPricingFacet.deploy();
  await pricingFacet.waitForDeployment();
  const placementFacet = await OBOrderPlacementFacet.deploy();
  await placementFacet.waitForDeployment();
  const execFacet = await OBTradeExecutionFacet.deploy();
  await execFacet.waitForDeployment();
  const liqFacet = await OBLiquidationFacet.deploy();
  await liqFacet.waitForDeployment();
  const viewFacet = await OBViewFacet.deploy();
  await viewFacet.waitForDeployment();
  const settlementFacet = await OBSettlementFacet.deploy();
  await settlementFacet.waitForDeployment();

  function selectors(iface) {
    return iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  }

  const FacetCutAction = { Add: 0 };
  const cut = [
    {
      facetAddress: await adminFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(adminFacet.interface),
    },
    {
      facetAddress: await pricingFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(pricingFacet.interface),
    },
    {
      facetAddress: await placementFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(placementFacet.interface),
    },
    {
      facetAddress: await execFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(execFacet.interface),
    },
    {
      facetAddress: await liqFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(liqFacet.interface),
    },
    {
      facetAddress: await viewFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(viewFacet.interface),
    },
    {
      facetAddress: await settlementFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors(settlementFacet.interface),
    },
  ];

  console.log("\n🏭 Creating market via FuturesMarketFactory...");
  const createTx = await factory.createFuturesMarketDiamond(
    symbol,
    metricUrl,
    Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // settlement +1y
    startPrice6,
    dataSource,
    tags,
    deployer.address,
    cut,
    await initFacet.getAddress(),
    "0x"
  );
  const receipt = await createTx.wait();
  console.log("  ✅ Market created");

  let orderBook, marketId;
  // Parse event FuturesMarketCreated(orderBook, marketId, ...)
  for (const log of receipt.logs) {
    try {
      const parsed = factory.interface.parseLog(log);
      if (parsed.name === "FuturesMarketCreated") {
        orderBook = parsed.args.orderBook;
        marketId = parsed.args.marketId;
        break;
      }
    } catch (_) {}
  }
  if (!orderBook || !marketId)
    throw new Error("Failed to parse FuturesMarketCreated event");
  console.log("  • OrderBook:", orderBook);
  console.log("  • Market ID:", marketId);

  // Configure OB and grant roles
  console.log("\n🔒 Configuring roles and trading params...");
  const obAdmin = await ethers.getContractAt("OBAdminFacet", orderBook);
  try {
    await obAdmin.updateTradingParameters(marginBps, feeBps, treasury);
    console.log("  ✅ Trading params updated");
  } catch (e) {
    console.log("  ⚠️ Could not set trading params:", e?.message || e);
  }
  if (disableLeverage) {
    try {
      await obAdmin.disableLeverage();
      console.log("  ✅ Leverage disabled");
    } catch (e) {
      console.log("  ⚠️ Could not disable leverage (maybe already disabled)");
    }
  }

  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
  await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
  console.log("  ✅ Roles granted on CoreVault");

  // Persist to deployments JSON
  console.log("\n📝 Updating deployment file...");
  // deploymentPath already set based on effectiveNetworkName
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}

  deployment.network = effectiveNetworkName;
  deployment.chainId = Number(network.chainId);
  deployment.timestamp = new Date().toISOString();
  deployment.contracts = deployment.contracts || {};

  const keyBase = sanitizeSymbolForKey(symbol.split("-")[0] || symbol);
  // Add convenience contract keys
  deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
  deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;

  // Maintain backward-compatible ALUMINUM keys for ALU-USD
  if (symbol.toUpperCase() === "ALU-USD") {
    deployment.contracts["ALUMINUM_ORDERBOOK"] = orderBook;
    deployment.contracts["ALUMINUM_MARKET_ID"] = marketId;
  }

  // Append to markets[] and also keep aluminumMarket for backward compat
  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];
  // If this is the first time adding to markets[], migrate legacy aluminumMarket into markets[]
  if (
    deployment.aluminumMarket &&
    !deployment.markets.find(
      (m) => m && m.symbol === (deployment.aluminumMarket.symbol || "ALU-USD")
    )
  ) {
    deployment.markets.push({
      symbol: deployment.aluminumMarket.symbol || "ALU-USD",
      marketId: deployment.aluminumMarket.marketId,
      orderBook: deployment.aluminumMarket.orderBook,
      metricUrl: deployment.metricUrl || "",
      settlementDate: deployment.settlementDate || 0,
      startPrice: deployment.startPrice || "0",
      dataSource: "Legacy",
      tags: [],
    });
  }
  const marketEntry = {
    symbol,
    marketId,
    orderBook,
    metricUrl,
    settlementDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    startPrice: startPrice6.toString(),
    dataSource,
    tags,
  };
  // Upsert by symbol
  const existingIdx = deployment.markets.findIndex((m) => m.symbol === symbol);
  if (existingIdx >= 0) deployment.markets[existingIdx] = marketEntry;
  else deployment.markets.push(marketEntry);

  if (symbol.toUpperCase() === "ALU-USD") {
    deployment.aluminumMarket = { symbol, marketId, orderBook };
  }

  // If requested, make this new market the default for interactive tools
  if (switchInteractive) {
    deployment.defaultMarket = { symbol, marketId, orderBook };
    // Also expose generic pointers for convenience
    deployment.contracts.ORDERBOOK = orderBook;
    deployment.contracts.MARKET_ID = marketId;
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(
    "  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );

  // Optionally point generic ORDERBOOK in contracts.js to this new market for interactive trader
  if (switchInteractive) {
    try {
      const configPath = path.join(__dirname, "../config/contracts.js");
      let content = fs.readFileSync(configPath, "utf8");
      // Update ORDERBOOK generic pointer
      if (/ORDERBOOK:\s*"0x[a-fA-F0-9]+"/.test(content)) {
        content = content.replace(
          /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/g,
          `ORDERBOOK: "${orderBook}"`
        );
      } else {
        // Add ORDERBOOK if missing under addresses block
        content = content.replace(
          /CONTRACT_ADDRESSES\s*=\s*\{([\s\S]*?)\n\s*\};/m,
          (m, inner) =>
            `CONTRACT_ADDRESSES = {${inner}\n  ORDERBOOK: "${orderBook}",\n};`
        );
      }
      fs.writeFileSync(configPath, content);
      console.log("  ✅ Updated config/contracts.js ORDERBOOK →", orderBook);
    } catch (e) {
      console.log(
        "  ⚠️ Could not update config/contracts.js ORDERBOOK:",
        e?.message || e
      );
    }
  }

  console.log("\n✅ Market ready!");
  console.log("═".repeat(80));
  console.log(`🎯 ${symbol} → ${orderBook}`);
  console.log(
    `💡 To trade: npx hardhat run scripts/interactive-trader.js --network ${effectiveNetworkName}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
