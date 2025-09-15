#!/usr/bin/env node

// fill-orderbook-non-margin.js - Fill Order Book with Non-Margin Orders
//
// 🎯 PURPOSE:
//   Fill the order book with liquidity using regular limit orders (not margin orders)
//   This avoids the margin calculation issues we've been experiencing
//
// 💰 PRICING STRATEGY:
//   - Buy prices: $1.00 to $4.50 (below $5)
//   - Sell prices: $1.50 to $5.00 (above $1)
//   - Order sizes: 0.1 to 2.0 ALU (realistic sizes)
//   - Uses placeLimitOrder instead of placeMarginLimitOrder
//
// 🚀 USAGE:
//   npx hardhat run scripts/fill-orderbook-non-margin.js --network localhost

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

async function fillOrderBookNonMargin() {
  console.log(
    colorText(
      "\n💧 FILLING ORDER BOOK WITH NON-MARGIN ORDERS",
      colors.brightYellow
    )
  );
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCK_USDC");
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

    // Prices from $1 to $5
    const buyPrices = [
      "1.00", // $1.00
      "1.50", // $1.50
      "2.00", // $2.00
      "2.50", // $2.50
      "3.00", // $3.00
      "3.50", // $3.50
      "4.00", // $4.00
      "4.50", // $4.50
    ];

    const sellPrices = [
      "1.50", // $1.50
      "2.00", // $2.00
      "2.50", // $2.50
      "3.00", // $3.00
      "3.50", // $3.50
      "4.00", // $4.00
      "4.50", // $4.50
      "5.00", // $5.00
    ];

    // Order sizes
    const orderSizes = [
      "0.1", // 0.1 ALU
      "0.2", // 0.2 ALU
      "0.5", // 0.5 ALU
      "1.0", // 1.0 ALU
      "2.0", // 2.0 ALU
    ];

    console.log(
      colorText(
        `\n📊 Buy Prices: $${buyPrices[0]} - $${
          buyPrices[buyPrices.length - 1]
        }`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `📊 Sell Prices: $${sellPrices[0]} - $${
          sellPrices[sellPrices.length - 1]
        }`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `📊 Order Sizes: ${orderSizes.join(", ")} ALU`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(
        `📊 Order Type: Regular Limit Orders (No Margin)`,
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
    let buyOrderValue = 0;

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
          // Use regular limit order instead of margin order
          const tx = await orderBook.connect(user).placeLimitOrder(
            price,
            amount,
            true // isBuy
          );
          await tx.wait();
          buyOrderCount++;
          buyOrderValue += parseFloat(ethers.formatUnits(price * amount, 24)); // price * amount in USD
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

    console.log(
      colorText(`   ✅ Placed ${buyOrderCount} buy orders`, colors.green)
    );
    console.log(
      colorText(
        `   💰 Total buy order value: $${buyOrderValue.toFixed(2)}`,
        colors.white
      )
    );

    // Step 3: Place sell orders
    console.log(
      colorText(`\n📊 STEP 3: PLACING SELL ORDERS`, colors.brightCyan)
    );

    let sellOrderCount = 0;
    let sellOrderValue = 0;

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
          // Use regular limit order instead of margin order
          const tx = await orderBook.connect(user).placeLimitOrder(
            price,
            amount,
            false // isBuy
          );
          await tx.wait();
          sellOrderCount++;
          sellOrderValue += parseFloat(ethers.formatUnits(price * amount, 24)); // price * amount in USD
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
      const depth = await orderBook.getOrderBookDepth(15);

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
    const testAmount = ethers.parseUnits("0.1", 18); // 0.1 ALU

    console.log(
      colorText(
        `   Testing market buy order: ${formatAmount(testAmount)} ALU`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook.connect(testUser).placeMarketOrder(
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
fillOrderBookNonMargin().catch(console.error);
