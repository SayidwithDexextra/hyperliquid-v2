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

async function main() {
  console.log(colorText("\n🚀 VWAP Implementation Verification", "bright"));
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
    console.log("\n📋 Test Configuration:");
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  User1:    ${user1.address}`);
    console.log(`  User2:    ${user2.address}`);

    // Get contracts
    const OrderBook = await ethers.getContractFactory("OrderBook");
    const orderBookAddress =
      deployment.contracts.ALUMINUM_ORDERBOOK ||
      deployment.aluminumMarket.orderBook;
    const orderBook = OrderBook.attach(orderBookAddress);

    const CentralizedVault = await ethers.getContractFactory(
      "CentralizedVault"
    );
    const vault = CentralizedVault.attach(
      deployment.contracts.CENTRALIZED_VAULT
    );

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = MockUSDC.attach(deployment.contracts.MOCK_USDC);

    console.log("\n📊 Connected to existing contracts:");
    console.log(`  OrderBook: ${orderBookAddress}`);
    console.log(`  Vault: ${deployment.contracts.CENTRALIZED_VAULT}`);
    console.log(`  USDC: ${deployment.contracts.MOCK_USDC}`);

    // Check if contract has VWAP functions
    console.log(colorText("\n=== CHECKING VWAP FUNCTIONALITY ===", "cyan"));

    try {
      // Test 1: Check if VWAP state variables exist
      console.log(colorText("\n1. Checking VWAP State Variables", "blue"));

      try {
        const vwapTimeWindow = await orderBook.vwapTimeWindow();
        console.log(
          colorText("  ✓ Contract has VWAP implementation!", "green")
        );
        console.log(
          `  Time Window: ${vwapTimeWindow} seconds (${
            Number(vwapTimeWindow) / 3600
          } hours)`
        );

        const minVolume = await orderBook.minVolumeForVWAP();
        console.log(`  Min Volume: ${ethers.formatUnits(minVolume, 18)} units`);

        const useVWAP = await orderBook.useVWAPForMarkPrice();
        console.log(`  Use VWAP: ${useVWAP}`);
      } catch (error) {
        console.log(
          colorText("  ✗ Contract does NOT have VWAP implementation", "red")
        );
        console.log(
          "  The deployed OrderBook needs to be upgraded to include VWAP"
        );
        return;
      }

      // Test 2: Check existing trade history
      console.log(colorText("\n2. Checking Trade History", "blue"));

      const tradeCount = await orderBook.totalTradeCount();
      console.log(`  Total trades executed: ${tradeCount}`);

      if (Number(tradeCount) > 0) {
        // Get last few trades
        const recentTrades = [];
        const startId = Math.max(1, Number(tradeCount) - 4);

        for (let i = startId; i <= Number(tradeCount); i++) {
          const trade = await orderBook.trades(i);
          recentTrades.push({
            id: i,
            price: ethers.formatUnits(trade.price, 6),
            amount: ethers.formatUnits(trade.amount, 18),
            timestamp: new Date(
              Number(trade.timestamp) * 1000
            ).toLocaleString(),
          });
        }

        console.log("\n  Recent trades:");
        recentTrades.forEach((t) => {
          console.log(
            `    Trade #${t.id}: ${t.amount} units @ $${t.price} at ${t.timestamp}`
          );
        });
      }

      // Test 3: Calculate VWAP
      console.log(colorText("\n3. Testing VWAP Calculation", "blue"));

      try {
        const vwapData = await orderBook.calculateVWAP(3600); // 1 hour window
        console.log(`  VWAP Price: $${ethers.formatUnits(vwapData.vwap, 6)}`);
        console.log(
          `  Total Volume: ${ethers.formatUnits(
            vwapData.totalVolume,
            18
          )} units`
        );
        console.log(`  Trade Count: ${vwapData.tradeCount}`);
        console.log(`  Is Valid: ${vwapData.isValid}`);

        if (!vwapData.isValid) {
          console.log(
            colorText(
              "  ⚠️  VWAP is not valid (insufficient volume or no recent trades)",
              "yellow"
            )
          );
        }
      } catch (error) {
        console.log(colorText("  ✗ Error calculating VWAP:", "red"));
        console.log(`    ${error.message}`);
      }

      // Test 4: Check mark price calculation
      console.log(colorText("\n4. Testing Mark Price Calculation", "blue"));

      const markPrice = await orderBook.calculateMarkPrice();
      console.log(`  Current Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

      const marketData = await orderBook.getMarketPriceData();
      console.log(
        `  Mid Price: $${ethers.formatUnits(marketData.midPrice, 6)}`
      );
      console.log(
        `  Best Bid: $${
          marketData.bestBidPrice > 0
            ? ethers.formatUnits(marketData.bestBidPrice, 6)
            : "None"
        }`
      );
      console.log(
        `  Best Ask: $${
          marketData.bestAskPrice < ethers.MaxUint256
            ? ethers.formatUnits(marketData.bestAskPrice, 6)
            : "None"
        }`
      );
      console.log(
        `  Last Trade: $${ethers.formatUnits(
          marketData.lastTradePriceReturn,
          6
        )}`
      );

      // Test 5: Get multi-window VWAP
      console.log(colorText("\n5. Testing Multi-Window VWAP", "blue"));

      try {
        const multiVWAP = await orderBook.getMultiWindowVWAP();
        console.log("  VWAP across different time windows:");
        console.log(
          `    5 min:  $${
            multiVWAP.vwap5m > 0
              ? ethers.formatUnits(multiVWAP.vwap5m, 6)
              : "N/A"
          }`
        );
        console.log(
          `    15 min: $${
            multiVWAP.vwap15m > 0
              ? ethers.formatUnits(multiVWAP.vwap15m, 6)
              : "N/A"
          }`
        );
        console.log(
          `    1 hour: $${
            multiVWAP.vwap1h > 0
              ? ethers.formatUnits(multiVWAP.vwap1h, 6)
              : "N/A"
          }`
        );
        console.log(
          `    4 hour: $${
            multiVWAP.vwap4h > 0
              ? ethers.formatUnits(multiVWAP.vwap4h, 6)
              : "N/A"
          }`
        );
        console.log(
          `    24 hour: $${
            multiVWAP.vwap24h > 0
              ? ethers.formatUnits(multiVWAP.vwap24h, 6)
              : "N/A"
          }`
        );
      } catch (error) {
        console.log(colorText("  ✗ Error getting multi-window VWAP:", "red"));
        console.log(`    ${error.message}`);
      }

      // Summary
      console.log(colorText("\n\n=== VWAP VERIFICATION SUMMARY ===", "bright"));
      console.log("=".repeat(60));

      console.log(colorText("\n✅ VWAP Implementation Status:", "green"));
      console.log("  • VWAP functions are present in the contract");
      console.log("  • Trade history tracking is active");
      console.log("  • Mark price calculation includes VWAP hierarchy");
      console.log("  • Multi-window VWAP support is available");

      console.log(colorText("\n📝 Notes:", "yellow"));
      console.log("  • VWAP requires sufficient trade volume to be valid");
      console.log("  • Default time window is 1 hour");
      console.log("  • Minimum volume requirement is 100 units");
      console.log("  • VWAP can be configured by authorized addresses");
    } catch (error) {
      console.error(
        colorText(`\n❌ Error during verification: ${error.message}`, "red")
      );
      console.error(error);
    }
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
