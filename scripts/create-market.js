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
const { createClient } = require("@supabase/supabase-js");

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
    // Use uppercased symbol sans non-alphanumerics for contract key helpers
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

// Supabase helpers
function getSupabaseClient() {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !serviceKey) return null;
    return createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (_) {
    return null;
  }
}

async function saveMarketToSupabase(params) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log("  ⚠️ Supabase env not configured. Skipping DB save.");
    return;
  }

  const {
    marketIdentifier,
    symbol,
    name,
    description,
    category,
    decimals,
    minimumOrderSize,
    requiresKyc = false,
    settlementDate,
    tradingEndDate = null,
    dataRequestWindowSeconds,
    autoSettle = true,
    oracleProvider = null,
    initialOrder,
    chainId,
    networkName,
    creatorWalletAddress,
    bannerImageUrl = null,
    iconImageUrl = null,
    supportingPhotoUrls = [],
    // deployment
    marketAddress,
    marketIdBytes32,
    transactionHash = null,
    blockNumber = null,
    gasUsed = null,
  } = params;

  // Find existing by market_identifier
  let effectiveMarketIdentifier = String(
    marketIdentifier || symbol || ""
  ).toUpperCase();
  if (!effectiveMarketIdentifier) {
    console.log("  ⚠️ No market identifier provided for Supabase.");
    return;
  }
  const { data: existing, error: findErr } = await supabase
    .from("markets")
    .select("id, network, market_identifier")
    .eq("market_identifier", effectiveMarketIdentifier)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  let marketIdUuid = existing?.id || null;
  if (
    existing &&
    existing.network &&
    networkName &&
    existing.network !== networkName
  ) {
    const suffix = String(networkName)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "_");
    const altIdentifier = `${effectiveMarketIdentifier}-${suffix}`;
    const { data: alt, error: altErr } = await supabase
      .from("markets")
      .select("id")
      .eq("market_identifier", altIdentifier)
      .limit(1)
      .maybeSingle();
    if (altErr) throw altErr;
    if (alt?.id) {
      effectiveMarketIdentifier = altIdentifier;
      marketIdUuid = alt.id;
      console.log(
        "  ℹ️ Using existing network-specific market:",
        effectiveMarketIdentifier
      );
    } else {
      effectiveMarketIdentifier = altIdentifier;
      marketIdUuid = null;
      console.log(
        "  ℹ️ Creating network-specific market:",
        effectiveMarketIdentifier
      );
    }
  }

  // Insert missing with all required fields we know
  if (!marketIdUuid) {
    const insertPayload = {
      market_identifier: effectiveMarketIdentifier,
      symbol,
      name: name || symbol,
      description: description || `OrderBook market for ${symbol}`,
      category:
        category ||
        (Array.isArray(initialOrder?.tags) && initialOrder.tags[0]) ||
        "CUSTOM",
      decimals: Number.isFinite(decimals)
        ? decimals
        : Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
      minimum_order_size: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
      tick_size: 0.01,
      requires_kyc: Boolean(requiresKyc),
      settlement_date: settlementDate
        ? new Date(settlementDate * 1000).toISOString()
        : null,
      trading_end_date: tradingEndDate,
      data_request_window_seconds: Number(
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
      ),
      auto_settle: autoSettle,
      oracle_provider: oracleProvider,
      initial_order: initialOrder || null,
      chain_id: chainId,
      network: networkName,
      creator_wallet_address: creatorWalletAddress || null,
      banner_image_url: bannerImageUrl,
      icon_image_url: iconImageUrl,
      supporting_photo_urls: supportingPhotoUrls,
      market_address: marketAddress,
      market_id_bytes32: marketIdBytes32,
      deployment_transaction_hash: transactionHash,
      deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
      deployment_gas_used: gasUsed ? Number(gasUsed) : null,
      deployed_at: new Date().toISOString(),
    };
    const { data: inserted, error: insertErr } = await supabase
      .from("markets")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    marketIdUuid = inserted.id;
    console.log("  ✅ Supabase: market created (UUID)", marketIdUuid);
    // Ensure a default ticker row exists for this market
    try {
      const { error: tickerErr } = await supabase.from("market_tickers").upsert(
        [
          {
            market_id: marketIdUuid,
            mark_price: 0,
            last_update: new Date().toISOString(),
            is_stale: true,
          },
        ],
        { onConflict: "market_id" }
      );
      if (tickerErr) {
        console.log(
          "  ⚠️ Supabase: ticker upsert failed:",
          tickerErr.message || tickerErr
        );
      } else {
        console.log("  ✅ Supabase: ticker initialized for market");
      }
    } catch (e) {
      console.log("  ⚠️ Supabase: ticker upsert threw:", e?.message || e);
    }
    return;
  }

  // Update deployment info for existing row
  const updatePayload = {
    market_address: marketAddress,
    market_id_bytes32: marketIdBytes32,
    chain_id: chainId,
    network: networkName,
    deployment_transaction_hash: transactionHash,
    deployment_block_number: blockNumber != null ? Number(blockNumber) : null,
    deployment_gas_used: gasUsed ? Number(gasUsed) : null,
    deployed_at: new Date().toISOString(),
  };
  const { error: updErr } = await supabase
    .from("markets")
    .update(updatePayload)
    .eq("id", marketIdUuid);
  if (updErr) {
    console.log("  ⚠️ Supabase update failed:", updErr.message || updErr);
    return;
  }
  console.log("  ✅ Supabase: market updated with deployment details");
  // Ensure a default ticker row exists for this market
  try {
    const { error: tickerErr } = await supabase.from("market_tickers").upsert(
      [
        {
          market_id: marketIdUuid,
          mark_price: 0,
          last_update: new Date().toISOString(),
          is_stale: true,
        },
      ],
      { onConflict: "market_id" }
    );
    if (tickerErr) {
      console.log(
        "  ⚠️ Supabase: ticker upsert failed:",
        tickerErr.message || tickerErr
      );
    } else {
      console.log("  ✅ Supabase: ticker initialized for market");
    }
  } catch (e) {
    console.log("  ⚠️ Supabase: ticker upsert threw:", e?.message || e);
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
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  // Treasury defaults to deployer unless overridden
  const treasury =
    process.env.TREASURY || getArg("--treasury") || deployer.address;
  console.log("🏦 Treasury:", treasury);

  // Resolve core contracts (prefer .env, then deployments, then config)
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

  console.log("  • Deploying OrderBookInitFacet...");
  const initFacet = await OrderBookInitFacet.deploy();
  await initFacet.waitForDeployment();
  console.log("    - OrderBookInitFacet:", await initFacet.getAddress());
  console.log("  • Deploying OBAdminFacet...");
  const adminFacet = await OBAdminFacet.deploy();
  await adminFacet.waitForDeployment();
  console.log("    - OBAdminFacet:", await adminFacet.getAddress());
  console.log("  • Deploying OBPricingFacet...");
  const pricingFacet = await OBPricingFacet.deploy();
  await pricingFacet.waitForDeployment();
  console.log("    - OBPricingFacet:", await pricingFacet.getAddress());
  console.log("  • Deploying OBOrderPlacementFacet...");
  const placementFacet = await OBOrderPlacementFacet.deploy();
  await placementFacet.waitForDeployment();
  console.log(
    "    - OBOrderPlacementFacet:",
    await placementFacet.getAddress()
  );
  console.log("  • Deploying OBTradeExecutionFacet...");
  const execFacet = await OBTradeExecutionFacet.deploy();
  await execFacet.waitForDeployment();
  console.log("    - OBTradeExecutionFacet:", await execFacet.getAddress());
  console.log("  • Deploying OBLiquidationFacet...");
  const liqFacet = await OBLiquidationFacet.deploy();
  await liqFacet.waitForDeployment();
  console.log("    - OBLiquidationFacet:", await liqFacet.getAddress());
  console.log("  • Deploying OBViewFacet...");
  const viewFacet = await OBViewFacet.deploy();
  await viewFacet.waitForDeployment();
  console.log("    - OBViewFacet:", await viewFacet.getAddress());
  console.log("  • Deploying OBSettlementFacet...");
  const settlementFacet = await OBSettlementFacet.deploy();
  await settlementFacet.waitForDeployment();
  console.log("    - OBSettlementFacet:", await settlementFacet.getAddress());

  function selectors(iface) {
    return iface.fragments
      .filter((f) => f.type === "function")
      .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
  }

  const FacetCutAction = { Add: 0 };
  console.log("\n🧩 Preparing facet cuts & selectors...");
  const adminAddr = await adminFacet.getAddress();
  const pricingAddr = await pricingFacet.getAddress();
  const placementAddr = await placementFacet.getAddress();
  const execAddr = await execFacet.getAddress();
  const liqAddr = await liqFacet.getAddress();
  const viewAddr = await viewFacet.getAddress();
  const settleAddr = await settlementFacet.getAddress();

  const adminSelectors = selectors(adminFacet.interface);
  const pricingSelectors = selectors(pricingFacet.interface);
  const placementSelectors = selectors(placementFacet.interface);
  const execSelectors = selectors(execFacet.interface);
  const liqSelectors = selectors(liqFacet.interface);
  const viewSelectors = selectors(viewFacet.interface);
  const settleSelectors = selectors(settlementFacet.interface);

  console.log("  • OBAdminFacet selectors:", adminSelectors.length);
  console.log("  • OBPricingFacet selectors:", pricingSelectors.length);
  console.log(
    "  • OBOrderPlacementFacet selectors:",
    placementSelectors.length
  );
  console.log("  • OBTradeExecutionFacet selectors:", execSelectors.length);
  console.log("  • OBLiquidationFacet selectors:", liqSelectors.length);
  console.log("  • OBViewFacet selectors:", viewSelectors.length);
  console.log("  • OBSettlementFacet selectors:", settleSelectors.length);

  const cut = [
    {
      facetAddress: adminAddr,
      action: FacetCutAction.Add,
      functionSelectors: adminSelectors,
    },
    {
      facetAddress: pricingAddr,
      action: FacetCutAction.Add,
      functionSelectors: pricingSelectors,
    },
    {
      facetAddress: placementAddr,
      action: FacetCutAction.Add,
      functionSelectors: placementSelectors,
    },
    {
      facetAddress: execAddr,
      action: FacetCutAction.Add,
      functionSelectors: execSelectors,
    },
    {
      facetAddress: liqAddr,
      action: FacetCutAction.Add,
      functionSelectors: liqSelectors,
    },
    {
      facetAddress: viewAddr,
      action: FacetCutAction.Add,
      functionSelectors: viewSelectors,
    },
    {
      facetAddress: settleAddr,
      action: FacetCutAction.Add,
      functionSelectors: settleSelectors,
    },
  ];
  console.log(
    "📦 Total selectors:",
    cut.reduce((acc, c) => acc + (c.functionSelectors?.length || 0), 0)
  );

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
  console.log("    - initFacet:", await initFacet.getAddress());

  // Preflight diagnostics
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
      await initFacet.getAddress(),
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
        await initFacet.getAddress(),
        "0x"
      );
    console.log("  • Static call OK. Expected return: ", staticRes);
  } catch (e) {
    console.log("  ⚠️ Static call reverted:", extractError(e));
  }

  let receipt;
  try {
    const createTx = await factory.createFuturesMarketDiamond(
      symbol,
      metricUrl,
      settlementTs,
      startPrice6,
      dataSource,
      tags,
      deployer.address,
      cut,
      await initFacet.getAddress(),
      "0x"
    );
    console.log("  • Tx sent:", createTx.hash);
    receipt = await createTx.wait();
    console.log("  ✅ Market created");
  } catch (e) {
    console.log("  ❌ createFuturesMarketDiamond failed:", extractError(e));
    throw e;
  }

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

  // Save to Supabase (prefill known fields)
  try {
    console.log("\n🗄️  Saving market to Supabase...");
    const initialOrder = {
      metricUrl,
      startPrice: String(ethers.formatUnits(startPrice6, 6)),
      dataSource,
      tags,
    };
    await saveMarketToSupabase({
      marketIdentifier: symbol,
      symbol,
      name: `${(symbol.split("-")[0] || symbol).toUpperCase()} Futures`,
      description: `OrderBook market for ${symbol}`,
      category: Array.isArray(tags) && tags.length ? tags[0] : "CUSTOM",
      decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
      minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
      requiresKyc: false,
      settlementDate: settlementTs,
      tradingEndDate: null,
      dataRequestWindowSeconds: Number(
        process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
      ),
      autoSettle: true,
      oracleProvider: null,
      initialOrder,
      chainId: Number(network.chainId),
      networkName: effectiveNetworkName,
      creatorWalletAddress: deployer.address,
      marketAddress: orderBook,
      marketIdBytes32: marketId,
      transactionHash: receipt?.hash || null,
      blockNumber: receipt?.blockNumber || null,
      gasUsed: receipt?.gasUsed?.toString?.() || null,
    });
  } catch (e) {
    console.log("  ⚠️ Supabase save failed:", e?.message || e);
  }

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
