#!/usr/bin/env node

// fill-orderbook-fixed.js - Fixed Order Book Filler with Appropriate Prices
//
// 🎯 PURPOSE:
//   Fill the order book with liquidity at prices that work with the $1.00 mark price
//   Uses prices around the mark price to ensure proper margin calculations
//
// 💰 PRICING STRATEGY:
//   - Mark price: $1.00
//   - Buy prices: $0.50 to $0.95 (below mark price)
//   - Sell prices: $1.05 to $1.50 (above mark price)
//   - Order sizes: 0.1 to 1.0 ALU (realistic sizes)
//
// 🚀 USAGE:
//   npx hardhat run scripts/fill-orderbook-fixed.js --network localhost

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
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(4);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function fillOrderBookFixed() {
  console.log(
    colorText("\n💧 FILLING ORDER BOOK WITH FIXED PRICING", colors.brightYellow)
  );
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCK_USDC");
    const signers = await ethers.getSigners();

    // Use multiple users to create diverse liquidity
    const liquidityProviders = signers.slice(0, 3); // Use first 3 users
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

    // Prices around the $1.00 mark price
    const buyPrices = [
      "0.50", // $0.50
      "0.60", // $0.60
      "0.70", // $0.70
      "0.80", // $0.80
      "0.90", // $0.90
      "0.95", // $0.95
    ];

    const sellPrices = [
      "1.05", // $1.05
      "1.10", // $1.10
      "1.20", // $1.20
      "1.30", // $1.30
      "1.40", // $1.40
      "1.50", // $1.50
    ];

    // Realistic order sizes
    const orderSizes = [
      "0.1", // 0.1 ALU
      "0.2", // 0.2 ALU
      "0.5", // 0.5 ALU
      "1.0", // 1.0 ALU
    ];

    console.log(
      colorText(`\n📊 Buy Prices: ${buyPrices.join(", ")}`, colors.brightCyan)
    );
    console.log(
      colorText(`📊 Sell Prices: ${sellPrices.join(", ")}`, colors.brightCyan)
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

    // Step 2: Place buy orders
    console.log(
      colorText(`\n📊 STEP 2: PLACING BUY ORDERS`, colors.brightCyan)
    );

    let buyOrderCount = 0;
    for (let i = 0; i < buyPrices.length; i++) {
      const price = ethers.parseUnits(buyPrices[i], 6);
      const user = liquidityProviders[i % liquidityProviders.length];

      console.log(
        colorText(
          `   Placing buy orders at $${formatPrice(price)}...`,
          colors.yellow
        )
      );

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
          console.log(
            colorText(
              `     ✅ Buy order: ${formatAmount(amount)} ALU at $${formatPrice(
                price
              )}`,
              colors.green
            )
          );
        } catch (error) {
          console.log(
            colorText(`     ❌ Buy order failed: ${error.message}`, colors.red)
          );
        }
      }
    }

    // Step 3: Place sell orders
    console.log(
      colorText(`\n📊 STEP 3: PLACING SELL ORDERS`, colors.brightCyan)
    );

    let sellOrderCount = 0;
    for (let i = 0; i < sellPrices.length; i++) {
      const price = ethers.parseUnits(sellPrices[i], 6);
      const user = liquidityProviders[i % liquidityProviders.length];

      console.log(
        colorText(
          `   Placing sell orders at $${formatPrice(price)}...`,
          colors.yellow
        )
      );

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
          console.log(
            colorText(
              `     ✅ Sell order: ${formatAmount(
                amount
              )} ALU at $${formatPrice(price)}`,
              colors.green
            )
          );
        } catch (error) {
          console.log(
            colorText(`     ❌ Sell order failed: ${error.message}`, colors.red)
          );
        }
      }
    }

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
      const depth = await orderBook.getOrderBookDepth(10);

      console.log(colorText(`   Buy Orders:`, colors.white));
      if (depth.buyOrders && depth.buyOrders.length > 0) {
        depth.buyOrders.forEach((order, i) => {
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

      console.log(colorText(`   Sell Orders:`, colors.white));
      if (depth.sellOrders && depth.sellOrders.length > 0) {
        depth.sellOrders.forEach((order, i) => {
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
    const testAmount = ethers.parseUnits("0.1", 18); // 0.1 ALU

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
    console.log(colorText(`\n📊 STEP 7: SUMMARY`, colors.brightCyan));

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
        `   Buy Price Range: $${buyPrices[0]} - $${
          buyPrices[buyPrices.length - 1]
        }`,
        colors.white
      )
    );
    console.log(
      colorText(
        `   Sell Price Range: $${sellPrices[0]} - $${
          sellPrices[sellPrices.length - 1]
        }`,
        colors.white
      )
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
      colorText(`\n🎉 ORDER BOOK FILLED SUCCESSFULLY!`, colors.brightGreen)
    );
    console.log(colorText(`   Ready for liquidation testing`, colors.white));
    console.log(
      colorText(
        `   Run: npx hardhat run scripts/test-liquidation-with-filled-book.js --network localhost`,
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
fillOrderBookFixed().catch(console.error);
