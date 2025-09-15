#!/usr/bin/env node

// fill-orderbook-small.js - Fill Order Book with Small Prices and Amounts
//
// 🎯 PURPOSE:
//   Fill the order book with liquidity at very small prices and unit amounts
//   to test liquidation functionality with minimal capital requirements
//
// 💰 PRICING STRATEGY:
//   - Base price: $0.01 (1 cent)
//   - Order sizes: 0.001 to 0.01 ALU (very small)
//   - Price levels: 0.005, 0.01, 0.015, 0.02, 0.025, 0.03
//   - Both buy and sell orders at each level
//
// 🚀 USAGE:
//   node scripts/fill-orderbook-small.js
//   npx hardhat run scripts/fill-orderbook-small.js --network localhost

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
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(6);
}

async function fillOrderBookSmall() {
  console.log(
    colorText(
      "\n💧 FILLING ORDER BOOK WITH SMALL LIQUIDITY",
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

    // Small price levels (in cents)
    const priceLevels = [
      "0.005", // $0.005
      "0.01", // $0.01
      "0.015", // $0.015
      "0.02", // $0.02
      "0.025", // $0.025
      "0.03", // $0.03
    ];

    // Small order sizes (in ALU)
    const orderSizes = [
      "0.001", // 0.001 ALU
      "0.002", // 0.002 ALU
      "0.005", // 0.005 ALU
      "0.01", // 0.01 ALU
    ];

    console.log(
      colorText(
        `\n📊 Price Levels: ${priceLevels.join(", ")}`,
        colors.brightCyan
      )
    );
    console.log(
      colorText(`📊 Order Sizes: ${orderSizes.join(", ")}`, colors.brightCyan)
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
    for (let i = 0; i < priceLevels.length; i++) {
      const price = ethers.parseUnits(priceLevels[i], 6);
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

    // Step 3: Place sell orders at each price level
    console.log(
      colorText(`\n📊 STEP 3: PLACING SELL ORDERS`, colors.brightCyan)
    );

    let sellOrderCount = 0;
    for (let i = 0; i < priceLevels.length; i++) {
      const price = ethers.parseUnits(priceLevels[i], 6);
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

    // Step 6: Summary
    console.log(colorText(`\n📊 STEP 6: SUMMARY`, colors.brightCyan));

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
      colorText(
        `   Order Size Range: ${orderSizes[0]} - ${
          orderSizes[orderSizes.length - 1]
        } ALU`,
        colors.white
      )
    );

    // Step 7: Test small position creation
    console.log(
      colorText(
        `\n📊 STEP 7: TESTING SMALL POSITION CREATION`,
        colors.brightCyan
      )
    );

    const testUser = liquidityProviders[0];
    const testAmount = ethers.parseUnits("0.01", 18); // 0.01 ALU
    const testPrice = ethers.parseUnits("0.02", 6); // $0.02

    console.log(
      colorText(
        `   Creating test position: ${formatAmount(
          testAmount
        )} ALU at $${formatPrice(testPrice)}`,
        colors.yellow
      )
    );

    try {
      const tx = await orderBook.connect(testUser).placeMarginLimitOrder(
        testPrice,
        testAmount,
        true // isBuy
      );
      await tx.wait();
      console.log(
        colorText(`   ✅ Test position created successfully`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ Test position creation failed: ${error.message}`,
          colors.red
        )
      );
    }

    console.log(
      colorText(`\n🎉 ORDER BOOK FILLED SUCCESSFULLY!`, colors.brightGreen)
    );
    console.log(colorText(`   Ready for liquidation testing`, colors.white));
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
fillOrderBookSmall().catch(console.error);
