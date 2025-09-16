#!/usr/bin/env node

// fill-order-book.js - Fill the order book with multiple orders and liquidity
//
// 🎯 PURPOSE: Create a realistic order book with multiple buy/sell orders at different price levels
//

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("📚 FILLING ORDER BOOK WITH LIQUIDITY");
  console.log("=".repeat(60));

  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const usdc = await getContract("MOCK_USDC");

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  try {
    // const marketId = await orderBook.marketId();
    // console.log(`📊 Market ID: ${marketId}`);

    // Check initial collateral
    console.log("\n💰 INITIAL COLLATERAL CHECK:");
    console.log("-".repeat(30));

    const users = [deployer, user1, user2, user3];
    const userNames = ["Deployer", "User1", "User2", "User3"];

    // for (let i = 0; i < users.length; i++) {
    //   const collateral = await vault.getAvailableCollateral(users[i].address);
    //   console.log(`${userNames[i]}: ${ethers.formatUnits(collateral, 6)} USDC`);
    // }

    // 1. Create a spread of buy orders (bids) at different price levels
    console.log("\n📈 STEP 1: CREATING BUY ORDERS (BIDS)");
    console.log("-".repeat(50));

    const buyOrders = [
      { user: user1, price: "1.8", amount: "20", name: "User1" },
      { user: user2, price: "1.6", amount: "25", name: "User2" },
      { user: user3, price: "1.4", amount: "15", name: "User3" },
      { user: deployer, price: "1.2", amount: "30", name: "Deployer" },
      { user: user1, price: "1.0", amount: "40", name: "User1" },
    ];

    for (const order of buyOrders) {
      try {
        await orderBook.connect(order.user).placeMarginLimitOrder(
          ethers.parseUnits(order.price, 6),
          ethers.parseUnits(order.amount, 18),
          true // buy
        );
        console.log(
          `✅ ${order.name} placed buy order: ${order.amount} ALU @ $${order.price}`
        );
      } catch (error) {
        console.log(`❌ ${order.name} buy order failed: ${error.message}`);
      }
    }

    // 2. Create a spread of sell orders (asks) at different price levels
    console.log("\n📉 STEP 2: CREATING SELL ORDERS (ASKS)");
    console.log("-".repeat(50));

    const sellOrders = [
      { user: user2, price: "2.0", amount: "18", name: "User2" },
      { user: user3, price: "2.2", amount: "22", name: "User3" },
      { user: deployer, price: "2.4", amount: "16", name: "Deployer" },
      { user: user1, price: "2.6", amount: "28", name: "User1" },
      { user: user2, price: "2.8", amount: "12", name: "User2" },
    ];

    for (const order of sellOrders) {
      try {
        await orderBook.connect(order.user).placeMarginLimitOrder(
          ethers.parseUnits(order.price, 6),
          ethers.parseUnits(order.amount, 18),
          false // sell
        );
        console.log(
          `✅ ${order.name} placed sell order: ${order.amount} ALU @ $${order.price}`
        );
      } catch (error) {
        console.log(`❌ ${order.name} sell order failed: ${error.message}`);
      }
    }

    // 3. Execute some market orders to create positions and trading activity
    console.log("\n🔄 STEP 3: EXECUTING MARKET ORDERS");
    console.log("-".repeat(50));

    // Small market buy to establish positions
    try {
      await orderBook.connect(user3).placeMarginMarketOrder(
        ethers.parseUnits("10", 18), // 10 ALU
        true // buy
      );
      console.log("✅ User3 executed market buy: 10 ALU");
    } catch (error) {
      console.log(`❌ User3 market buy failed: ${error.message}`);
    }

    // Small market sell to create short position
    try {
      await orderBook.connect(user1).placeMarginMarketOrder(
        ethers.parseUnits("8", 18), // 8 ALU
        false // sell
      );
      console.log("✅ User1 executed market sell: 8 ALU");
    } catch (error) {
      console.log(`❌ User1 market sell failed: ${error.message}`);
    }

    // 4. Display current order book state
    console.log("\n📊 STEP 4: ORDER BOOK STATE");
    console.log("-".repeat(50));

    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    const markPrice = await orderBook.calculateMarkPrice();
    const spread = await orderBook.getSpread();

    console.log(
      `📈 Best Bid: ${
        bestBid === 0n ? "No bids" : "$" + ethers.formatUnits(bestBid, 6)
      }`
    );
    console.log(
      `📉 Best Ask: ${
        bestAsk === ethers.MaxUint256
          ? "No asks"
          : "$" + ethers.formatUnits(bestAsk, 6)
      }`
    );
    console.log(`📊 Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
    console.log(
      `📏 Spread: ${
        spread === ethers.MaxUint256
          ? "No spread"
          : "$" + ethers.formatUnits(spread, 6)
      }`
    );

    // 5. Display user positions
    console.log("\n👥 STEP 5: USER POSITIONS");
    console.log("-".repeat(50));

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const name = userNames[i];

      const position = await vault.getUserPositionByMarket(
        user.address,
        marketId
      );
      const availableCollateral = await vault.getAvailableCollateral(
        user.address
      );
      const totalMarginUsed = await vault.getTotalMarginUsed(user.address);

      console.log(`\n👤 ${name}:`);
      console.log(`   Position: ${ethers.formatUnits(position.size, 18)} ALU`);
      console.log(
        `   Entry Price: $${ethers.formatUnits(position.entryPrice, 6)}`
      );
      console.log(
        `   Available Collateral: $${ethers.formatUnits(
          availableCollateral,
          6
        )}`
      );
      console.log(
        `   Total Margin Used: $${ethers.formatUnits(totalMarginUsed, 6)}`
      );
    }

    // 6. Display active traders
    console.log("\n🎯 STEP 6: ACTIVE TRADERS");
    console.log("-".repeat(50));

    const activeTraders = await orderBook.getActiveTraders();
    console.log(`👥 Active Traders Count: ${activeTraders.length}`);

    for (let i = 0; i < activeTraders.length; i++) {
      const trader = activeTraders[i];
      const position = await vault.getUserPositionByMarket(trader, marketId);
      const shortAddr =
        trader.substring(0, 8) + "..." + trader.substring(trader.length - 6);
      console.log(
        `   ${i + 1}. ${shortAddr} -> ${ethers.formatUnits(
          position.size,
          18
        )} ALU`
      );
    }

    console.log("\n🎉 ORDER BOOK SUCCESSFULLY FILLED!");
    console.log("✅ Multiple buy and sell orders at different price levels");
    console.log("✅ Active positions created through market orders");
    console.log("✅ Realistic trading environment established");
    console.log(
      "\n💡 You can now use the interactive trader to see the full order book!"
    );
  } catch (error) {
    console.error("❌ Error filling order book:", error.message);
    if (error.reason) {
      console.error("Revert reason:", error.reason);
    }
  }

  console.log("\n📚 ORDER BOOK FILLING COMPLETE");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });

