// live-orderbook-viewer.js - Live order book viewer using TradingRouter
//
// 🎯 USAGE:
//   npx hardhat run scripts/live-orderbook-viewer.js --network localhost
//
// 🔄 AUTO-REFRESH (optional):
//   Uncomment the setInterval section at the bottom for live updates every 5 seconds
//
// 📊 FEATURES:
//   ✅ Multi-market overview with real-time prices
//   ✅ Detailed order book depth visualization
//   ✅ Active orders count and market statistics
//   ✅ Trading statistics and volume data
//   ✅ Beautiful colored console output
//   ✅ Market validity and spread information
//
// 🛠️ REQUIREMENTS:
//   - Hardhat node must be running
//   - Contracts must be deployed
//   - At least one active market with orders
//
const { ethers } = require("hardhat");
const {
  getContract,
  getAddress,
  MARKET_INFO,
  displayFullConfig,
} = require("../config/contracts");

// ANSI Color Codes for beautiful output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatPrice(price, decimals = 6) {
  // Handle MaxUint256 case (used for empty order book)
  if (!price || price === 0n) return "0.00";
  if (price >= ethers.MaxUint256) return "∞";

  try {
    return Number(ethers.utils.formatUnits(price, decimals)).toFixed(2);
  } catch (error) {
    // Fallback for very large numbers
    return "∞";
  }
}

function formatAmount(amount, decimals = 18) {
  return Number(ethers.utils.formatUnits(amount, decimals)).toFixed(4);
}

async function getLiveOrderBookData() {
  console.log(
    colorText("🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥", colors.magenta)
  );
  console.log(
    colorText(
      "  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓",
      colors.cyan
    )
  );
  console.log(
    colorText(
      "  ┃   📈 HYPERLIQUID LIVE ORDER BOOK VIEWER 📈             ┃",
      colors.cyan
    )
  );
  console.log(
    colorText(
      "  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
      colors.cyan
    )
  );
  console.log(
    colorText("🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥", colors.magenta)
  );

  try {
    // Get contracts from centralized configuration
    console.log("🔧 Loading contract configuration...");
    await displayFullConfig();

    console.log("\n📡 Connecting to deployed contracts...");
    const tradingRouter = await getContract("TRADING_ROUTER");
    const factory = await getContract("FUTURES_MARKET_FACTORY");
    const vault = await getContract("CENTRALIZED_VAULT");
    const aluminumOrderBook = await getContract("ALUMINUM_ORDERBOOK");

    console.log("  ✅ TradingRouter connected:", tradingRouter.address);
    console.log("  ✅ FuturesMarketFactory connected:", factory.address);
    console.log("  ✅ CentralizedVault connected:", vault.address);
    console.log(
      "  ✅ Aluminum OrderBook connected:",
      aluminumOrderBook.address
    );

    // Get global trading statistics from TradingRouter
    try {
      const [totalTrades, totalVolume, totalFees] =
        await tradingRouter.getTradingStats();
      console.log(
        `\n${colorText("📊 GLOBAL TRADING STATISTICS:", colors.bright)}`
      );
      console.log(
        `   Total Trades: ${colorText(totalTrades.toString(), colors.green)}`
      );
      console.log(
        `   Total Volume: ${colorText(
          `$${ethers.utils.formatUnits(totalVolume, 6)}`,
          colors.green
        )}`
      );
      console.log(
        `   Total Fees: ${colorText(
          `$${ethers.utils.formatUnits(totalFees, 6)}`,
          colors.yellow
        )}`
      );
    } catch (error) {
      console.log(
        colorText("⚠️ Could not fetch global trading stats", colors.yellow)
      );
    }

    // Enhanced Market Discovery
    try {
      console.log(
        `\n${colorText("🔍 ENHANCED MARKET DISCOVERY", colors.bgGreen)}`
      );

      // Get oracle health status
      const [
        totalMarkets,
        activeMarkets,
        customOracleMarkets,
        umaRequestMarkets,
        settledMarkets,
      ] = await factory.getOracleHealthStatus();

      console.log(`${colorText("📊 Platform Statistics:", colors.bright)}`);
      console.log(
        `  Total Markets: ${colorText(totalMarkets.toString(), colors.green)}`
      );
      console.log(
        `  Active Markets: ${colorText(activeMarkets.toString(), colors.cyan)}`
      );
      console.log(
        `  Custom Oracle Markets: ${colorText(
          customOracleMarkets.toString(),
          colors.yellow
        )}`
      );
      console.log(
        `  UMA Request Markets: ${colorText(
          umaRequestMarkets.toString(),
          colors.magenta
        )}`
      );
      console.log(
        `  Settled Markets: ${colorText(
          settledMarkets.toString(),
          colors.white
        )}`
      );

      // Get markets by data source
      try {
        const lmeMarkets = await factory.getMarketsByDataSource("LME");
        const nasdaqMarkets = await factory.getMarketsByDataSource("NASDAQ");
        const customMarkets = await factory.getMarketsByDataSource("CUSTOM");

        console.log(
          `\n${colorText("📈 Markets by Data Source:", colors.bright)}`
        );
        console.log(
          `  LME Markets: ${colorText(
            lmeMarkets.length.toString(),
            colors.green
          )}`
        );
        console.log(
          `  NASDAQ Markets: ${colorText(
            nasdaqMarkets.length.toString(),
            colors.blue
          )}`
        );
        console.log(
          `  Custom Markets: ${colorText(
            customMarkets.length.toString(),
            colors.yellow
          )}`
        );
      } catch (error) {
        console.log(
          colorText("⚠️ Could not fetch markets by data source", colors.yellow)
        );
      }

      // Get markets by tags
      try {
        const commodityMarkets = await factory.getMarketsByTag("COMMODITIES");
        const metalMarkets = await factory.getMarketsByTag("METALS");
        const stockMarkets = await factory.getMarketsByTag("STOCKS");

        console.log(`\n${colorText("🏷️ Markets by Tags:", colors.bright)}`);
        console.log(
          `  Commodity Markets: ${colorText(
            commodityMarkets.length.toString(),
            colors.green
          )}`
        );
        console.log(
          `  Metal Markets: ${colorText(
            metalMarkets.length.toString(),
            colors.blue
          )}`
        );
        console.log(
          `  Stock Markets: ${colorText(
            stockMarkets.length.toString(),
            colors.yellow
          )}`
        );
      } catch (error) {
        console.log(
          colorText("⚠️ Could not fetch markets by tags", colors.yellow)
        );
      }
    } catch (error) {
      console.log(
        colorText("⚠️ Could not fetch enhanced market data", colors.yellow)
      );
    }

    console.log(
      `\n${colorText("🏭 Loading Aluminum Market...", colors.yellow)}`
    );

    // Use our aluminum market from config
    const aluminumMarketId = MARKET_INFO.ALUMINUM.marketId;
    const activeMarkets = [aluminumMarketId];

    // Display enhanced market metadata
    try {
      const [symbol, metricUrl, settlementDate, startPrice, settled] =
        await factory.getMarketMetadata(aluminumMarketId);

      console.log(
        `${colorText("✅ Loaded", colors.green)} ${colorText(
          symbol || "ALU-USD-FUTURES",
          colors.bright
        )} ${colorText("aluminum futures market", colors.green)}`
      );
      console.log(`  Market ID: ${aluminumMarketId}`);
      console.log(
        `  Metric URL: ${colorText(
          metricUrl || "https://lme.com/aluminum/price",
          colors.cyan
        )}`
      );
      console.log(
        `  Start Price: ${colorText(
          `$${ethers.utils.formatUnits(startPrice || "2500000000", 6)}`,
          colors.yellow
        )}`
      );
      console.log(
        `  Settlement Date: ${colorText(
          new Date((settlementDate || 0) * 1000).toLocaleDateString(),
          colors.white
        )}`
      );
      console.log(
        `  Status: ${colorText(
          settled ? "Settled" : "Active",
          settled ? colors.red : colors.green
        )}`
      );

      // Show data source and tags
      try {
        const dataSource = await factory.getMarketDataSource(aluminumMarketId);
        const tags = await factory.getMarketTags(aluminumMarketId);
        console.log(
          `  Data Source: ${colorText(dataSource || "LME", colors.cyan)}`
        );
        console.log(
          `  Tags: ${colorText(
            tags && tags.length > 0
              ? tags.join(", ")
              : "COMMODITIES, METALS, ALUMINUM",
            colors.yellow
          )}`
        );
      } catch (error) {
        console.log(`  Data Source: ${colorText("LME", colors.cyan)}`);
        console.log(
          `  Tags: ${colorText("COMMODITIES, METALS, ALUMINUM", colors.yellow)}`
        );
      }
    } catch (error) {
      console.log(
        `${colorText("✅ Loaded", colors.green)} ${colorText(
          "ALU-USD-FUTURES",
          colors.bright
        )} ${colorText("aluminum futures market", colors.green)}`
      );
      console.log(`  Market ID: ${aluminumMarketId}`);
      console.log(
        colorText("⚠️ Could not fetch enhanced metadata", colors.yellow)
      );
    }

    if (activeMarkets.length === 0) {
      console.log(colorText("❌ No active markets found!", colors.red));
      return;
    }

    // Get multi-market data
    console.log(
      `\n${colorText(
        "📊 Fetching Live Market Data via TradingRouter...",
        colors.yellow
      )}`
    );
    let marketData = [];
    let spreads = [];
    let spreadsBps = [];

    // Try TradingRouter batch methods first for better performance
    try {
      console.log(
        `  ${colorText("🚀 Using TradingRouter batch methods...", colors.cyan)}`
      );
      const tradingRouterMarketData = await tradingRouter.getMultiMarketData(
        activeMarkets
      );
      const [tradingRouterSpreads, tradingRouterSpreadsBps] =
        await tradingRouter.getMultiMarketSpreads(activeMarkets);

      for (let i = 0; i < activeMarkets.length; i++) {
        const marketId = activeMarkets[i];
        const trData = tradingRouterMarketData[i];

        marketData.push({
          marketId,
          midPrice: trData.midPrice,
          bestBid: trData.bestBid,
          bestAsk: trData.bestAsk,
          lastPrice: trData.lastPrice,
          spread: trData.spread,
          spreadBps: trData.spreadBps,
          isValid: trData.isValid,
          source: "tradingRouter",
        });

        spreads.push(tradingRouterSpreads[i]);
        spreadsBps.push(tradingRouterSpreadsBps[i]);
      }

      console.log(
        `  ${colorText(
          "✅ Successfully fetched all market data via TradingRouter",
          colors.green
        )}`
      );
    } catch (tradingRouterError) {
      console.log(
        `  ${colorText(
          "⚠️ TradingRouter batch failed, falling back to individual calls",
          colors.yellow
        )}`
      );

      // Fallback to individual market calls
      for (const marketId of activeMarkets) {
        try {
          const orderBookAddress = getAddress("ALUMINUM_ORDERBOOK");
          const orderBook = aluminumOrderBook; // Use the already loaded contract

          // Get market price data
          const [
            midPrice,
            bestBid,
            bestAsk,
            lastPrice,
            markPrice,
            spread,
            spreadBp,
            isValid,
          ] = await orderBook.getMarketPriceData();

          marketData.push({
            marketId,
            midPrice,
            bestBid,
            bestAsk,
            lastPrice: lastPrice,
            spread,
            spreadBps: spreadBp,
            isValid,
            source: "orderbook",
          });

          spreads.push(spread);
          spreadsBps.push(spreadBp);
        } catch (error) {
          console.log(
            `⚠️ Error fetching data for market ${marketId.slice(0, 10)}...: ${
              error.message
            }`
          );
          marketData.push({
            marketId,
            midPrice: 0,
            bestBid: 0,
            bestAsk: 0,
            lastPrice: 0,
            spread: 0,
            spreadBps: 0,
            isValid: false,
            source: "error",
          });
          spreads.push(0);
          spreadsBps.push(0);
        }
      }
    }

    console.log(
      `\n${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );
    console.log(
      `${colorText("📋 LIVE MARKET OVERVIEW", colors.bgBlue)} ${colorText(
        new Date().toLocaleString(),
        colors.cyan
      )}`
    );
    console.log(
      `${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );

    // Display overview table
    for (let i = 0; i < activeMarkets.length; i++) {
      const marketId = activeMarkets[i];
      const data = marketData[i];
      const spread = spreads[i];
      const spreadBps = spreadsBps[i];

      // Get market info from our config
      const marketName = "ALU/USDC Aluminum Futures";

      console.log(
        `\n${colorText(
          "┌─────────────────────────────────────────────────────────┐",
          colors.cyan
        )}`
      );
      console.log(
        `${colorText("│", colors.cyan)} ${colorText(
          marketName,
          colors.bright
        )} ${colorText("(" + marketId.slice(0, 10) + "...)", colors.white)}`
      );
      console.log(
        `${colorText(
          "├─────────────────────────────────────────────────────────┤",
          colors.cyan
        )}`
      );

      if (data.bestBid > 0 || data.bestAsk > 0 || data.midPrice > 0) {
        console.log(
          `${colorText("│", colors.cyan)} ${colorText(
            "📈 Best Bid:",
            colors.green
          )} ${colorText(
            data.bestBid > 0 ? "$" + formatPrice(data.bestBid) : "None",
            data.bestBid > 0 ? colors.green : colors.yellow
          )} ${colorText("📉 Best Ask:", colors.red)} ${colorText(
            data.bestAsk > 0 ? "$" + formatPrice(data.bestAsk) : "None",
            data.bestAsk > 0 ? colors.red : colors.yellow
          )}`
        );
        console.log(
          `${colorText("│", colors.cyan)} ${colorText(
            "🎯 Mid Price:",
            colors.yellow
          )} ${colorText(
            data.midPrice > 0 ? "$" + formatPrice(data.midPrice) : "None",
            colors.yellow
          )} ${colorText("📊 Valid Market:", colors.white)} ${colorText(
            data.isValid ? "Yes" : "No",
            data.isValid ? colors.green : colors.red
          )}`
        );
        if (data.lastPrice > 0) {
          console.log(
            `${colorText("│", colors.cyan)} ${colorText(
              "⚡ Last Trade:",
              colors.magenta
            )} ${colorText("$" + formatPrice(data.lastPrice), colors.magenta)}`
          );
        }
      } else {
        console.log(
          `${colorText("│", colors.cyan)} ${colorText(
            "💤 No active trading - Empty order book",
            colors.yellow
          )}`
        );
      }

      console.log(
        `${colorText(
          "└─────────────────────────────────────────────────────────┘",
          colors.cyan
        )}`
      );
    }

    // Detailed order book for each market
    console.log(
      `\n${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );
    console.log(`${colorText("📖 DETAILED ORDER BOOK DATA", colors.bgGreen)}`);
    console.log(
      `${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );

    for (let i = 0; i < activeMarkets.length; i++) {
      const marketId = activeMarkets[i];
      const data = marketData[i];

      // Get market info and OrderBook contract from our config
      const marketName = "ALU/USDC Aluminum Futures";
      const orderBookAddress = getAddress("ALUMINUM_ORDERBOOK");
      const orderBook = aluminumOrderBook; // Use the already loaded contract

      console.log(
        `\n${colorText(
          "🏛️ " + marketName.toUpperCase() + " ORDER BOOK",
          colors.bgBlue
        )}`
      );
      console.log(
        `${colorText("Market ID:", colors.white)} ${colorText(
          marketId,
          colors.cyan
        )}`
      );
      console.log(
        `${colorText("OrderBook:", colors.white)} ${colorText(
          orderBookAddress,
          colors.cyan
        )}`
      );

      if (data.bestBid > 0 || data.bestAsk > 0 || data.midPrice > 0) {
        // Get order book depth with enhanced accuracy check
        try {
          console.log(
            `  ${colorText("🔍 Fetching order book depth...", colors.cyan)}`
          );
          const depth = 10; // Get top 10 levels
          const [bidPrices, bidAmounts, askPrices, askAmounts] =
            await orderBook.getOrderBookDepth(depth);

          console.log(
            `  ${colorText(
              "📊 OrderBook.getOrderBookDepth() returned:",
              colors.yellow
            )}`
          );
          console.log(
            `     Bid levels: ${bidPrices.length}, Ask levels: ${askPrices.length}`
          );

          // Add option to use TradingRouter data for more accurate display
          const useTradingRouterData = true; // Set to true for more accurate data

          // Collect TradingRouter data first for comparison and potential use
          let tradingRouterBidLevels = new Map();
          let tradingRouterAskLevels = new Map();

          if (useTradingRouterData) {
            console.log(
              `  ${colorText(
                "🔄 Collecting live data from TradingRouter...",
                colors.cyan
              )}`
            );
            const signers = await ethers.getSigners();

            for (let j = 0; j < Math.min(signers.length, 5); j++) {
              const user = signers[j];
              try {
                const [marketIds, orderIds, orders] =
                  await tradingRouter.getUserActiveOrders(user.address);

                // Find orders for this specific market
                for (let k = 0; k < marketIds.length; k++) {
                  if (marketIds[k] === marketId) {
                    const ordersForMarket = orders[k];
                    const orderIdsForMarket = orderIds[k];

                    for (let m = 0; m < ordersForMarket.length; m++) {
                      const order = ordersForMarket[m];
                      const orderId = orderIdsForMarket[m];

                      const price = Number(
                        ethers.utils.formatUnits(order.priceTick, 6)
                      );

                      // CRITICAL FIX: Get remaining amount instead of original amount
                      try {
                        const filledAmount = await orderBook.getFilledAmount(
                          orderId
                        );
                        const remainingAmount =
                          BigInt(order.amount) - BigInt(filledAmount);
                        const amount = Number(
                          ethers.utils.formatUnits(remainingAmount, 18)
                        );

                        // Only include orders with remaining amounts > 0
                        if (amount > 0) {
                          if (order.side === 0) {
                            // BUY
                            if (tradingRouterBidLevels.has(price)) {
                              tradingRouterBidLevels.set(
                                price,
                                tradingRouterBidLevels.get(price) + amount
                              );
                            } else {
                              tradingRouterBidLevels.set(price, amount);
                            }
                          } else {
                            // SELL
                            if (tradingRouterAskLevels.has(price)) {
                              tradingRouterAskLevels.set(
                                price,
                                tradingRouterAskLevels.get(price) + amount
                              );
                            } else {
                              tradingRouterAskLevels.set(price, amount);
                            }
                          }
                        }
                      } catch (error) {
                        // If we can't get filled amount, skip this order
                        console.log(
                          `    ⚠️ Could not get filled amount for order ${orderId
                            .toString()
                            .slice(0, 8)}...`
                        );
                      }
                    }
                  }
                }
              } catch (error) {
                // Skip users with errors
              }
            }
          }

          console.log(
            `\n${colorText(
              "┌─────────────────────────────────────────────────────────┐",
              colors.white
            )}`
          );
          console.log(
            `${colorText("│", colors.white)}              ${colorText(
              "ORDER BOOK DEPTH (AGGREGATED)",
              colors.bright
            )}                ${colorText("│", colors.white)}`
          );
          console.log(
            `${colorText("│", colors.white)}          ${colorText(
              useTradingRouterData
                ? "Source: TradingRouter (Live)"
                : "Source: OrderBook (Cached)",
              useTradingRouterData ? colors.green : colors.yellow
            )}           ${colorText("│", colors.white)}`
          );
          console.log(
            `${colorText(
              "├─────────────────────────────────────────────────────────┤",
              colors.white
            )}`
          );
          console.log(
            `${colorText("│", colors.white)} ${colorText(
              "      BIDS (Buy Orders)",
              colors.green
            )}     ${colorText("│", colors.white)}     ${colorText(
              "ASKS (Sell Orders)",
              colors.red
            )}      ${colorText("│", colors.white)}`
          );
          console.log(
            `${colorText("│", colors.white)} ${colorText(
              "Price      Amount         ",
              colors.green
            )}     ${colorText("│", colors.white)}     ${colorText(
              "Price      Amount",
              colors.red
            )}         ${colorText("│", colors.white)}`
          );
          console.log(
            `${colorText(
              "├─────────────────────────────────────────────────────────┤",
              colors.white
            )}`
          );

          // Use TradingRouter data if enabled, otherwise use OrderBook depth
          let finalBidPrices, finalBidAmounts, finalAskPrices, finalAskAmounts;

          if (
            useTradingRouterData &&
            (tradingRouterBidLevels.size > 0 || tradingRouterAskLevels.size > 0)
          ) {
            // Convert TradingRouter data to arrays
            const sortedTRBids = Array.from(tradingRouterBidLevels.keys()).sort(
              (a, b) => b - a
            );
            const sortedTRAsks = Array.from(tradingRouterAskLevels.keys()).sort(
              (a, b) => a - b
            );

            finalBidPrices = sortedTRBids.map((price) =>
              ethers.utils.parseUnits(price.toString(), 6)
            );
            finalBidAmounts = sortedTRBids.map((price) =>
              ethers.utils.parseUnits(
                tradingRouterBidLevels.get(price).toString(),
                18
              )
            );
            finalAskPrices = sortedTRAsks.map((price) =>
              ethers.utils.parseUnits(price.toString(), 6)
            );
            finalAskAmounts = sortedTRAsks.map((price) =>
              ethers.utils.parseUnits(
                tradingRouterAskLevels.get(price).toString(),
                18
              )
            );

            console.log(
              `  ${colorText("✅ Using live TradingRouter data", colors.green)}`
            );
          } else {
            // Use OrderBook depth data
            finalBidPrices = bidPrices;
            finalBidAmounts = bidAmounts;
            finalAskPrices = askPrices;
            finalAskAmounts = askAmounts;

            console.log(
              `  ${colorText("📊 Using OrderBook depth data", colors.yellow)}`
            );
          }

          const maxRows = Math.max(
            finalBidPrices.length,
            finalAskPrices.length
          );

          for (let j = 0; j < Math.max(maxRows, 5); j++) {
            let bidInfo = "                        ";
            let askInfo = "                        ";

            if (j < finalBidPrices.length && finalBidPrices[j] > 0) {
              const price = formatPrice(finalBidPrices[j]);
              const amount = formatAmount(finalBidAmounts[j]);
              bidInfo = `${colorText(
                "$" + price.padEnd(8),
                colors.green
              )} ${colorText(amount.padEnd(12), colors.green)}`;
            }

            if (j < finalAskPrices.length && finalAskPrices[j] > 0) {
              const price = formatPrice(finalAskPrices[j]);
              const amount = formatAmount(finalAskAmounts[j]);
              askInfo = `${colorText(
                "$" + price.padEnd(8),
                colors.red
              )} ${colorText(amount.padEnd(12), colors.red)}`;
            }

            console.log(
              `${colorText("│", colors.white)} ${bidInfo}     ${colorText(
                "│",
                colors.white
              )}     ${askInfo} ${colorText("│", colors.white)}`
            );
          }

          console.log(
            `${colorText(
              "└─────────────────────────────────────────────────────────┘",
              colors.white
            )}`
          );

          // Add complete price level view
          console.log(
            `\n${colorText("📊 COMPLETE PRICE LEVELS:", colors.bright)}`
          );

          try {
            // Manually construct all price levels from individual orders
            const signers = await ethers.getSigners();
            const allSellOrders = [];
            const allBuyOrders = [];

            // Collect all orders from all users using TradingRouter
            for (let j = 0; j < Math.min(signers.length, 5); j++) {
              const user = signers[j];
              try {
                // Use TradingRouter.getUserActiveOrders() for cross-market order retrieval
                const [marketIds, orderIds, orders] =
                  await tradingRouter.getUserActiveOrders(user.address);

                // Find orders for this specific market
                for (let k = 0; k < marketIds.length; k++) {
                  if (marketIds[k] === marketId) {
                    const ordersForMarket = orders[k];
                    for (const order of ordersForMarket) {
                      // SAFETY FILTER: Only include PENDING and PARTIAL orders (status 0 and 1)
                      if (order.status === 0 || order.status === 1) {
                        if (order.side === 0) {
                          // BUY
                          allBuyOrders.push(order);
                        } else {
                          // SELL
                          allSellOrders.push(order);
                        }
                      }
                    }
                  }
                }
              } catch (error) {
                // Skip users with errors
              }
            }

            // Build price levels for sells (asks) and validate against OrderBook depth
            const askPriceLevels = new Map();
            console.log(
              `  ${colorText("📋 Processing SELL orders:", colors.red)}`
            );

            for (let idx = 0; idx < allSellOrders.length; idx++) {
              const order = allSellOrders[idx];
              try {
                // CRITICAL FIX: Get remaining amount instead of original amount
                const getFilledAmount = await orderBook.getFilledAmount(
                  order.orderId
                );
                const remainingAmount =
                  BigInt(order.amount) - BigInt(getFilledAmount);
                const amount = Number(
                  ethers.utils.formatUnits(remainingAmount, 18)
                );
                const price = Number(
                  ethers.utils.formatUnits(order.priceTick, 6)
                );

                // Only process orders with remaining amounts > 0
                if (amount > 0) {
                  console.log(
                    `     Order ${idx + 1}: $${price.toFixed(
                      2
                    )} × ${amount.toFixed(1)} ALU (remaining)`
                  );

                  if (askPriceLevels.has(price)) {
                    askPriceLevels.set(
                      price,
                      askPriceLevels.get(price) + amount
                    );
                  } else {
                    askPriceLevels.set(price, amount);
                  }
                } else {
                  console.log(
                    `     Order ${idx + 1}: $${price.toFixed(2)} × ${Number(
                      ethers.utils.formatUnits(order.amount, 18)
                    ).toFixed(1)} ALU (fully filled - skipped)`
                  );
                }
              } catch (error) {
                console.log(
                  `     ⚠️ Error processing sell order ${idx + 1}: ${
                    error.message
                  }`
                );
              }
            }

            // Build price levels for buys (bids)
            const bidPriceLevels = new Map();
            for (const orderId of allBuyOrders) {
              try {
                const orderDetails = await orderBook.orders(orderId);
                const price = Number(
                  ethers.utils.formatUnits(orderDetails.priceTick, 6)
                );
                const amount = Number(
                  ethers.utils.formatUnits(orderDetails.amount, 18)
                );

                if (bidPriceLevels.has(price)) {
                  bidPriceLevels.set(price, bidPriceLevels.get(price) + amount);
                } else {
                  bidPriceLevels.set(price, amount);
                }
              } catch (error) {
                // Skip orders with errors
              }
            }

            // Compare OrderBook depth vs TradingRouter data
            console.log(
              `\n  ${colorText("🔍 DATA VALIDATION:", colors.yellow)}`
            );
            const sortedAsks = Array.from(askPriceLevels.keys()).sort(
              (a, b) => a - b
            );
            const sortedBids = Array.from(bidPriceLevels.keys()).sort(
              (a, b) => b - a
            );

            console.log(
              `     OrderBook depth asks: ${askPrices.length} levels`
            );
            console.log(`     TradingRouter asks: ${sortedAsks.length} levels`);

            if (askPrices.length > 0) {
              console.log(
                `  ${colorText("📊 OrderBook ask prices:", colors.red)}`
              );
              for (let k = 0; k < Math.min(askPrices.length, 5); k++) {
                if (askPrices[k] > 0) {
                  const price = formatPrice(askPrices[k]);
                  const amount = formatAmount(askAmounts[k]);
                  console.log(`     Level ${k + 1}: $${price} × ${amount} ALU`);
                }
              }
            }

            if (sortedAsks.length > 0) {
              console.log(
                `  ${colorText("🎯 TradingRouter ask prices:", colors.red)}`
              );
              for (let k = 0; k < Math.min(sortedAsks.length, 5); k++) {
                const price = sortedAsks[k];
                const amount = askPriceLevels.get(price);
                console.log(
                  `     Level ${k + 1}: $${price.toFixed(2)} × ${amount.toFixed(
                    1
                  )} ALU`
                );
              }
            }

            if (sortedAsks.length > 0 || sortedBids.length > 0) {
              console.log(
                `${colorText(
                  "┌─────────────────────────────────────────────────────────┐",
                  colors.white
                )}`
              );
              console.log(
                `${colorText("│", colors.white)}     ${colorText(
                  "BIDS",
                  colors.green
                )}          ${colorText(
                  "│",
                  colors.white
                )}          ${colorText("ASKS", colors.red)}     ${colorText(
                  "│",
                  colors.white
                )}`
              );
              console.log(
                `${colorText("│", colors.white)} ${colorText(
                  "Price      Amount",
                  colors.green
                )}   ${colorText("│", colors.white)}   ${colorText(
                  "Price      Amount",
                  colors.red
                )}   ${colorText("│", colors.white)}`
              );
              console.log(
                `${colorText(
                  "├─────────────────────────────────────────────────────────┤",
                  colors.white
                )}`
              );

              const maxRows = Math.max(sortedBids.length, sortedAsks.length, 3);

              for (let j = 0; j < maxRows; j++) {
                let bidInfo = "                    ";
                let askInfo = "                    ";

                if (j < sortedBids.length) {
                  const price = sortedBids[j];
                  const amount = bidPriceLevels.get(price);
                  bidInfo = `${colorText(
                    `$${price.toFixed(2)}`.padEnd(8),
                    colors.green
                  )} ${colorText(amount.toFixed(1).padEnd(8), colors.green)}`;
                }

                if (j < sortedAsks.length) {
                  const price = sortedAsks[j];
                  const amount = askPriceLevels.get(price);
                  askInfo = `${colorText(
                    `$${price.toFixed(2)}`.padEnd(8),
                    colors.red
                  )} ${colorText(amount.toFixed(1).padEnd(8), colors.red)}`;
                }

                console.log(
                  `${colorText("│", colors.white)} ${bidInfo}   ${colorText(
                    "│",
                    colors.white
                  )}   ${askInfo}   ${colorText("│", colors.white)}`
                );
              }

              console.log(
                `${colorText(
                  "└─────────────────────────────────────────────────────────┘",
                  colors.white
                )}`
              );
            } else {
              console.log(
                `${colorText("📝 No price levels found", colors.yellow)}`
              );
            }
          } catch (error) {
            console.log(
              `${colorText(
                "⚠️ Could not build complete price levels:",
                colors.yellow
              )} ${error.message}`
            );
          }
        } catch (error) {
          console.log(
            `${colorText(
              "⚠️ Could not fetch order book depth:",
              colors.yellow
            )} ${error.message.substring(0, 50)}...`
          );
        }

        // Market statistics
        console.log(`\n${colorText("📊 MARKET STATISTICS:", colors.bright)}`);
        console.log(
          `${colorText("├─ Spread:", colors.white)} ${colorText(
            formatPrice(spreads[i]) +
              " USDC (" +
              (Number(spreadsBps[i]) / 100).toFixed(2) +
              " bps)",
            colors.yellow
          )}`
        );
        console.log(
          `${colorText("├─ Mid Price:", colors.white)} ${colorText(
            "$" + formatPrice(data.midPrice),
            colors.cyan
          )}`
        );
        console.log(
          `${colorText("├─ Best Bid:", colors.white)} ${colorText(
            data.bestBid > 0 ? "$" + formatPrice(data.bestBid) : "None",
            data.bestBid > 0 ? colors.green : colors.yellow
          )}`
        );
        console.log(
          `${colorText("├─ Best Ask:", colors.white)} ${colorText(
            data.bestAsk > 0 ? "$" + formatPrice(data.bestAsk) : "None",
            data.bestAsk > 0 ? colors.red : colors.yellow
          )}`
        );
        console.log(
          `${colorText("└─ Last Trade:", colors.white)} ${colorText(
            data.lastPrice > 0 ? "$" + formatPrice(data.lastPrice) : "None",
            data.lastPrice > 0 ? colors.magenta : colors.yellow
          )}`
        );

        // Show active orders count and individual orders
        try {
          const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
          console.log(`\n${colorText("📋 ACTIVE ORDERS:", colors.bright)}`);
          console.log(
            `${colorText("├─ Active Buy Orders:", colors.green)} ${colorText(
              buyCount.toString(),
              colors.bright
            )}`
          );
          console.log(
            `${colorText("└─ Active Sell Orders:", colors.red)} ${colorText(
              sellCount.toString(),
              colors.bright
            )}`
          );

          // Show individual orders for all users if there are active orders
          if (Number(buyCount) > 0 || Number(sellCount) > 0) {
            const signers = await ethers.getSigners();
            console.log(
              `\n${colorText("📜 INDIVIDUAL ORDERS:", colors.bright)}`
            );

            let orderIndex = 1;
            for (let j = 0; j < Math.min(signers.length, 5); j++) {
              const user = signers[j];
              const userName = j === 0 ? "Deployer" : `User ${j}`;

              try {
                // Use TradingRouter to get user orders across all markets
                const [marketIds, orderIds, orders] =
                  await tradingRouter.getUserActiveOrders(user.address);

                // Find orders for this specific market
                let userBuyOrders = [];
                let userSellOrders = [];

                for (let k = 0; k < marketIds.length; k++) {
                  if (marketIds[k] === marketId) {
                    const orderIdsForMarket = orderIds[k];
                    const ordersForMarket = orders[k];

                    for (let m = 0; m < ordersForMarket.length; m++) {
                      const order = ordersForMarket[m];
                      const orderId = orderIdsForMarket[m];

                      if (order.side === 0) {
                        // BUY
                        userBuyOrders.push(orderId);
                      } else {
                        // SELL
                        userSellOrders.push(orderId);
                      }
                    }
                  }
                }

                if (userBuyOrders.length > 0 || userSellOrders.length > 0) {
                  console.log(`\n${colorText(`👤 ${userName}:`, colors.cyan)}`);

                  // Show buy orders with details
                  for (const orderId of userBuyOrders) {
                    try {
                      const orderDetails = await orderBook.orders(orderId);
                      const filledAmount = await orderBook.getFilledAmount(
                        orderId
                      );
                      const remainingAmount =
                        BigInt(orderDetails.amount) - BigInt(getFilledAmount);

                      const price = ethers.utils.formatUnits(
                        orderDetails.priceTick,
                        6
                      );
                      const amount = ethers.utils.formatUnits(
                        remainingAmount,
                        18
                      );

                      // Only show orders with remaining amounts > 0
                      if (Number(amount) > 0) {
                        console.log(
                          `  ${colorText(
                            `${orderIndex++}.`,
                            colors.white
                          )} ${colorText("🟢 BUY", colors.green)} ${colorText(
                            `$${Number(price).toFixed(2)} × ${Number(
                              amount
                            ).toFixed(1)} ALU`,
                            colors.yellow
                          )} ${colorText(
                            `(${orderId.toString().slice(0, 8)}...)`,
                            colors.white
                          )}`
                        );
                      }
                    } catch (error) {
                      console.log(
                        `  ${colorText(
                          `${orderIndex++}.`,
                          colors.white
                        )} ${colorText("🟢 BUY", colors.green)} ${colorText(
                          orderId.toString().slice(0, 12) + "...",
                          colors.white
                        )}`
                      );
                    }
                  }

                  // Show sell orders with details
                  for (const orderId of userSellOrders) {
                    try {
                      const orderDetails = await orderBook.orders(orderId);
                      const filledAmount = await orderBook.getFilledAmount(
                        orderId
                      );
                      const remainingAmount =
                        BigInt(orderDetails.amount) - BigInt(getFilledAmount);

                      const price = ethers.utils.formatUnits(
                        orderDetails.priceTick,
                        6
                      );
                      const amount = ethers.utils.formatUnits(
                        remainingAmount,
                        18
                      );

                      // Only show orders with remaining amounts > 0
                      if (Number(amount) > 0) {
                        console.log(
                          `  ${colorText(
                            `${orderIndex++}.`,
                            colors.white
                          )} ${colorText("🔴 SELL", colors.red)} ${colorText(
                            `$${Number(price).toFixed(2)} × ${Number(
                              amount
                            ).toFixed(1)} ALU`,
                            colors.yellow
                          )} ${colorText(
                            `(${orderId.toString().slice(0, 8)}...)`,
                            colors.white
                          )}`
                        );
                      }
                    } catch (error) {
                      console.log(
                        `  ${colorText(
                          `${orderIndex++}.`,
                          colors.white
                        )} ${colorText("🔴 SELL", colors.red)} ${colorText(
                          orderId.toString().slice(0, 12) + "...",
                          colors.white
                        )}`
                      );
                    }
                  }
                }
              } catch (error) {
                // Skip users with errors
              }
            }
          }
        } catch (error) {
          console.log(
            `${colorText("⚠️ Could not fetch order counts", colors.yellow)}`
          );
        }
      } else {
        console.log(`\n${colorText("💤 EMPTY ORDER BOOK", colors.yellow)}`);
        console.log(
          `${colorText("📝 No active buy or sell orders", colors.white)}`
        );
        console.log(
          `${colorText(
            "🎯 Place the first order to start trading!",
            colors.cyan
          )}`
        );
      }
    }

    // Market Summary
    console.log(
      `\n${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );
    console.log(`${colorText("🏆 MARKET SUMMARY", colors.bgYellow)}`);
    console.log(
      `${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );

    console.log(
      `${colorText("📊 Active Markets:", colors.green)} ${colorText(
        activeMarkets.length.toString(),
        colors.bright
      )}`
    );

    // Count total orders across all markets
    let totalOrders = 0;
    let activeOrdersBreakdown = [];

    for (let i = 0; i < activeMarkets.length; i++) {
      const marketId = activeMarkets[i];
      const marketName = "ALU/USDC";
      const orderBookAddress = getAddress("ALUMINUM_ORDERBOOK");
      const orderBook = aluminumOrderBook; // Use the already loaded contract

      try {
        const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
        const marketTotal = Number(buyCount) + Number(sellCount);
        totalOrders += marketTotal;

        if (marketTotal > 0) {
          activeOrdersBreakdown.push({
            name: marketName,
            buyCount: Number(buyCount),
            sellCount: Number(sellCount),
            total: marketTotal,
          });
        }
      } catch (error) {
        // Skip if can't get order count
      }
    }

    console.log(
      `${colorText("📋 Total Active Orders:", colors.blue)} ${colorText(
        totalOrders.toString(),
        colors.bright
      )}`
    );

    if (activeOrdersBreakdown.length > 0) {
      console.log(`\n${colorText("📊 Orders by Market:", colors.yellow)}`);
      for (const market of activeOrdersBreakdown) {
        console.log(
          `${colorText("├─ " + market.name + ":", colors.white)} ${colorText(
            `${market.buyCount} buy, ${market.sellCount} sell (${market.total} total)`,
            colors.cyan
          )}`
        );
      }
    }

    console.log(
      `\n${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );
    console.log(
      `${colorText("✨ Live data updated at:", colors.green)} ${colorText(
        new Date().toLocaleString(),
        colors.bright
      )}`
    );
    console.log(
      `${colorText(
        "🔄 Run this script again for real-time updates",
        colors.cyan
      )}`
    );
    console.log(
      `${colorText(
        "═══════════════════════════════════════════════════════════",
        colors.bright
      )}`
    );
  } catch (error) {
    console.log(
      colorText("❌ Error fetching order book data:", colors.red),
      error.message
    );
    console.error(error);
  }
}

// Main execution
async function main() {
  await getLiveOrderBookData();
}

// Auto-refresh option (uncomment to enable)
// setInterval(async () => {
//   console.clear();
//   await getLiveOrderBookData();
// }, 5000); // Refresh every 5 seconds

main().catch(console.error);
