#!/usr/bin/env node

// finalize-market.js - Finalize configuration for an existing OrderBook market
//
// Purpose: Attach to an already-created market and finish operational setup:
// - Configure trading parameters (marginBps, feeBps, treasury)
// - Optionally disable leverage
// - Grant ORDERBOOK_ROLE and SETTLEMENT_ROLE on CoreVault
// - Update deployments/{network}-deployment.json and optional config pointer
//
// Usage (recommended via env to avoid HH305):
//   HARDHAT_NETWORK=hyperliquid SYMBOL=GOLD-USD START_PRICE=1 \
//   MARGIN_BPS=10000 FEE_BPS=0 TREASURY=0xYourTreasury SWITCH_INTERACTIVE=true \
//   npx hardhat run scripts/finalize-market.js --network hyperliquid
//
// Or with CLI args (must be after -- when using hardhat run):
//   npx hardhat run scripts/finalize-market.js --network hyperliquid -- \
//     --symbol GOLD-USD --orderbook 0xOB --market-id 0xID \
//     --margin-bps 10000 --fee-bps 0 --treasury 0xYourTreasury \
//     --disable-leverage --switch-interactive
//
// Notes:
// - Idempotent: role grants check hasRole before granting
// - Resolves addresses from deployments file if present, else from config/contracts
// - Does NOT redeploy core contracts

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

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

function sanitizeSymbolForKey(symbol) {
  try {
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
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

async function main() {
  console.log("\n🛠️  FINALIZE MARKET");
  console.log("═".repeat(80));
  try {
    const [signerLog] = await ethers.getSigners();
    console.log("👤 Signer:", await signerLog.getAddress());
  } catch (_) {}

  // Inputs
  const symbol = process.env.SYMBOL || getArg("--symbol");
  const explicitOrderBook = process.env.ORDERBOOK || getArg("--orderbook");
  const explicitMarketId = process.env.MARKET_ID || getArg("--market-id");
  const marginBps = toBps(
    process.env.MARGIN_BPS ?? getArg("--margin-bps"),
    10000
  );
  const feeBps = toBps(process.env.FEE_BPS ?? getArg("--fee-bps"), 0);
  const treasury = process.env.TREASURY || getArg("--treasury");
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const switchInteractive =
    (process.env.SWITCH_INTERACTIVE ?? null) !== null
      ? String(process.env.SWITCH_INTERACTIVE) !== "false"
      : getBool("--switch-interactive", false);

  // Optional facet addresses to complete a failed factory create
  const initFacetAddr = process.env.FACET_INIT || getArg("--init-facet");
  const adminFacetAddr = process.env.FACET_ADMIN || getArg("--admin-facet");
  const pricingFacetAddr =
    process.env.FACET_PRICING || getArg("--pricing-facet");
  const placementFacetAddr =
    process.env.FACET_PLACEMENT || getArg("--placement-facet");
  const execFacetAddr = process.env.FACET_EXEC || getArg("--exec-facet");
  const liqFacetAddr = process.env.FACET_LIQ || getArg("--liq-facet");
  const viewFacetAddr = process.env.FACET_VIEW || getArg("--view-facet");
  const settlementFacetAddr =
    process.env.FACET_SETTLEMENT || getArg("--settlement-facet");

  // Market metadata for initialization
  const metricUrl =
    process.env.METRIC_URL || getArg("--metric-url") || "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || "1";
  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);
  const settlementDate = Number(
    process.env.SETTLEMENT_DATE ||
      getArg("--settlement-date") ||
      Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  );
  const dataSource =
    process.env.DATA_SOURCE || getArg("--data-source") || "User Provided";
  const tagsCsv = process.env.TAGS || getArg("--tags") || "";
  const tags = tagsCsv
    ? tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

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
  if (symbol) console.log(`🪙 Symbol: ${symbol}`);
  console.log(
    `🧮 Params: margin=${marginBps}bps, fee=${feeBps}bps, disableLeverage=${disableLeverage}`
  );
  console.log(`🔗 Metric URL: ${metricUrl}`);
  console.log(`💵 Start Price: $${startPriceStr}`);

  // Deployment file path
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );

  // Load deployments
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}
  deployment.contracts = deployment.contracts || {};
  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];

  // Resolve core contracts
  let coreVault, factory;
  try {
    const envCoreVault =
      process.env.CORE_VAULT_ADDRESS || process.env.CORE_VAULT;
    const envFactory =
      process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
      process.env.FUTURES_MARKET_FACTORY;
    const coreVaultAddr = envCoreVault || deployment?.contracts?.CORE_VAULT;
    const factoryAddr =
      envFactory || deployment?.contracts?.FUTURES_MARKET_FACTORY;
    if (coreVaultAddr)
      coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);
    if (factoryAddr)
      factory = await ethers.getContractAt("FuturesMarketFactory", factoryAddr);
    if (!coreVault || !factory) {
      const { getContract } = require("../config/contracts");
      if (!coreVault) coreVault = await getContract("CORE_VAULT");
      if (!factory) factory = await getContract("FUTURES_MARKET_FACTORY");
    }
  } catch (_) {
    const { getContract } = require("../config/contracts");
    coreVault = await getContract("CORE_VAULT");
    factory = await getContract("FUTURES_MARKET_FACTORY");
  }
  const coreVaultAddr = await coreVault.getAddress();
  const factoryAddr = await factory.getAddress();
  console.log("🔗 CoreVault:", coreVaultAddr);
  console.log("🔗 FuturesMarketFactory:", factoryAddr);

  // Resolve OrderBook + MarketId
  let orderBook = explicitOrderBook || null;
  let marketId = explicitMarketId || null;

  if (!orderBook || !marketId) {
    if (symbol) {
      const entry = deployment.markets.find((m) => m?.symbol === symbol);
      if (entry) {
        orderBook = orderBook || entry.orderBook;
        marketId = marketId || entry.marketId;
      }
    }
  }
  if (!orderBook && deployment?.defaultMarket?.orderBook)
    orderBook = deployment.defaultMarket.orderBook;
  if (!marketId && deployment?.defaultMarket?.marketId)
    marketId = deployment.defaultMarket.marketId;

  // If still missing but facet addresses are provided, build and deploy the Diamond now
  if (
    (!orderBook || !marketId) &&
    initFacetAddr &&
    adminFacetAddr &&
    pricingFacetAddr &&
    placementFacetAddr &&
    execFacetAddr &&
    liqFacetAddr &&
    viewFacetAddr &&
    settlementFacetAddr
  ) {
    console.log(
      "\n🔧 No existing market found; building Diamond from provided facets..."
    );

    function selectors(iface) {
      return iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
    }

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

    const FacetCutAction = { Add: 0 };
    const cut = [
      {
        facetAddress: adminFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBAdminFacet.interface),
      },
      {
        facetAddress: pricingFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBPricingFacet.interface),
      },
      {
        facetAddress: placementFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBOrderPlacementFacet.interface),
      },
      {
        facetAddress: execFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBTradeExecutionFacet.interface),
      },
      {
        facetAddress: liqFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBLiquidationFacet.interface),
      },
      {
        facetAddress: viewFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBViewFacet.interface),
      },
      {
        facetAddress: settlementFacetAddr,
        action: FacetCutAction.Add,
        functionSelectors: selectors(OBSettlementFacet.interface),
      },
    ];

    // Compute a marketId similar to factory (deterministic enough for a new market)
    const [signer] = await ethers.getSigners();
    const blockNumber = await ethers.provider.getBlockNumber();
    const computedId = ethers.solidityPackedKeccak256(
      ["string", "string", "address", "uint256", "uint256"],
      [
        symbol || "MARKET",
        metricUrl,
        await signer.getAddress(),
        Math.floor(Date.now() / 1000),
        blockNumber,
      ]
    );
    marketId = marketId || computedId;

    // Encode obInitialize(vault, marketId, feeRecipient)
    const initSelector = ethers
      .id("obInitialize(address,bytes32,address)")
      .slice(0, 10);
    const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32", "address"],
      [coreVaultAddr, marketId, treasury || (await signer.getAddress())]
    );
    const initData = initSelector + encodedArgs.slice(2);

    // Deploy Diamond
    console.log("\n💎 Deploying Diamond with provided facets...");
    const Diamond = await ethers.getContractFactory("Diamond");
    const diamond = await Diamond.deploy(
      await signer.getAddress(),
      cut,
      initFacetAddr,
      initData
    );
    await diamond.waitForDeployment();
    orderBook = await diamond.getAddress();
    console.log("  ✅ Diamond (OrderBook) deployed:", orderBook);

    // Ensure signer has FACTORY_ROLE to register/assign
    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    try {
      const has = await coreVault.hasRole(
        FACTORY_ROLE,
        await signer.getAddress()
      );
      if (!has) {
        console.log("  • Granting FACTORY_ROLE to signer...");
        const txF = await coreVault.grantRole(
          FACTORY_ROLE,
          await signer.getAddress()
        );
        await txF.wait();
      }
    } catch (e) {
      console.log(
        "  ⚠️ Could not ensure FACTORY_ROLE for signer:",
        extractError(e)
      );
    }

    // Register and assign market
    console.log("  • Registering OrderBook in CoreVault...");
    try {
      const txR = await coreVault.registerOrderBook(orderBook);
      await txR.wait();
      console.log("    - registered");
    } catch (e) {
      console.log(
        "    ⚠️ registerOrderBook failed (maybe already registered):",
        extractError(e)
      );
    }
    console.log("  • Assigning market to OrderBook...");
    try {
      const txA = await coreVault.assignMarketToOrderBook(marketId, orderBook);
      await txA.wait();
      console.log("    - assigned");
    } catch (e) {
      console.log(
        "    ⚠️ assignMarketToOrderBook failed (maybe already assigned):",
        extractError(e)
      );
    }

    // Attempt to set initial mark price if signer has SETTLEMENT_ROLE
    try {
      const SETTLEMENT_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("SETTLEMENT_ROLE")
      );
      const [signer2] = await ethers.getSigners();
      const hasSettle = await coreVault.hasRole(
        SETTLEMENT_ROLE,
        await signer2.getAddress()
      );
      if (!hasSettle) {
        console.log(
          "  • Granting SETTLEMENT_ROLE to signer to seed mark price..."
        );
        const txS1 = await coreVault.grantRole(
          SETTLEMENT_ROLE,
          await signer2.getAddress()
        );
        await txS1.wait();
      }
      const txP = await coreVault.updateMarkPrice(marketId, startPrice6);
      await txP.wait();
      console.log("  ✅ Initial mark price set to:", startPrice6.toString());
    } catch (e) {
      console.log("  ⚠️ Could not set initial mark price:", extractError(e));
    }
  }

  if (!orderBook || !marketId) {
    throw new Error(
      "OrderBook and MarketId are required. Provide --orderbook and --market-id, or supply facet addresses to build the Diamond."
    );
  }

  console.log("🏷️  Target Market");
  console.log("  • OrderBook:", orderBook);
  console.log("  • Market ID:", marketId);

  // OB Admin configuration
  const obAdmin = await ethers.getContractAt("OBAdminFacet", orderBook);
  console.log("\n⚙️  Configuring OB trading parameters...");
  try {
    console.log(
      `  • updateTradingParameters(marginBps=${marginBps}, feeBps=${feeBps}, treasury=${
        treasury || "<unchanged>"
      })`
    );
    if (!treasury)
      console.log("    ⚠️ No treasury provided; using current admin defaults");
    const tx = await obAdmin.updateTradingParameters(
      marginBps,
      feeBps,
      treasury || coreVaultAddr
    );
    console.log("    - sent:", tx.hash);
    await tx.wait();
    console.log("  ✅ Trading parameters updated");
  } catch (e) {
    console.log("  ⚠️ updateTradingParameters failed:", extractError(e));
  }

  if (disableLeverage) {
    console.log("  • Disabling leverage...");
    try {
      const tx = await obAdmin.disableLeverage();
      console.log("    - sent:", tx.hash);
      await tx.wait();
      console.log("  ✅ Leverage disabled");
    } catch (e) {
      console.log(
        "  ⚠️ disableLeverage failed (maybe already disabled):",
        extractError(e)
      );
    }
  }

  // Roles on CoreVault
  console.log("\n🔒 Ensuring CoreVault roles...");
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  try {
    const hasOb = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
    if (hasOb) {
      console.log("  ✅ ORDERBOOK_ROLE already granted");
    } else {
      const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
      console.log("    - grant ORDERBOOK_ROLE tx:", tx1.hash);
      await tx1.wait();
      console.log("  ✅ Granted ORDERBOOK_ROLE");
    }
  } catch (e) {
    console.log("  ⚠️ grant ORDERBOOK_ROLE failed:", extractError(e));
  }
  try {
    const hasSettle = await coreVault.hasRole(SETTLEMENT_ROLE, orderBook);
    if (hasSettle) {
      console.log("  ✅ SETTLEMENT_ROLE already granted");
    } else {
      const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
      console.log("    - grant SETTLEMENT_ROLE tx:", tx2.hash);
      await tx2.wait();
      console.log("  ✅ Granted SETTLEMENT_ROLE");
    }
  } catch (e) {
    console.log("  ⚠️ grant SETTLEMENT_ROLE failed:", extractError(e));
  }

  // Update deployments file with market entry
  console.log("\n📝 Updating deployment file...");
  deployment.network = effectiveNetworkName;
  deployment.chainId = Number(network.chainId);
  deployment.timestamp = new Date().toISOString();
  deployment.contracts = deployment.contracts || {};
  // Persist core addresses used
  deployment.contracts.CORE_VAULT = coreVaultAddr;
  deployment.contracts.FUTURES_MARKET_FACTORY = factoryAddr;

  const keyBase = sanitizeSymbolForKey(
    (symbol || "").split("-")[0] || symbol || ""
  );
  if (keyBase) {
    deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
    deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;
  }

  const marketEntry = {
    symbol: symbol || deployment.defaultMarket?.symbol || "",
    marketId,
    orderBook,
    metricUrl: deployment.metricUrl || "",
    settlementDate: deployment.settlementDate || 0,
    startPrice: deployment.startPrice || "0",
    dataSource: "Finalize Script",
    tags: [],
  };

  const existingIdx = symbol
    ? deployment.markets.findIndex((m) => m.symbol === symbol)
    : deployment.markets.findIndex((m) => m.orderBook === orderBook);
  if (existingIdx >= 0)
    deployment.markets[existingIdx] = {
      ...deployment.markets[existingIdx],
      ...marketEntry,
    };
  else deployment.markets.push(marketEntry);

  if (symbol && symbol.toUpperCase() === "ALU-USD") {
    deployment.aluminumMarket = { symbol, marketId, orderBook };
  }

  if (switchInteractive) {
    deployment.defaultMarket = {
      symbol: marketEntry.symbol,
      marketId,
      orderBook,
    };
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
        extractError(e)
      );
    }
  }

  console.log("\n✅ Finalization complete.");
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ finalize-market failed:", extractError(e));
    process.exit(1);
  });
