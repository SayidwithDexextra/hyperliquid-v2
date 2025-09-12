const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Color functions for better output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Calculate industry-standard VWAP (Volume-Weighted Average Price)
 * @param {Array} trades - Array of trades with price and volume
 * @param {number} timeWindowSeconds - Time window for VWAP calculation (default: 3600 = 1 hour)
 * @returns {Object} VWAP calculation results
 */
function calculateVWAP(trades, timeWindowSeconds = 3600) {
  if (!trades || trades.length === 0) {
    return {
      vwap: 0,
      totalVolume: 0,
      tradeCount: 0,
      timeWindow: timeWindowSeconds,
      isValid: false,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const cutoffTime = now - timeWindowSeconds;

  // Filter trades within time window
  const recentTrades = trades.filter(
    (trade) => parseInt(trade.timestamp) >= cutoffTime
  );

  if (recentTrades.length === 0) {
    return {
      vwap: 0,
      totalVolume: 0,
      tradeCount: 0,
      timeWindow: timeWindowSeconds,
      isValid: false,
    };
  }

  // Calculate VWAP: Σ(price × volume) / Σ(volume)
  let totalValue = 0;
  let totalVolume = 0;

  for (const trade of recentTrades) {
    const price = parseFloat(ethers.formatUnits(trade.price, 6));
    const volume = parseFloat(ethers.formatUnits(trade.amount, 18));

    totalValue += price * volume;
    totalVolume += volume;
  }

  const vwap = totalVolume > 0 ? totalValue / totalVolume : 0;

  return {
    vwap: vwap,
    vwapScaled: Math.round(vwap * 1e6), // Scale to 6 decimals for comparison
    totalVolume: totalVolume,
    totalValue: totalValue,
    tradeCount: recentTrades.length,
    timeWindow: timeWindowSeconds,
    oldestTradeTime: recentTrades[0].timestamp,
    newestTradeTime: recentTrades[recentTrades.length - 1].timestamp,
    isValid: true,
  };
}

/**
 * Calculate TWAP (Time-Weighted Average Price) as an alternative
 * @param {Array} trades - Array of trades
 * @param {number} timeWindowSeconds - Time window for TWAP calculation
 * @returns {Object} TWAP calculation results
 */
function calculateTWAP(trades, timeWindowSeconds = 3600) {
  if (!trades || trades.length === 0) {
    return { twap: 0, isValid: false };
  }

  const now = Math.floor(Date.now() / 1000);
  const cutoffTime = now - timeWindowSeconds;

  const recentTrades = trades.filter(
    (trade) => parseInt(trade.timestamp) >= cutoffTime
  );

  if (recentTrades.length === 0) {
    return { twap: 0, isValid: false };
  }

  // Simple average of prices (can be weighted by time intervals for more accuracy)
  const sum = recentTrades.reduce(
    (acc, trade) => acc + parseFloat(ethers.formatUnits(trade.price, 6)),
    0
  );

  const twap = sum / recentTrades.length;

  return {
    twap: twap,
    twapScaled: Math.round(twap * 1e6),
    tradeCount: recentTrades.length,
    timeWindow: timeWindowSeconds,
    isValid: true,
  };
}

/**
 * Cancel all orders and positions for a clean slate
 */
async function clearAllOrdersAndPositions(contracts, signers) {
  console.log(
    colorText("\n=== CLEARING ALL ORDERS AND POSITIONS ===", "yellow")
  );

  const { orderBook, vault } = contracts;

  // Cancel all orders for each user
  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    const userOrders = await orderBook
      .connect(signer)
      .getUserOrders(signer.address);

    if (userOrders.length > 0) {
      console.log(
        `\nCancelling ${userOrders.length} orders for ${signer.address}...`
      );

      for (const orderId of userOrders) {
        try {
          const order = await orderBook.orders(orderId);
          if (order.amount > 0) {
            // Only cancel active orders
            await orderBook.connect(signer).cancelOrder(orderId);
            console.log(`  - Cancelled order #${orderId}`);
          }
        } catch (error) {
          console.log(
            `  - Failed to cancel order #${orderId}: ${error.message}`
          );
        }
      }
    }
  }

  // Force close all positions if needed
  console.log("\nChecking for open positions...");
  for (const signer of signers) {
    const positions = await vault.getUserPositions(signer.address);
    if (positions.length > 0) {
      console.log(
        `\nUser ${signer.address} has ${positions.length} open positions`
      );
      // Note: Positions would need to be closed through trades or liquidation
      // This is just for reporting
    }
  }

  console.log(colorText("\n✓ All orders cancelled", "green"));
}

/**
 * Get recent trades from the order book
 */
async function getRecentTrades(orderBook, limit = 100) {
  const tradeCount = await orderBook.totalTradeCount();
  const trades = [];

  const startId = Math.max(1, Number(tradeCount) - limit + 1);

  for (let i = startId; i <= Number(tradeCount); i++) {
    try {
      const trade = await orderBook.trades(i);
      if (trade.timestamp > 0) {
        trades.push(trade);
      }
    } catch (error) {
      // Trade might not exist
    }
  }

  return trades;
}

/**
 * Execute test trades for VWAP testing
 */
async function executeTestTrades(contracts, signers) {
  console.log(colorText("\n=== EXECUTING TEST TRADES FOR VWAP ===", "cyan"));

  const { orderBook, vault, usdc } = contracts;
  const [deployer, user1, user2] = signers;

  // Test scenarios with different volumes and prices
  const testScenarios = [
    // Scenario 1: Equal volume trades at different prices
    {
      name: "Equal Volume, Different Prices",
      trades: [
        { buyer: user1, seller: user2, price: 2.5, amount: 10 },
        { buyer: user2, seller: user1, price: 3.0, amount: 10 },
        { buyer: user1, seller: user2, price: 3.5, amount: 10 },
      ],
    },
    // Scenario 2: Different volumes at different prices (VWAP should weight by volume)
    {
      name: "Different Volumes (VWAP Test)",
      trades: [
        { buyer: user1, seller: user2, price: 2.0, amount: 50 }, // Heavy volume at low price
        { buyer: user2, seller: user1, price: 4.0, amount: 10 }, // Light volume at high price
        { buyer: user1, seller: user2, price: 3.0, amount: 20 }, // Medium volume at mid price
      ],
    },
    // Scenario 3: Market manipulation attempt (large volume should dominate VWAP)
    {
      name: "Large Volume Dominance",
      trades: [
        { buyer: user1, seller: user2, price: 3.0, amount: 5 },
        { buyer: user2, seller: user1, price: 3.1, amount: 5 },
        { buyer: user1, seller: user2, price: 10.0, amount: 1 }, // Outlier with small volume
        { buyer: user2, seller: user1, price: 3.0, amount: 100 }, // Large volume at normal price
      ],
    },
  ];

  for (const scenario of testScenarios) {
    console.log(colorText(`\n--- ${scenario.name} ---`, "blue"));

    // Clear orderbook before each scenario
    await clearAllOrdersAndPositions(contracts, signers);

    // Execute trades
    for (const trade of scenario.trades) {
      const priceScaled = ethers.parseUnits(trade.price.toString(), 6);
      const amountScaled = ethers.parseUnits(trade.amount.toString(), 18);

      // Place matching orders
      console.log(`\nExecuting trade: ${trade.amount} units @ $${trade.price}`);

      // Seller places ask
      await orderBook.connect(trade.seller).placeLimitOrder(
        priceScaled,
        amountScaled,
        false // sell (isBuy = false)
      );

      // Buyer places market order to execute immediately
      await orderBook.connect(trade.buyer).placeMarketOrderWithSlippage(
        amountScaled,
        true, // buy
        500 // 5% slippage
      );
    }

    // Wait for trades to settle
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get trades and calculate VWAP
    const trades = await getRecentTrades(orderBook, 50);
    const vwapResult = calculateVWAP(trades, 3600); // 1 hour window
    const twapResult = calculateTWAP(trades, 3600);

    // Get current mark price from contract
    const contractMarkPrice = await orderBook.calculateMarkPrice();
    const markPriceFormatted = parseFloat(
      ethers.formatUnits(contractMarkPrice, 6)
    );

    // Get order book state
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const lastTradePrice = await orderBook.lastTradePrice();

    // Display results
    console.log(colorText("\n📊 Results:", "bright"));
    console.log(`  Contract Mark Price: $${markPriceFormatted.toFixed(6)}`);
    console.log(
      `  VWAP (1hr window):   $${vwapResult.vwap.toFixed(6)} (${
        vwapResult.tradeCount
      } trades)`
    );
    console.log(`  TWAP (1hr window):   $${twapResult.twap.toFixed(6)}`);
    console.log(
      `  Total Volume:        ${vwapResult.totalVolume.toFixed(2)} units`
    );
    console.log(
      `  Best Bid:            $${
        bestBid > 0
          ? parseFloat(ethers.formatUnits(bestBid, 6)).toFixed(6)
          : "None"
      }`
    );
    console.log(
      `  Best Ask:            $${
        bestAsk < ethers.MaxUint256
          ? parseFloat(ethers.formatUnits(bestAsk, 6)).toFixed(6)
          : "None"
      }`
    );
    console.log(
      `  Last Trade:          $${parseFloat(
        ethers.formatUnits(lastTradePrice, 6)
      ).toFixed(6)}`
    );

    // Calculate differences
    const vwapDiff = Math.abs(markPriceFormatted - vwapResult.vwap);
    const vwapDiffPercent = ((vwapDiff / vwapResult.vwap) * 100).toFixed(2);

    console.log(colorText("\n📈 Analysis:", "bright"));
    console.log(
      `  Mark vs VWAP Difference: $${vwapDiff.toFixed(6)} (${vwapDiffPercent}%)`
    );

    if (vwapDiffPercent > 5) {
      console.log(
        colorText(
          `  ⚠️  WARNING: Mark price deviates significantly from VWAP!`,
          "red"
        )
      );
    } else {
      console.log(
        colorText(`  ✓ Mark price is reasonably close to VWAP`, "green")
      );
    }

    // Expected VWAP calculation for verification
    console.log(colorText("\n🔍 Manual VWAP Verification:", "magenta"));
    let manualTotalValue = 0;
    let manualTotalVolume = 0;

    for (const trade of scenario.trades) {
      manualTotalValue += trade.price * trade.amount;
      manualTotalVolume += trade.amount;
      console.log(
        `  Trade: ${trade.amount} @ $${trade.price} = $${
          trade.price * trade.amount
        }`
      );
    }

    const expectedVWAP = manualTotalValue / manualTotalVolume;
    console.log(`  Expected VWAP: $${expectedVWAP.toFixed(6)}`);
    console.log(`  Calculated VWAP: $${vwapResult.vwap.toFixed(6)}`);

    // Store results for summary
    scenario.results = {
      markPrice: markPriceFormatted,
      vwap: vwapResult.vwap,
      twap: twapResult.twap,
      expectedVWAP: expectedVWAP,
      deviation: vwapDiffPercent,
    };
  }

  return testScenarios;
}

/**
 * Generate comprehensive test report
 */
function generateTestReport(scenarios) {
  console.log(
    colorText("\n\n=== COMPREHENSIVE VWAP TEST REPORT ===", "bright")
  );
  console.log("=".repeat(80));

  console.log(colorText("\n📋 EXECUTIVE SUMMARY", "cyan"));
  console.log(
    "\nThe current OrderBook implementation uses a simple mid-price calculation"
  );
  console.log(
    "(average of best bid and ask) for mark price, which differs from the"
  );
  console.log(
    "industry-standard VWAP (Volume-Weighted Average Price) approach."
  );

  console.log(colorText("\n📊 TEST RESULTS SUMMARY", "cyan"));
  console.log(
    "\n┌─────────────────────────────────┬──────────┬──────────┬──────────┬───────────┐"
  );
  console.log(
    "│ Scenario                        │ Mark($)  │ VWAP($)  │ Expected │ Dev(%)    │"
  );
  console.log(
    "├─────────────────────────────────┼──────────┼──────────┼──────────┼───────────┤"
  );

  for (const scenario of scenarios) {
    if (scenario.results) {
      const r = scenario.results;
      const name = scenario.name.padEnd(31).substring(0, 31);
      console.log(
        `│ ${name} │ ${r.markPrice.toFixed(4).padStart(8)} │ ${r.vwap
          .toFixed(4)
          .padStart(8)} │ ${r.expectedVWAP
          .toFixed(4)
          .padStart(8)} │ ${r.deviation.padStart(9)} │`
      );
    }
  }
  console.log(
    "└─────────────────────────────────┴──────────┴──────────┴──────────┴───────────┘"
  );

  console.log(colorText("\n🔍 KEY FINDINGS", "cyan"));
  console.log("\n1. Current Implementation:");
  console.log("   - Uses simple mid-price: (bestBid + bestAsk) / 2");
  console.log(
    "   - Falls back to last trade price when order book is one-sided"
  );
  console.log("   - Does NOT consider trade volumes");

  console.log("\n2. VWAP Benefits:");
  console.log("   - Weights prices by actual traded volume");
  console.log(
    "   - More resistant to manipulation (small volume outliers have less impact)"
  );
  console.log("   - Better represents actual market activity");
  console.log("   - Industry standard for fair value calculation");

  console.log("\n3. Implementation Gaps:");
  console.log("   - No time-windowed trade history for VWAP calculation");
  console.log("   - No volume weighting in mark price");
  console.log(
    "   - No configurable time windows for different market conditions"
  );

  console.log(colorText("\n💡 RECOMMENDATIONS", "yellow"));
  console.log("\n1. Implement VWAP-based mark price calculation:");
  console.log("   - Add time-windowed trade history tracking");
  console.log(
    "   - Calculate VWAP over configurable windows (e.g., 1hr, 4hr, 24hr)"
  );
  console.log("   - Use VWAP as primary mark price with fallbacks");

  console.log("\n2. Suggested Mark Price Hierarchy:");
  console.log("   a) Primary: VWAP (if sufficient recent volume)");
  console.log("   b) Secondary: Order book mid-price (if both sides exist)");
  console.log("   c) Tertiary: TWAP or last trade price");
  console.log("   d) Fallback: Previous mark price or initial price");

  console.log("\n3. Additional Improvements:");
  console.log("   - Add minimum volume thresholds for VWAP validity");
  console.log("   - Implement outlier detection and filtering");
  console.log("   - Add mark price bounds to prevent extreme movements");
  console.log("   - Consider impact bid/ask for large position liquidations");

  console.log(colorText("\n📝 IMPLEMENTATION NOTES", "magenta"));
  console.log("\nTo implement VWAP in the OrderBook contract:");
  console.log(
    "1. Add circular buffer for recent trades (e.g., last 1000 trades)"
  );
  console.log(
    "2. Track cumulative volume and value for efficient VWAP calculation"
  );
  console.log("3. Update calculateMarkPrice() to use VWAP when available");
  console.log("4. Add configuration for VWAP time windows and minimum volume");

  console.log("\n" + "=".repeat(80));
  console.log(colorText("End of VWAP Test Report", "bright"));
  console.log("=".repeat(80) + "\n");
}

async function main() {
  console.log(colorText("\n🚀 VWAP Mark Price Testing Script", "bright"));
  console.log("=".repeat(60));

  try {
    // Load deployment
    const deploymentPath = path.join(
      __dirname,
      "../deployments/localhost-deployment.json"
    );
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(
        "No deployment found. Please run the deployment script first."
      );
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

    // Get signers
    const [deployer, user1, user2] = await ethers.getSigners();
    console.log("\n📋 Test Participants:");
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  User1:    ${user1.address}`);
    console.log(`  User2:    ${user2.address}`);

    // Get contracts
    const OrderBook = await ethers.getContractFactory("OrderBook");
    // Use the new VWAP-enabled OrderBook
    const orderBook = OrderBook.attach(
      "0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07"
    );

    const CentralizedVault = await ethers.getContractFactory(
      "CentralizedVault"
    );
    const vault = CentralizedVault.attach(
      deployment.contracts.CENTRALIZED_VAULT
    );

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(deployment.contracts.MOCK_USDC);

    const contracts = { orderBook, vault, usdc };
    const signers = [deployer, user1, user2];

    // Ensure users have USDC and collateral
    console.log("\n💰 Setting up test collateral...");
    const testAmount = ethers.parseUnits("10000", 6); // 10,000 USDC each

    for (const user of [user1, user2]) {
      const balance = await usdc.balanceOf(user.address);
      if (balance < testAmount) {
        await usdc.connect(deployer).transfer(user.address, testAmount);
      }

      await usdc
        .connect(user)
        .approve(await vault.getAddress(), ethers.MaxUint256);

      const collateral = await vault.userCollateral(user.address);
      if (collateral < testAmount) {
        await vault.connect(user).depositCollateral(testAmount - collateral);
      }
    }

    // Clear all orders first
    await clearAllOrdersAndPositions(contracts, signers);

    // Execute test scenarios
    const scenarios = await executeTestTrades(contracts, signers);

    // Generate comprehensive report
    generateTestReport(scenarios);
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, "red"));
    console.error(error);
    process.exit(1);
  }
}

// Execute main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
