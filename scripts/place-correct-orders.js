// place-correct-orders.js - Place orders with correct decimal scaling
const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("../config");

async function main() {
  console.log("📊 PLACING CORRECTLY SCALED ORDERS ON ALUMINUM ORDERBOOK");
  console.log("═".repeat(70));

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

  // Check current order book state
  const currentBestBid = await aluminumOrderBook.bestBid();
  const currentBestAsk = await aluminumOrderBook.bestAsk();

  console.log("\n📊 CURRENT ORDER BOOK STATE:");
  console.log(
    `  Best Bid: $${ethers.utils.formatUnits(
      currentBestBid,
      6
    )} (${currentBestBid.toString()} raw)`
  );
  console.log(
    `  Best Ask: ${
      currentBestAsk.eq(ethers.constants.MaxUint256)
        ? "None"
        : "$" + ethers.utils.formatUnits(currentBestAsk, 6)
    }`
  );

  try {
    console.log("\n🔵 PLACING BUY ORDERS (Correct 6-decimal prices):");

    // User1 places buy order with correct 6-decimal price
    const buyPrice = ethers.utils.parseUnits("2500", 6); // $2500 with 6 decimals
    const buyAmount = ethers.utils.parseUnits("1", 18); // 1 unit with 18 decimals

    console.log(
      `  User1 placing buy: ${ethers.utils.formatUnits(
        buyAmount,
        18
      )} ALU @ $${ethers.utils.formatUnits(buyPrice, 6)}`
    );
    console.log(
      `  Raw values: amount=${buyAmount.toString()}, price=${buyPrice.toString()}`
    );

    const buyTx = await aluminumOrderBook.connect(user1).placeLimitOrder(
      buyPrice,
      buyAmount,
      true // isBuy
    );
    const buyReceipt = await buyTx.wait();
    console.log("  ✅ Buy order placed successfully!");
    console.log(`  Gas used: ${buyReceipt.gasUsed.toString()}`);

    // User2 places sell order with correct 6-decimal price
    console.log("\n🔴 PLACING SELL ORDERS (Correct 6-decimal prices):");

    const sellPrice = ethers.utils.parseUnits("2600", 6); // $2600 with 6 decimals
    const sellAmount = ethers.utils.parseUnits("1", 18); // 1 unit with 18 decimals

    console.log(
      `  User2 placing sell: ${ethers.utils.formatUnits(
        sellAmount,
        18
      )} ALU @ $${ethers.utils.formatUnits(sellPrice, 6)}`
    );
    console.log(
      `  Raw values: amount=${sellAmount.toString()}, price=${sellPrice.toString()}`
    );

    const sellTx = await aluminumOrderBook.connect(user2).placeLimitOrder(
      sellPrice,
      sellAmount,
      false // isSell
    );
    const sellReceipt = await sellTx.wait();
    console.log("  ✅ Sell order placed successfully!");
    console.log(`  Gas used: ${sellReceipt.gasUsed.toString()}`);

    // Check updated order book state
    console.log("\n📊 UPDATED ORDER BOOK STATE:");
    const bestBid = await aluminumOrderBook.bestBid();
    const bestAsk = await aluminumOrderBook.bestAsk();
    const spread = await aluminumOrderBook.getSpread();

    console.log(
      `  Best Bid: $${ethers.utils.formatUnits(
        bestBid,
        6
      )} (raw: ${bestBid.toString()})`
    );
    console.log(
      `  Best Ask: $${ethers.utils.formatUnits(
        bestAsk,
        6
      )} (raw: ${bestAsk.toString()})`
    );
    console.log(`  Spread: $${ethers.utils.formatUnits(spread, 6)}`);

    // Get order book depth
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await aluminumOrderBook.getOrderBookDepth(5);

    console.log("\n📖 ORDER BOOK DEPTH (Correctly Scaled):");
    console.log("  Bids:");
    for (let i = 0; i < bidPrices.length; i++) {
      if (bidPrices[i] > 0) {
        console.log(
          `    $${ethers.utils.formatUnits(
            bidPrices[i],
            6
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
            6
          )} × ${ethers.utils.formatUnits(askAmounts[i], 18)} ALU`
        );
      }
    }

    // Test margin orders
    console.log("\n💼 TESTING MARGIN ORDERS:");

    try {
      const marginBuyPrice = ethers.utils.parseUnits("2450", 6); // $2450
      const marginBuyAmount = ethers.utils.parseUnits("0.5", 18); // 0.5 units

      console.log(
        `  User1 placing margin buy: ${ethers.utils.formatUnits(
          marginBuyAmount,
          18
        )} ALU @ $${ethers.utils.formatUnits(marginBuyPrice, 6)}`
      );

      const marginBuyTx = await aluminumOrderBook
        .connect(user1)
        .placeMarginLimitOrder(marginBuyPrice, marginBuyAmount, true);
      await marginBuyTx.wait();
      console.log("  ✅ Margin buy order placed successfully!");
    } catch (marginError) {
      console.log("  ⚠️ Margin order failed:", marginError.message);
    }

    console.log("\n✅ CORRECTLY SCALED ORDERS PLACED SUCCESSFULLY!");
    console.log("🔄 Run live-orderbook-viewer.js to see the results");
  } catch (error) {
    console.error("❌ Error placing orders:", error.message);
    console.error(error);
  }
}

main().catch(console.error);

