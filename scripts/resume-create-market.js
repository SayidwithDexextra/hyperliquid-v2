#!/usr/bin/env node

// resume-create-market.js - Resume a partially failed market creation
//
// Use this if create-market.js failed while deploying facets or before calling
// the factory. This script will (re)deploy any missing facets, call the
// FuturesMarketFactory to create the Diamond OrderBook, then finalize roles and
// update the deployments file. It is safe to redeploy facets; previously
// deployed, unused facet contracts can be ignored.
//
// Examples:
//   From repo root (preferred):
//     SYMBOL=GOLD-USD START_PRICE=1 \
//     npx hardhat --config Dexetrav5/hardhat.config.js \
//       run Dexetrav5/scripts/resume-create-market.js --network hyperliquid
//
//   With explicit facet reuse (optional):
//     FACET_INIT=0x... FACET_ADMIN=0x... FACET_PRICING=0x... FACET_PLACEMENT=0x... \
//     FACET_EXEC=0x... FACET_LIQ=0x... FACET_VIEW=0x... FACET_SETTLEMENT=0x... \
//     SYMBOL=GOLD-USD START_PRICE=1 \
//     npx hardhat --config Dexetrav5/hardhat.config.js \
//       run Dexetrav5/scripts/resume-create-market.js --network hyperliquid

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !String(process.argv[idx + 1]).startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function getBool(flag, fallback = false) {
  return process.argv.includes(flag) ? true : fallback;
}

function toBps(input, defaultValue) {
  if (input === undefined || input === null) return defaultValue;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function extractError(error) {
  try {
    return (
      error?.shortMessage ||
      error?.reason ||
      error?.error?.message ||
      (typeof error?.data === "string" ? error.data : undefined) ||
      error?.message ||
      String(error)
    );
  } catch (_) {
    return String(error);
  }
}

function sanitizeSymbolForKey(symbol) {
  try {
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

async function main() {
  console.log("\n🔁 RESUME CREATE MARKET");
  console.log("═".repeat(80));

  const symbol = process.env.SYMBOL || getArg("--symbol") || getArg("-s");
  if (!symbol) throw new Error("--symbol is required, e.g. --symbol ALU-USD");

  const metricUrl =
    process.env.METRIC_URL ||
    getArg("--metric-url") ||
    getArg("-u") ||
    "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || getArg("-p") || "1";
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
  );
  const feeBps = toBps(process.env.FEE_BPS ?? getArg("--fee-bps"), 0);
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const switchInteractive =
    (process.env.SWITCH_INTERACTIVE ?? null) !== null
      ? String(process.env.SWITCH_INTERACTIVE) !== "false"
      : getBool("--switch-interactive", true);

  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);

  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
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

  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  const treasury =
    process.env.TREASURY || getArg("--treasury") || deployer.address;
  console.log("🏦 Treasury:", treasury);

  // Resolve core contracts
  let coreVault, factory;
  try {
    const envCoreVault =
      process.env.CORE_VAULT_ADDRESS || process.env.CORE_VAULT;
    const envFactory =
      process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
      process.env.FUTURES_MARKET_FACTORY;
    let deploymentData = {};
    if (fs.existsSync(deploymentPath)) {
      deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
    const coreVaultAddr = envCoreVault || deploymentData?.contracts?.CORE_VAULT;
    const factoryAddr =
      envFactory || deploymentData?.contracts?.FUTURES_MARKET_FACTORY;
    if (coreVaultAddr && factoryAddr) {
      coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);
      factory = await ethers.getContractAt("FuturesMarketFactory", factoryAddr);
      console.log(
        envCoreVault
          ? "🔗 Using CoreVault from env:"
          : "🔗 Using CoreVault from deployments:",
        coreVaultAddr
      );
      console.log(
        envFactory
          ? "🔗 Using FuturesMarketFactory from env:"
          : "🔗 Using FuturesMarketFactory from deployments:",
        factoryAddr
      );
    } else {
      const { getContract } = require("../config/contracts");
      coreVault = await getContract("CORE_VAULT");
      factory = await getContract("FUTURES_MARKET_FACTORY");
      console.log(
        "🔗 Using CoreVault from config:",
        await coreVault.getAddress()
      );
      console.log(
        "🔗 Using FuturesMarketFactory from config:",
        await factory.getAddress()
      );
    }
  } catch (_) {
    const { getContract } = require("../config/contracts");
    coreVault = await getContract("CORE_VAULT");
    factory = await getContract("FUTURES_MARKET_FACTORY");
    console.log(
      "🔗 Using CoreVault from config:",
      await coreVault.getAddress()
    );
    console.log(
      "🔗 Using FuturesMarketFactory from config:",
      await factory.getAddress()
    );
  }

  // Facet inputs (re-use if provided, else deploy fresh)
  const envInit = process.env.FACET_INIT || getArg("--init-facet");
  const envAdmin = process.env.FACET_ADMIN || getArg("--admin-facet");
  const envPricing = process.env.FACET_PRICING || getArg("--pricing-facet");
  const envPlacement =
    process.env.FACET_PLACEMENT || getArg("--placement-facet");
  const envExec = process.env.FACET_EXEC || getArg("--exec-facet");
  const envLiq = process.env.FACET_LIQ || getArg("--liq-facet");
  const envView = process.env.FACET_VIEW || getArg("--view-facet");
  const envSettlement =
    process.env.FACET_SETTLEMENT || getArg("--settlement-facet");

  const needsDeploy = !(
    envInit &&
    envAdmin &&
    envPricing &&
    envPlacement &&
    envExec &&
    envLiq &&
    envView &&
    envSettlement
  );

  let initFacet,
    adminFacet,
    pricingFacet,
    placementFacet,
    execFacet,
    liqFacet,
    viewFacet,
    settlementFacet;

  console.log("\n🔧 Ensuring OrderBook facets...");
  if (needsDeploy) {
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

    console.log("  • Deploying OrderBookInitFacet...");
    initFacet = await OrderBookInitFacet.deploy();
    await initFacet.waitForDeployment();
    console.log("    - OrderBookInitFacet:", await initFacet.getAddress());

    console.log("  • Deploying OBAdminFacet...");
    adminFacet = await OBAdminFacet.deploy();
    await adminFacet.waitForDeployment();
    console.log("    - OBAdminFacet:", await adminFacet.getAddress());

    console.log("  • Deploying OBPricingFacet...");
    pricingFacet = await OBPricingFacet.deploy();
    await pricingFacet.waitForDeployment();
    console.log("    - OBPricingFacet:", await pricingFacet.getAddress());

    console.log("  • Deploying OBOrderPlacementFacet...");
    placementFacet = await OBOrderPlacementFacet.deploy();
    await placementFacet.waitForDeployment();
    console.log(
      "    - OBOrderPlacementFacet:",
      await placementFacet.getAddress()
    );

    console.log("  • Deploying OBTradeExecutionFacet...");
    execFacet = await OBTradeExecutionFacet.deploy();
    await execFacet.waitForDeployment();
    console.log("    - OBTradeExecutionFacet:", await execFacet.getAddress());

    console.log("  • Deploying OBLiquidationFacet...");
    liqFacet = await OBLiquidationFacet.deploy();
    await liqFacet.waitForDeployment();
    console.log("    - OBLiquidationFacet:", await liqFacet.getAddress());

    console.log("  • Deploying OBViewFacet...");
    viewFacet = await OBViewFacet.deploy();
    await viewFacet.waitForDeployment();
    console.log("    - OBViewFacet:", await viewFacet.getAddress());

    console.log("  • Deploying OBSettlementFacet...");
    settlementFacet = await OBSettlementFacet.deploy();
    await settlementFacet.waitForDeployment();
    console.log("    - OBSettlementFacet:", await settlementFacet.getAddress());
  } else {
    console.log("  • Reusing provided facet addresses");
  }

  function selectors(iface) {
    return iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  }

  const FacetCutAction = { Add: 0 };

  const adminAddr = envAdmin || (await adminFacet.getAddress());
  const pricingAddr = envPricing || (await pricingFacet.getAddress());
  const placementAddr = envPlacement || (await placementFacet.getAddress());
  const execAddr = envExec || (await execFacet.getAddress());
  const liqAddr = envLiq || (await liqFacet.getAddress());
  const viewAddr = envView || (await viewFacet.getAddress());
  const settleAddr = envSettlement || (await settlementFacet.getAddress());

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

  const cut = [
    {
      facetAddress: adminAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBAdminFacet.interface),
    },
    {
      facetAddress: pricingAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBPricingFacet.interface),
    },
    {
      facetAddress: placementAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBOrderPlacementFacet.interface),
    },
    {
      facetAddress: execAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBTradeExecutionFacet.interface),
    },
    {
      facetAddress: liqAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBLiquidationFacet.interface),
    },
    {
      facetAddress: viewAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBViewFacet.interface),
    },
    {
      facetAddress: settleAddr,
      action: FacetCutAction.Add,
      functionSelectors: selectors(OBSettlementFacet.interface),
    },
  ];

  const initAddr =
    envInit ||
    (await (await ethers.getContractFactory("OrderBookInitFacet"))
      .deploy()
      .then(async (c) => {
        await c.waitForDeployment();
        return await c.getAddress();
      }));

  console.log("\n🏭 Creating market via FuturesMarketFactory...");
  const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  console.log("  • Args:");
  console.log("    - symbol:", symbol);
  console.log("    - metricUrl:", metricUrl);
  console.log("    - settlementDate:", settlementTs);
  console.log("    - startPrice6:", startPrice6.toString());
  console.log("    - dataSource:", dataSource);
  console.log("    - tags:", JSON.stringify(tags));
  console.log("    - treasury:", deployer.address);
  console.log("    - initFacet:", initAddr);

  try {
    const gas = await factory.estimateGas.createFuturesMarketDiamond(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cut,
      initAddr,
      "0x"
    );
    console.log("  • Estimated gas:", gas.toString());
  } catch (e) {
    console.log("  ⚠️ Gas estimation failed:", extractError(e));
  }
  try {
    const staticRes = await factory
      .getFunction("createFuturesMarketDiamond")
      .staticCall(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        deployer.address,
        cut,
        initAddr,
        "0x"
      );
    console.log("  • Static call OK. Expected return: ", staticRes);
  } catch (e) {
    console.log("  ⚠️ Static call reverted:", extractError(e));
  }

  let receipt;
  try {
    const tx = await factory.createFuturesMarketDiamond(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cut,
      initAddr,
      "0x"
    );
    console.log("  • Tx sent:", tx.hash);
    receipt = await tx.wait();
    console.log("  ✅ Market created");
  } catch (e) {
    console.log("  ❌ createFuturesMarketDiamond failed:", extractError(e));
    throw e;
  }

  let orderBook, marketId;
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

  console.log("\n🔒 Configuring roles and trading params...");
  const obAdmin = await ethers.getContractAt("OBAdminFacet", orderBook);
  try {
    console.log(
      `  • updateTradingParameters(marginBps=${marginBps}, feeBps=${feeBps}, treasury=${treasury})`
    );
    await obAdmin.updateTradingParameters(marginBps, feeBps, treasury);
    console.log("  ✅ Trading params updated");
  } catch (e) {
    console.log("  ⚠️ Could not set trading params:", e?.message || e);
  }
  if (disableLeverage) {
    try {
      console.log("  • Disabling leverage...");
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
  console.log("  • Granting ORDERBOOK_ROLE to:", orderBook);
  await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
  console.log("  • Granting SETTLEMENT_ROLE to:", orderBook);
  await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
  console.log("  ✅ Roles granted on CoreVault");

  // Persist to deployments JSON
  console.log("\n📝 Updating deployment file...");
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
  deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
  deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;
  if (symbol.toUpperCase() === "ALU-USD") {
    deployment.contracts["ALUMINUM_ORDERBOOK"] = orderBook;
    deployment.contracts["ALUMINUM_MARKET_ID"] = marketId;
  }

  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];
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
  const existingIdx = deployment.markets.findIndex((m) => m.symbol === symbol);
  if (existingIdx >= 0) deployment.markets[existingIdx] = marketEntry;
  else deployment.markets.push(marketEntry);

  if (switchInteractive) {
    deployment.defaultMarket = { symbol, marketId, orderBook };
    deployment.contracts.ORDERBOOK = orderBook;
    deployment.contracts.MARKET_ID = marketId;
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(
    "  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );

  if (switchInteractive) {
    try {
      const configPath = path.join(__dirname, "../config/contracts.js");
      let content = fs.readFileSync(configPath, "utf8");
      if (/ORDERBOOK:\s*"0x[a-fA-F0-9]+"/.test(content)) {
        content = content.replace(
          /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/g,
          `ORDERBOOK: "${orderBook}"`
        );
      } else {
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

  console.log("\n✅ Resume complete.");
  console.log("═".repeat(80));
  console.log(`🎯 ${symbol} → ${orderBook}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ resume-create-market failed:", extractError(e));
    process.exit(1);
  });
