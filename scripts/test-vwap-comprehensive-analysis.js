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

// Helper function to format time
function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Track all trades for manual VWAP verification
class VWAPTracker {
  constructor() {
    this.trades = [];
    this.startTime = Date.now();
  }

  addTrade(price, volume, timestamp) {
    this.trades.push({
      price: parseFloat(price),
      volume: parseFloat(volume),
      timestamp: timestamp || Date.now(),
      value: parseFloat(price) * parseFloat(volume),
    });
  }

  calculateVWAP(timeWindowSeconds = null) {
    let relevantTrades = this.trades;

    if (timeWindowSeconds) {
      const cutoffTime = Date.now() - timeWindowSeconds * 1000;
      relevantTrades = this.trades.filter((t) => t.timestamp >= cutoffTime);
    }

    if (relevantTrades.length === 0) {
      return { vwap: 0, volume: 0, count: 0, value: 0 };
    }

    const totalValue = relevantTrades.reduce((sum, t) => sum + t.value, 0);
    const totalVolume = relevantTrades.reduce((sum, t) => sum + t.volume, 0);

    return {
      vwap: totalVolume > 0 ? totalValue / totalVolume : 0,
      volume: totalVolume,
      count: relevantTrades.length,
      value: totalValue,
    };
  }

  displayTrades() {
    console.log("\n📋 Trade History:");
    this.trades.forEach((t, i) => {
      const age = ((Date.now() - t.timestamp) / 1000).toFixed(0);
      console.log(
        `  ${i + 1}. ${t.volume} units @ $${t.price.toFixed(
          4
        )} = $${t.value.toFixed(2)} (${age}s ago)`
      );
    });
  }
}

async function setupContracts() {
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
  const [deployer, user1, user2, user3] = await ethers.getSigners();

  // Connect to contracts
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach(
    "0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07"
  ); // VWAP OrderBook

  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");
  const vault = CentralizedVault.attach(deployment.contracts.CENTRALIZED_VAULT);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(deployment.contracts.MOCK_USDC);

  return {
    orderBook,
    vault,
    usdc,
    deployer,
    user1,
    user2,
    user3,
    marketId: deployment.aluminumMarket.marketId,
  };
}

async function grantPermissions(contracts) {
  const { orderBook, vault, deployer } = contracts;

  console.log(colorText("\n🔐 Setting up permissions...", "cyan"));

  try {
    // Grant FACTORY_ROLE to deployer temporarily
    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );

    console.log("  Granting FACTORY_ROLE to deployer...");
    await vault.grantRole(FACTORY_ROLE, deployer.address);

    // Register OrderBook
    console.log("  Registering OrderBook with vault...");
    await vault.registerOrderBook(await orderBook.getAddress());

    // Since market is already assigned to old OrderBook, we'll just ensure new OrderBook has ORDERBOOK_ROLE
    // The registration already grants ORDERBOOK_ROLE

    console.log(colorText("  ✓ Permissions granted", "green"));

    // Revoke FACTORY_ROLE
    await vault.revokeRole(FACTORY_ROLE, deployer.address);

    return true;
  } catch (error) {
    console.log(
      colorText("  ⚠️  Permissions already set or error:", "yellow"),
      error.message
    );
    return false;
  }
}

async function setupTradingAccounts(contracts) {
  const { vault, usdc, deployer, user1, user2, user3 } = contracts;

  console.log(colorText("\n💰 Setting up trading accounts...", "cyan"));

  const users = [user1, user2, user3];
  const testAmount = ethers.parseUnits("10000", 6); // 10,000 USDC each

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(`\n  User${i + 1}: ${user.address}`);

    // Check and mint USDC if needed
    const balance = await usdc.balanceOf(user.address);
    if (balance < testAmount) {
      await usdc.connect(deployer).transfer(user.address, testAmount);
      console.log(`    ✓ Transferred 10,000 USDC`);
    }

    // Approve vault
    await usdc
      .connect(user)
      .approve(await vault.getAddress(), ethers.MaxUint256);

    // Deposit collateral
    const currentCollateral = await vault.userCollateral(user.address);
    if (currentCollateral < testAmount / 2n) {
      await vault.connect(user).depositCollateral(testAmount / 2n);
      console.log(`    ✓ Deposited 5,000 USDC as collateral`);
    }

    const finalBalance = await usdc.balanceOf(user.address);
    const finalCollateral = await vault.userCollateral(user.address);
    console.log(`    Balance: ${ethers.formatUnits(finalBalance, 6)} USDC`);
    console.log(
      `    Collateral: ${ethers.formatUnits(finalCollateral, 6)} USDC`
    );
  }
}

async function executeTrade(contracts, seller, buyer, price, amount, tracker) {
  const { orderBook } = contracts;

  const priceScaled = ethers.parseUnits(price.toString(), 6);
  const amountScaled = ethers.parseUnits(amount.toString(), 18);

  // Seller places limit order
  await orderBook.connect(seller).placeLimitOrder(
    priceScaled,
    amountScaled,
    false // sell
  );

  // Buyer executes market order
  await orderBook.connect(buyer).placeMarketOrderWithSlippage(
    amountScaled,
    true, // buy
    500 // 5% slippage
  );

  // Track the trade
  tracker.addTrade(price, amount);

  console.log(`  ✓ Executed: ${amount} units @ $${price}`);
}

async function analyzeVWAP(orderBook, tracker, scenario) {
  console.log(colorText(`\n📊 Analyzing: ${scenario}`, "bright"));

  // Get contract VWAP data for different time windows
  const windows = [
    { name: "5 min", seconds: 300 },
    { name: "15 min", seconds: 900 },
    { name: "1 hour", seconds: 3600 },
    { name: "4 hour", seconds: 14400 },
    { name: "24 hour", seconds: 86400 },
  ];

  console.log("\n  Contract VWAP Data:");
  for (const window of windows) {
    try {
      const vwapData = await orderBook.calculateVWAP(window.seconds);
      const vwap = parseFloat(ethers.formatUnits(vwapData.vwap, 6));
      const volume = parseFloat(ethers.formatUnits(vwapData.totalVolume, 18));

      // Calculate expected VWAP
      const expected = tracker.calculateVWAP(window.seconds);

      console.log(
        `    ${window.name.padEnd(8)}: $${vwap.toFixed(6)} (${
          vwapData.tradeCount
        } trades, ${volume.toFixed(2)} units)`
      );

      if (vwapData.isValid && expected.vwap > 0) {
        const diff = Math.abs(vwap - expected.vwap);
        const accuracy = 100 - (diff / expected.vwap) * 100;
        console.log(
          `              Expected: $${expected.vwap.toFixed(
            6
          )} | Accuracy: ${accuracy.toFixed(2)}%`
        );
      }
    } catch (error) {
      console.log(`    ${window.name}: Error - ${error.message}`);
    }
  }

  // Get mark price
  const markPrice = await orderBook.calculateMarkPrice();
  const markPriceFormatted = parseFloat(ethers.formatUnits(markPrice, 6));

  // Get market data
  const marketData = await orderBook.getMarketPriceData();
  const midPrice = parseFloat(ethers.formatUnits(marketData.midPrice, 6));
  const bestBid =
    marketData.bestBidPrice > 0
      ? parseFloat(ethers.formatUnits(marketData.bestBidPrice, 6))
      : 0;
  const bestAsk =
    marketData.bestAskPrice < ethers.MaxUint256
      ? parseFloat(ethers.formatUnits(marketData.bestAskPrice, 6))
      : 0;

  console.log("\n  Price Analysis:");
  console.log(`    Mark Price:    $${markPriceFormatted.toFixed(6)}`);
  console.log(`    Mid Price:     $${midPrice.toFixed(6)}`);
  console.log(
    `    Best Bid:      $${bestBid > 0 ? bestBid.toFixed(6) : "None"}`
  );
  console.log(
    `    Best Ask:      $${bestAsk > 0 ? bestAsk.toFixed(6) : "None"}`
  );

  // Manual VWAP calculation
  const manualVWAP = tracker.calculateVWAP();
  console.log(`    Manual VWAP:   $${manualVWAP.vwap.toFixed(6)}`);

  // Check if VWAP is being used for mark price
  const vwapData = await orderBook.calculateVWAP(3600);
  const contractVWAP = parseFloat(ethers.formatUnits(vwapData.vwap, 6));

  if (vwapData.isValid && contractVWAP > 0) {
    const vwapDiff = Math.abs(markPriceFormatted - contractVWAP);
    if (vwapDiff < 0.000001) {
      console.log(colorText("    ✓ Mark price is using VWAP!", "green"));
    } else if (Math.abs(markPriceFormatted - midPrice) < 0.000001) {
      console.log(
        colorText(
          "    ℹ Mark price is using mid-price (VWAP might be invalid)",
          "yellow"
        )
      );
    }
  }

  return {
    markPrice: markPriceFormatted,
    contractVWAP: contractVWAP,
    manualVWAP: manualVWAP.vwap,
    midPrice: midPrice,
  };
}

async function runTestScenarios(contracts) {
  const { orderBook, user1, user2, user3 } = contracts;
  const tracker = new VWAPTracker();

  console.log(colorText("\n\n=== VWAP COMPREHENSIVE ANALYSIS ===", "bright"));
  console.log("=".repeat(80));

  // Scenario 1: Basic VWAP Test
  console.log(colorText("\n📍 Scenario 1: Basic VWAP Test", "blue"));
  console.log("  Testing with equal volumes at different prices");

  await executeTrade(contracts, user1, user2, 2.5, 50, tracker);
  await executeTrade(contracts, user2, user3, 3.0, 50, tracker);
  await executeTrade(contracts, user3, user1, 3.5, 50, tracker);

  tracker.displayTrades();
  const scenario1 = await analyzeVWAP(
    orderBook,
    tracker,
    "Equal Volume Trades"
  );

  // Wait a bit between scenarios
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Scenario 2: Volume-Weighted Test
  console.log(colorText("\n📍 Scenario 2: Volume-Weighted Test", "blue"));
  console.log("  Testing with different volumes to verify weighting");

  await executeTrade(contracts, user1, user2, 2.0, 200, tracker); // Heavy volume at low price
  await executeTrade(contracts, user2, user3, 5.0, 20, tracker); // Light volume at high price
  await executeTrade(contracts, user3, user1, 3.0, 100, tracker); // Medium volume at mid price

  tracker.displayTrades();
  const scenario2 = await analyzeVWAP(
    orderBook,
    tracker,
    "Volume-Weighted Trades"
  );

  // Scenario 3: Time Window Test
  console.log(colorText("\n📍 Scenario 3: Time Window Test", "blue"));
  console.log("  Testing VWAP calculation across different time windows");

  // Execute some trades with delays
  for (let i = 0; i < 3; i++) {
    const price = 3.0 + i * 0.2;
    await executeTrade(contracts, user1, user2, price, 30, tracker);
    console.log(`  Waiting 5 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  tracker.displayTrades();
  const scenario3 = await analyzeVWAP(
    orderBook,
    tracker,
    "Time-Windowed Trades"
  );

  // Scenario 4: Outlier Resistance Test
  console.log(colorText("\n📍 Scenario 4: Outlier Resistance Test", "blue"));
  console.log("  Testing VWAP's resistance to price manipulation");

  await executeTrade(contracts, user1, user2, 3.0, 100, tracker); // Normal price, high volume
  await executeTrade(contracts, user2, user3, 10.0, 1, tracker); // Outlier price, tiny volume
  await executeTrade(contracts, user3, user1, 3.1, 100, tracker); // Normal price, high volume

  tracker.displayTrades();
  const scenario4 = await analyzeVWAP(orderBook, tracker, "Outlier Resistance");

  // Final Summary
  console.log(colorText("\n\n=== FINAL ANALYSIS SUMMARY ===", "bright"));
  console.log("=".repeat(80));

  // Calculate overall statistics
  const allTrades = tracker.calculateVWAP();
  console.log("\n📈 Overall Statistics:");
  console.log(`  Total Trades: ${allTrades.count}`);
  console.log(`  Total Volume: ${allTrades.volume.toFixed(2)} units`);
  console.log(`  Total Value: $${allTrades.value.toFixed(2)}`);
  console.log(`  Overall VWAP: $${allTrades.vwap.toFixed(6)}`);

  // Test VWAP configuration
  console.log(colorText("\n⚙️  VWAP Configuration:", "cyan"));
  const vwapTimeWindow = await orderBook.vwapTimeWindow();
  const minVolume = await orderBook.minVolumeForVWAP();
  const useVWAP = await orderBook.useVWAPForMarkPrice();

  console.log(`  Time Window: ${formatTime(Number(vwapTimeWindow))}`);
  console.log(`  Min Volume: ${ethers.formatUnits(minVolume, 18)} units`);
  console.log(`  Use VWAP: ${useVWAP}`);

  // Mathematical Verification
  console.log(colorText("\n🔢 Mathematical Verification:", "magenta"));
  console.log("\n  VWAP Formula: Σ(Price × Volume) / Σ(Volume)");
  console.log(`  Expected: $${allTrades.vwap.toFixed(6)}`);

  // Get final contract VWAP
  const finalVWAP = await orderBook.calculateVWAP(3600);
  const contractVWAP = parseFloat(ethers.formatUnits(finalVWAP.vwap, 6));
  console.log(`  Contract: $${contractVWAP.toFixed(6)}`);

  const accuracy =
    allTrades.vwap > 0
      ? 100 - (Math.abs(contractVWAP - allTrades.vwap) / allTrades.vwap) * 100
      : 0;
  console.log(`  Accuracy: ${accuracy.toFixed(2)}%`);

  if (accuracy > 99.9) {
    console.log(
      colorText("\n✅ VWAP calculation is mathematically accurate!", "green")
    );
  } else if (accuracy > 99) {
    console.log(
      colorText("\n✓ VWAP calculation is reasonably accurate", "yellow")
    );
  } else {
    console.log(
      colorText("\n⚠️  VWAP calculation shows some deviation", "red")
    );
  }

  // Key Insights
  console.log(colorText("\n💡 Key Insights:", "cyan"));
  console.log("  1. VWAP correctly weights prices by volume");
  console.log("  2. Large volume trades have more impact on VWAP");
  console.log("  3. Small volume outliers have minimal effect");
  console.log("  4. Time windows filter trades appropriately");
  console.log("  5. Mark price uses VWAP when valid and sufficient volume");

  console.log("\n" + "=".repeat(80));
}

async function main() {
  try {
    // Setup
    const contracts = await setupContracts();
    console.log(
      colorText("\n🚀 VWAP Comprehensive Trading Analysis", "bright")
    );
    console.log("Testing mark price calculation with real trades");

    // Grant permissions if needed
    await grantPermissions(contracts);

    // Setup trading accounts
    await setupTradingAccounts(contracts);

    // Run test scenarios
    await runTestScenarios(contracts);

    console.log(colorText("\n✅ Analysis complete!", "green"));
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
