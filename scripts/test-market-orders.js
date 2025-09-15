#!/usr/bin/env node

// test-market-orders.js - Test Market Orders and Mark Price Changes
//
// 🎯 PURPOSE:
//   Test if market orders actually change the mark price
//   Verify that our liquidation driver will work correctly
//

const { ethers } = require("hardhat");
const {
  getContract,
  getAddress,
  MARKET_INFO,
  displayFullConfig,
} = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
};

// Helper functions
function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(2);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function testMarketOrders() {
  console.log(`${colors.brightCyan}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                🧪 MARKET ORDER TEST 🧪                      ║"
  );
  console.log(
    "║              Testing Mark Price Changes                     ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log(`${colors.reset}`);

  try {
    // Get contracts
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");

    console.log(
      `${colors.bright}📡 Connected to contracts successfully${colors.reset}\n`
    );

    // Get initial state
    const initialPrice = await orderBook.getMarkPrice();
    const initialBid = await orderBook.bestBid();
    const initialAsk = await orderBook.bestAsk();

    console.log(`${colors.bright}📊 INITIAL STATE${colors.reset}`);
    console.log(`  Mark Price: $${formatPrice(initialPrice)}`);
    console.log(
      `  Best Bid: ${initialBid > 0n ? `$${formatPrice(initialBid)}` : "None"}`
    );
    console.log(
      `  Best Ask: ${
        initialAsk < ethers.MaxUint256 ? `$${formatPrice(initialAsk)}` : "None"
      }`
    );

    // Place a market buy order
    console.log(`\n${colors.bright}🔄 PLACING MARKET BUY ORDER${colors.reset}`);
    const orderSize = ethers.parseUnits("1", 18);

    try {
      const tx = await orderBook.placeMarginMarketOrder(
        orderSize,
        true // isBuy
      );

      const receipt = await tx.wait();
      console.log(`${colors.green}✅ Market buy order executed${colors.reset}`);
      console.log(`   TX: ${receipt.transactionHash}`);
    } catch (error) {
      console.log(
        `${colors.red}❌ Market buy order failed: ${error.message}${colors.reset}`
      );
    }

    // Check state after market buy
    const afterBuyPrice = await orderBook.getMarkPrice();
    const afterBuyBid = await orderBook.bestBid();
    const afterBuyAsk = await orderBook.bestAsk();

    console.log(`\n${colors.bright}📊 STATE AFTER MARKET BUY${colors.reset}`);
    console.log(`  Mark Price: $${formatPrice(afterBuyPrice)}`);
    console.log(
      `  Best Bid: ${
        afterBuyBid > 0n ? `$${formatPrice(afterBuyBid)}` : "None"
      }`
    );
    console.log(
      `  Best Ask: ${
        afterBuyAsk < ethers.MaxUint256
          ? `$${formatPrice(afterBuyAsk)}`
          : "None"
      }`
    );

    // Calculate price change
    const priceChange = afterBuyPrice - initialPrice;
    const priceChangeFloat = parseFloat(ethers.formatUnits(priceChange, 6));
    const percentageChange =
      (priceChangeFloat / parseFloat(ethers.formatUnits(initialPrice, 6))) *
      100;

    console.log(`\n${colors.bright}📈 PRICE CHANGE ANALYSIS${colors.reset}`);
    console.log(`  Initial Price: $${formatPrice(initialPrice)}`);
    console.log(`  After Buy Price: $${formatPrice(afterBuyPrice)}`);
    console.log(`  Price Change: $${formatPrice(priceChange)}`);
    console.log(`  Percentage Change: ${percentageChange.toFixed(2)}%`);

    if (priceChange > 0n) {
      console.log(
        `${colors.green}✅ SUCCESS: Market order changed the mark price!${colors.reset}`
      );
    } else {
      console.log(
        `${colors.yellow}⚠️  Market order did not change mark price${colors.reset}`
      );
    }

    // Place a market sell order
    console.log(
      `\n${colors.bright}🔄 PLACING MARKET SELL ORDER${colors.reset}`
    );

    try {
      const tx = await orderBook.placeMarginMarketOrder(
        orderSize,
        false // isBuy
      );

      const receipt = await tx.wait();
      console.log(
        `${colors.green}✅ Market sell order executed${colors.reset}`
      );
      console.log(`   TX: ${receipt.transactionHash}`);
    } catch (error) {
      console.log(
        `${colors.red}❌ Market sell order failed: ${error.message}${colors.reset}`
      );
    }

    // Check final state
    const finalPrice = await orderBook.getMarkPrice();
    const finalBid = await orderBook.bestBid();
    const finalAsk = await orderBook.bestAsk();

    console.log(`\n${colors.bright}📊 FINAL STATE${colors.reset}`);
    console.log(`  Mark Price: $${formatPrice(finalPrice)}`);
    console.log(
      `  Best Bid: ${finalBid > 0n ? `$${formatPrice(finalBid)}` : "None"}`
    );
    console.log(
      `  Best Ask: ${
        finalAsk < ethers.MaxUint256 ? `$${formatPrice(finalAsk)}` : "None"
      }`
    );

    // Calculate total price change
    const totalPriceChange = finalPrice - initialPrice;
    const totalPriceChangeFloat = parseFloat(
      ethers.formatUnits(totalPriceChange, 6)
    );
    const totalPercentageChange =
      (totalPriceChangeFloat /
        parseFloat(ethers.formatUnits(initialPrice, 6))) *
      100;

    console.log(`\n${colors.bright}📊 TOTAL PRICE CHANGE${colors.reset}`);
    console.log(`  Initial Price: $${formatPrice(initialPrice)}`);
    console.log(`  Final Price: $${formatPrice(finalPrice)}`);
    console.log(`  Total Change: $${formatPrice(totalPriceChange)}`);
    console.log(`  Total Percentage: ${totalPercentageChange.toFixed(2)}%`);

    console.log(
      `\n${colors.brightGreen}🎉 Market order test complete!${colors.reset}`
    );
  } catch (error) {
    console.log(
      `${colors.red}❌ Error in market order test: ${error.message}${colors.reset}`
    );
    console.log(error.stack);
  }
}

// Run the test
testMarketOrders().catch(console.error);
