#!/usr/bin/env node

// fill-orderbook-comprehensive.js - Comprehensive Order Book Filler
//
// 🎯 PURPOSE:
//   Fill the order book with comprehensive liquidity across many price levels
//   to create a realistic trading environment for liquidation testing
//
// 💰 PRICING STRATEGY:
//   - Base price: $1.00 (1 dollar)
//   - Price range: $0.50 to $2.00 (wide spread)
//   - Order sizes: 0.1 to 10 ALU (realistic sizes)
//   - Price levels: Every $0.05 from $0.50 to $2.00
//   - Both buy and sell orders at each level
//
// 🚀 USAGE:
//   node scripts/fill-orderbook-comprehensive.js
//   npx hardhat run scripts/fill-orderbook-comprehensive.js --network localhost

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(2);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(2);
}

async function fillOrderBookComprehensive() {
  console.log(
    colorText(
      "\n💧 FILLING ORDER BOOK WITH COMPREHENSIVE LIQUIDITY",
      colors.brightYellow
    )
  );
  console.log(colorText("═".repeat(70), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCKUSDC");
    const signers = await ethers.getSigners();

    // Use multiple users to create diverse liquidity
    const liquidityProviders = signers.slice(0, 4); // Use first 4 users
    const liquidator = signers[0]; // Deployer as liquidator

    console.log(
      colorText(
        `\n👥 Liquidity Providers: ${liquidityProviders.length}`,
        colors.brightCyan
      )
    );
    liquidityProviders.forEach((user, i) => {
      console.log(colorText(`   ${i + 1}. ${user.address}`, colors.white));
    });

    // Generate comprehensive price levels ($0.50 to $2.00, every $0.05)
    const priceLevels = [];
    for (let i = 50; i <= 200; i += 5) {
      priceLevels.push((i / 100).toFixed(2));
    }

    // Realistic order sizes (in ALU)
    const orderSizes = [
      "0.1", // 0.1 ALU
      "0.5", // 0.5 ALU
      "1.0", // 1.0 ALU
      "2.0", // 2.0 ALU
      "5.0", // 5.0 ALU
      "10.0", // 10.0 ALU
    ];

    console.log(
      colorText(
        `\n📊 Price Range: $${priceLevels[0]} - $${
          priceLevels[priceLevels.length - 1]
        }`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `📊 Price Levels: ${priceLevels.length} levels (every $0.05)`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `📊 Order Sizes: ${orderSizes.join(", ")} ALU`,
        colors.brightCyan
      )
    );

    // Step 1: Check initial order book state
    console.log(
      colorText(
        `\n📊 STEP 1: CHECKING INITIAL ORDER BOOK STATE`,
        colors.brightCyan
      )
    );

    const initialBestBid = await orderBook.bestBid();
    const initialBestAsk = await orderBook.bestAsk();
    const initialMarkPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Best Bid: ${
          initialBestBid > 0n ? `$${formatPrice(initialBestBid)}` : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Best Ask: ${
          initialBestAsk < ethers.MaxUint256
            ? `$${formatPrice(initialBestAsk)}`
            : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Mark Price: $${formatPrice(initialMarkPrice)}`,
        colors.white
      )
    );

    // Step 2: Place buy orders at each price level
    console.log(
      colorText(`\n📊 STEP 2: PLACING BUY ORDERS`, colors.brightCyan)
    );

    let buyOrderCount = 0;
    let buyOrderValue = 0;

    for (let i = 0; i < priceLevels.length; i++) {
      const price = ethers.parseUnits(priceLevels[i], 6);
      const user = liquidityProviders[i % liquidityProviders.length];

      if (i % 10 === 0) {
        console.log(
          colorText(
            `   Progress: ${i + 1}/${priceLevels.length} price levels...`,
            colors.yellow
          )
        );
      }

      for (let j = 0; j < orderSizes.length; j++) {
        const amount = ethers.parseUnits(orderSizes[j], 18);

        try {
          const tx = await orderBook.connect(user).placeMarginLimitOrder(
            price,
            amount,
            true // isBuy
          );
          await tx.wait();
          buyOrderCount++;
          buyOrderValue += parseFloat(ethers.formatUnits(price * amount, 24)); // price * amount in USD
        } catch (error) {
          // Silently continue on errors to avoid spam
        }
      }
    }

    console.log(
      colorText(`   ✅ Placed ${buyOrderCount} buy orders`, colors.green)
    );
    console.log(
      colorText(
        `   💰 Total buy order value: $${buyOrderValue.toFixed(2)}`,
        colors.white
      )
    );

    // Step 3: Place sell orders at each price level
    console.log(
      colorText(`\n📊 STEP 3: PLACING SELL ORDERS`, colors.brightCyan)
    );

    let sellOrderCount = 0;
    let sellOrderValue = 0;

    for (let i = 0; i < priceLevels.length; i++) {
      const price = ethers.parseUnits(priceLevels[i], 6);
      const user = liquidityProviders[i % liquidityProviders.length];

      if (i % 10 === 0) {
        console.log(
          colorText(
            `   Progress: ${i + 1}/${priceLevels.length} price levels...`,
            colors.yellow
          )
        );
      }

      for (let j = 0; j < orderSizes.length; j++) {
        const amount = ethers.parseUnits(orderSizes[j], 18);

        try {
          const tx = await orderBook.connect(user).placeMarginLimitOrder(
            price,
            amount,
            false // isBuy
          );
          await tx.wait();
          sellOrderCount++;
          sellOrderValue += parseFloat(ethers.formatUnits(price * amount, 24)); // price * amount in USD
        } catch (error) {
          // Silently continue on errors to avoid spam
        }
      }
    }

    console.log(
      colorText(`   ✅ Placed ${sellOrderCount} sell orders`, colors.green)
    );
    console.log(
      colorText(
        `   💰 Total sell order value: $${sellOrderValue.toFixed(2)}`,
        colors.white
      )
    );

    // Step 4: Check final order book state
    console.log(
      colorText(
        `\n📊 STEP 4: CHECKING FINAL ORDER BOOK STATE`,
        colors.brightCyan
      )
    );

    const finalBestBid = await orderBook.bestBid();
    const finalBestAsk = await orderBook.bestAsk();
    const finalMarkPrice = await orderBook.getMarkPrice();

    console.log(
      colorText(
        `   Best Bid: ${
          finalBestBid > 0n ? `$${formatPrice(finalBestBid)}` : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Best Ask: ${
          finalBestAsk < ethers.MaxUint256
            ? `$${formatPrice(finalBestAsk)}`
            : "None"
        }`,
        colors.white
      )
    );
    console.log(
      colorText(`   Mark Price: $${formatPrice(finalMarkPrice)}`, colors.white)
    );

    // Step 5: Get order book depth
    console.log(colorText(`\n📊 STEP 5: ORDER BOOK DEPTH`, colors.brightCyan));

    try {
      const depth = await orderBook.getOrderBookDepth(20);

      console.log(colorText(`   Top 10 Buy Orders:`, colors.white));
      if (depth.buyOrders && depth.buyOrders.length > 0) {
        depth.buyOrders.slice(0, 10).forEach((order, i) => {
          console.log(
            colorText(
              `     ${i + 1}. $${formatPrice(order.price)} - ${formatAmount(
                order.amount
              )} ALU`,
              colors.white
            )
          );
        });
      } else {
        console.log(colorText(`     No buy orders found`, colors.dim));
      }

      console.log(colorText(`   Top 10 Sell Orders:`, colors.white));
      if (depth.sellOrders && depth.sellOrders.length > 0) {
        depth.sellOrders.slice(0, 10).forEach((order, i) => {
          console.log(
            colorText(
              `     ${i + 1}. $${formatPrice(order.price)} - ${formatAmount(
                order.amount
              )} ALU`,
              colors.white
            )
          );
        });
      } else {
        console.log(colorText(`     No sell orders found`, colors.dim));
      }
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Could not get order book depth: ${error.message}`,
          colors.red
        )
      );
    }

    // Step 6: Test market order execution
    console.log(
      colorText(
        `\n📊 STEP 6: TESTING MARKET ORDER EXECUTION`,
        colors.brightCyan
      )
    );

    const testUser = liquidityProviders[0];
    const testAmount = ethers.parseUnits("1.0", 18); // 1.0 ALU

    console.log(
      colorText(
        `   Testing market buy order: ${formatAmount(testAmount)} ALU`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook.connect(testUser).placeMarginMarketOrder(
        testAmount,
        true // isBuy
      );
      const receipt = await tx.wait();
      console.log(
        colorText(`   ✅ Market order executed successfully`, colors.green)
      );
      console.log(colorText(`   TX: ${receipt.transactionHash}`, colors.dim));
    } catch (error) {
      console.log(
        colorText(`   ❌ Market order failed: ${error.message}`, colors.red)
      );
    }

    // Step 7: Summary
    console.log(
      colorText(`\n📊 STEP 7: COMPREHENSIVE SUMMARY`, colors.brightCyan)
    );

    console.log(
      colorText(`   Buy Orders Placed: ${buyOrderCount}`, colors.white)
    );
    console.log(
      colorText(`   Sell Orders Placed: ${sellOrderCount}`, colors.white)
    );
    console.log(
      colorText(
        `   Total Orders: ${buyOrderCount + sellOrderCount}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Price Range: $${priceLevels[0]} - $${
          priceLevels[priceLevels.length - 1]
        }`,
        colors.white
      )
    );
    console.log(
      colorText(`   Price Levels: ${priceLevels.length} levels`, colors.white)
    );
    console.log(
      colorText(
        `   Order Size Range: ${orderSizes[0]} - ${
          orderSizes[orderSizes.length - 1]
        } ALU`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Total Buy Value: $${buyOrderValue.toFixed(2)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Total Sell Value: $${sellOrderValue.toFixed(2)}`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Total Liquidity: $${(buyOrderValue + sellOrderValue).toFixed(2)}`,
        colors.white
      )
    );

    console.log(
      colorText(`\n🎉 COMPREHENSIVE ORDER BOOK FILLED!`, colors.brightGreen)
    );
    console.log(
      colorText(`   Ready for advanced liquidation testing`, colors.white)
    );
    console.log(
      colorText(
        `   Run: node scripts/test-liquidation-with-filled-book.js`,
        colors.white
      )
    );
  } catch (error) {
    console.log(
      colorText("❌ Error filling order book: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the script
fillOrderBookComprehensive().catch(console.error);
