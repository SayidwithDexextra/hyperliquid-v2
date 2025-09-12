// place-direct-orders.js - Place orders directly on OrderBook
const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("../config");

async function main() {
  console.log("📊 PLACING DIRECT ORDERS ON ALUMINUM ORDERBOOK");
  console.log("═".repeat(60));

  const [deployer, user1, user2] = await ethers.getSigners();
  const aluminumOrderBook = await getContract("ALUMINUM_ORDERBOOK");
  const vault = await getContract("CENTRALIZED_VAULT");

  console.log("📋 Contract Information:");
  console.log("  OrderBook:", aluminumOrderBook.address);
  console.log("  Vault:", vault.address);
  console.log("  Market ID:", MARKET_INFO.ALUMINUM.marketId);

  // Check user collateral
  const user1Collateral = await vault.userCollateral(user1.address);
  const user2Collateral = await vault.userCollateral(user2.address);

  console.log("\n💰 User Collateral:");
  console.log(`  User1: $${ethers.utils.formatUnits(user1Collateral, 6)}`);
  console.log(`  User2: $${ethers.utils.formatUnits(user2Collateral, 6)}`);

  try {
    console.log("\n🔵 PLACING BUY ORDERS (Regular Orders):");

    // User1 places buy order
    const buyPrice = ethers.utils.parseUnits("2500", 18); // $2500 with 18 decimals
    const buyAmount = ethers.utils.parseUnits("1", 18); // 1 unit

    console.log(
      `  User1 placing buy: ${ethers.utils.formatUnits(
        buyAmount,
        18
      )} ALU @ $${ethers.utils.formatUnits(buyPrice, 18)}`
    );

    const buyTx = await aluminumOrderBook.connect(user1).placeLimitOrder(
      buyPrice,
      buyAmount,
      true // isBuy
    );
    await buyTx.wait();
    console.log("  ✅ Buy order placed successfully!");

    // User2 places sell order
    console.log("\n🔴 PLACING SELL ORDERS (Regular Orders):");

    const sellPrice = ethers.utils.parseUnits("2600", 18); // $2600 with 18 decimals
    const sellAmount = ethers.utils.parseUnits("1", 18); // 1 unit

    console.log(
      `  User2 placing sell: ${ethers.utils.formatUnits(
        sellAmount,
        18
      )} ALU @ $${ethers.utils.formatUnits(sellPrice, 18)}`
    );

    const sellTx = await aluminumOrderBook.connect(user2).placeLimitOrder(
      sellPrice,
      sellAmount,
      false // isSell
    );
    await sellTx.wait();
    console.log("  ✅ Sell order placed successfully!");

    // Check order book state
    console.log("\n📊 ORDER BOOK STATE:");
    const bestBid = await aluminumOrderBook.bestBid();
    const bestAsk = await aluminumOrderBook.bestAsk();
    const spread = await aluminumOrderBook.getSpread();

    console.log(`  Best Bid: $${ethers.utils.formatUnits(bestBid, 18)}`);
    console.log(
      `  Best Ask: $${
        bestAsk.eq(ethers.constants.MaxUint256)
          ? "None"
          : ethers.utils.formatUnits(bestAsk, 18)
      }`
    );
    console.log(`  Spread: $${ethers.utils.formatUnits(spread, 18)}`);

    // Get order book depth
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await aluminumOrderBook.getOrderBookDepth(5);

    console.log("\n📖 ORDER BOOK DEPTH:");
    console.log("  Bids:");
    for (let i = 0; i < bidPrices.length; i++) {
      if (bidPrices[i] > 0) {
        console.log(
          `    $${ethers.utils.formatUnits(
            bidPrices[i],
            18
          )} × ${ethers.utils.formatUnits(bidAmounts[i], 18)} ALU`
        );
      }
    }

    console.log("  Asks:");
    for (let i = 0; i < askPrices.length; i++) {
      if (askPrices[i] > 0) {
        console.log(
          `    $${ethers.utils.formatUnits(
            askPrices[i],
            18
          )} × ${ethers.utils.formatUnits(askAmounts[i], 18)} ALU`
        );
      }
    }

    console.log("\n✅ DIRECT ORDERS PLACED SUCCESSFULLY!");
    console.log("🔄 Run live-orderbook-viewer.js to see the results");
  } catch (error) {
    console.error("❌ Error placing direct orders:", error.message);
    console.error(error);
  }
}

main().catch(console.error);

