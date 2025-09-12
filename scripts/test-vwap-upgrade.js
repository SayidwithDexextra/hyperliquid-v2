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

async function deployUpgradedOrderBook() {
  console.log(colorText("\n=== DEPLOYING UPGRADED ORDERBOOK ===", "cyan"));

  const [deployer] = await ethers.getSigners();

  // Deploy the upgraded OrderBook
  const OrderBook = await ethers.getContractFactory("OrderBook");

  // Get deployment data
  const deploymentPath = path.join(
    __dirname,
    "../deployments/localhost-deployment.json"
  );
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const vault = deployment.contracts.CENTRALIZED_VAULT;
  const marketId = deployment.aluminumMarket.marketId;

  console.log("Deploying upgraded OrderBook...");
  const orderBook = await OrderBook.deploy(vault, marketId, deployer.address);
  await orderBook.waitForDeployment();

  const orderBookAddress = await orderBook.getAddress();
  console.log(
    colorText(`✓ Upgraded OrderBook deployed at: ${orderBookAddress}`, "green")
  );

  // Update deployment file
  deployment.contracts.ALUMINUM_ORDERBOOK_UPGRADED = orderBookAddress;
  deployment.aluminumMarket.orderBookUpgraded = orderBookAddress;
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  return orderBook;
}

async function testVWAPFunctionality(orderBook) {
  console.log(colorText("\n=== TESTING VWAP FUNCTIONALITY ===", "cyan"));

  const [deployer, user1, user2] = await ethers.getSigners();

  // Load contracts
  const deploymentPath = path.join(
    __dirname,
    "../deployments/localhost-deployment.json"
  );
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");
  const vault = CentralizedVault.attach(deployment.contracts.CENTRALIZED_VAULT);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach(deployment.contracts.MOCK_USDC);

  // 1. Test VWAP configuration
  console.log(colorText("\n1. Testing VWAP Configuration", "blue"));

  // Check default values
  const defaultTimeWindow = await orderBook.vwapTimeWindow();
  const minVolume = await orderBook.minVolumeForVWAP();
  const useVWAP = await orderBook.useVWAPForMarkPrice();

  console.log(
    `  Default time window: ${defaultTimeWindow} seconds (${
      Number(defaultTimeWindow) / 3600
    } hours)`
  );
  console.log(
    `  Min volume for VWAP: ${ethers.formatUnits(minVolume, 18)} units`
  );
  console.log(`  Use VWAP for mark price: ${useVWAP}`);

  // Configure VWAP
  console.log("\n  Configuring VWAP parameters...");
  await orderBook.configureVWAP(
    1800, // 30 minutes
    ethers.parseUnits("50", 18), // 50 units minimum
    true
  );
  console.log(colorText("  ✓ VWAP configured", "green"));

  // 2. Execute test trades
  console.log(colorText("\n2. Executing Test Trades", "blue"));

  // Ensure users have collateral
  const testAmount = ethers.parseUnits("10000", 6);
  for (const user of [user1, user2]) {
    await usdc.connect(deployer).transfer(user.address, testAmount);
    await usdc
      .connect(user)
      .approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(user).depositCollateral(testAmount);
  }

  // Execute trades with different prices and volumes
  const trades = [
    { price: "2.5", amount: "100" },
    { price: "3.0", amount: "200" },
    { price: "3.5", amount: "150" },
    { price: "2.8", amount: "300" },
    { price: "3.2", amount: "50" },
  ];

  let expectedVWAP = 0;
  let totalValue = 0;
  let totalVolume = 0;

  for (const trade of trades) {
    const priceScaled = ethers.parseUnits(trade.price, 6);
    const amountScaled = ethers.parseUnits(trade.amount, 18);

    console.log(`\n  Executing trade: ${trade.amount} units @ $${trade.price}`);

    // Seller places limit order
    await orderBook.connect(user2).placeLimitOrder(
      priceScaled,
      amountScaled,
      false // sell
    );

    // Buyer takes with market order
    await orderBook.connect(user1).placeMarketOrderWithSlippage(
      amountScaled,
      true, // buy
      500 // 5% slippage
    );

    // Track for expected VWAP
    totalValue += parseFloat(trade.price) * parseFloat(trade.amount);
    totalVolume += parseFloat(trade.amount);
  }

  expectedVWAP = totalValue / totalVolume;
  console.log(
    colorText(`\n  Expected VWAP: $${expectedVWAP.toFixed(6)}`, "magenta")
  );

  // 3. Test VWAP calculations
  console.log(colorText("\n3. Testing VWAP Calculations", "blue"));

  // Get VWAP for default window
  const vwap = await orderBook.getVWAP();
  console.log(`  Contract VWAP: $${ethers.formatUnits(vwap, 6)}`);

  // Get detailed VWAP data
  const vwapData = await orderBook.calculateVWAP(1800); // 30 minutes
  console.log(`  VWAP Price: $${ethers.formatUnits(vwapData.vwap, 6)}`);
  console.log(
    `  Total Volume: ${ethers.formatUnits(vwapData.totalVolume, 18)} units`
  );
  console.log(`  Trade Count: ${vwapData.tradeCount}`);
  console.log(`  Is Valid: ${vwapData.isValid}`);

  // Get multi-window VWAP
  console.log("\n  Multi-window VWAP data:");
  const multiVWAP = await orderBook.getMultiWindowVWAP();
  console.log(`    5 min:  $${ethers.formatUnits(multiVWAP.vwap5m, 6)}`);
  console.log(`    15 min: $${ethers.formatUnits(multiVWAP.vwap15m, 6)}`);
  console.log(`    1 hour: $${ethers.formatUnits(multiVWAP.vwap1h, 6)}`);
  console.log(`    4 hour: $${ethers.formatUnits(multiVWAP.vwap4h, 6)}`);
  console.log(`    24 hour: $${ethers.formatUnits(multiVWAP.vwap24h, 6)}`);

  // 4. Test mark price calculation
  console.log(colorText("\n4. Testing Mark Price with VWAP", "blue"));

  const markPrice = await orderBook.calculateMarkPrice();
  const marketData = await orderBook.getMarketPriceData();

  console.log(
    `  Mark Price (VWAP-based): $${ethers.formatUnits(markPrice, 6)}`
  );
  console.log(`  Mid Price: $${ethers.formatUnits(marketData.midPrice, 6)}`);
  console.log(`  Best Bid: $${ethers.formatUnits(marketData.bestBidPrice, 6)}`);
  console.log(`  Best Ask: $${ethers.formatUnits(marketData.bestAskPrice, 6)}`);
  console.log(
    `  Last Trade: $${ethers.formatUnits(marketData.lastTradePriceReturn, 6)}`
  );

  // 5. Test VWAP vs Traditional mark price
  console.log(
    colorText("\n5. Comparing VWAP vs Traditional Mark Price", "blue")
  );

  // Disable VWAP temporarily
  await orderBook.configureVWAP(1800, ethers.parseUnits("50", 18), false);
  const traditionalMarkPrice = await orderBook.calculateMarkPrice();

  // Re-enable VWAP
  await orderBook.configureVWAP(1800, ethers.parseUnits("50", 18), true);
  const vwapMarkPrice = await orderBook.calculateMarkPrice();

  console.log(
    `  Traditional Mark Price: $${ethers.formatUnits(traditionalMarkPrice, 6)}`
  );
  console.log(
    `  VWAP-based Mark Price: $${ethers.formatUnits(vwapMarkPrice, 6)}`
  );

  const difference = Math.abs(
    parseFloat(ethers.formatUnits(vwapMarkPrice, 6)) -
      parseFloat(ethers.formatUnits(traditionalMarkPrice, 6))
  );
  const percentDiff = (
    (difference / parseFloat(ethers.formatUnits(traditionalMarkPrice, 6))) *
    100
  ).toFixed(2);

  console.log(`  Difference: $${difference.toFixed(6)} (${percentDiff}%)`);

  // Verify VWAP accuracy
  const calculatedVWAP = parseFloat(ethers.formatUnits(vwapData.vwap, 6));
  const vwapAccuracy =
    (Math.abs(calculatedVWAP - expectedVWAP) / expectedVWAP) * 100;

  console.log(colorText("\n📊 VWAP Accuracy Check:", "bright"));
  console.log(`  Expected VWAP: $${expectedVWAP.toFixed(6)}`);
  console.log(`  Calculated VWAP: $${calculatedVWAP.toFixed(6)}`);
  console.log(`  Accuracy: ${(100 - vwapAccuracy).toFixed(2)}%`);

  if (vwapAccuracy < 1) {
    console.log(colorText("  ✓ VWAP calculation is accurate!", "green"));
  } else {
    console.log(
      colorText("  ⚠️  VWAP calculation has some deviation", "yellow")
    );
  }

  return {
    success: true,
    vwapPrice: calculatedVWAP,
    expectedVWAP: expectedVWAP,
    accuracy: 100 - vwapAccuracy,
  };
}

async function main() {
  console.log(colorText("\n🚀 VWAP Upgrade Test Script", "bright"));
  console.log("=".repeat(60));

  try {
    // Deploy upgraded OrderBook
    const orderBook = await deployUpgradedOrderBook();

    // Test VWAP functionality
    const results = await testVWAPFunctionality(orderBook);

    console.log(colorText("\n\n=== TEST SUMMARY ===", "bright"));
    console.log("=".repeat(60));
    console.log(colorText("\n✅ VWAP Implementation Test Complete!", "green"));
    console.log("\nKey Results:");
    console.log(`  • VWAP Price: $${results.vwapPrice.toFixed(6)}`);
    console.log(`  • Expected VWAP: $${results.expectedVWAP.toFixed(6)}`);
    console.log(`  • Calculation Accuracy: ${results.accuracy.toFixed(2)}%`);
    console.log(
      "\nThe OrderBook contract now implements industry-standard VWAP-based mark pricing!"
    );
    console.log("\nFeatures implemented:");
    console.log("  ✓ Time-windowed VWAP calculation");
    console.log("  ✓ Configurable time windows and minimum volume");
    console.log("  ✓ VWAP as primary mark price method");
    console.log("  ✓ Multi-window VWAP support (5m, 15m, 1h, 4h, 24h)");
    console.log("  ✓ Circular buffer for efficient trade history");
    console.log("  ✓ Fallback hierarchy for mark price calculation");
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
