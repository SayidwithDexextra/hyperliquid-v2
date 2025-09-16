#!/usr/bin/env node

// place-orders-config.js - Place exact orders using config file and interactive trader functions
//
// 🎯 ORDER SEQUENCE (same functions as interactive trader):
// 1. Deployer: Limit BUY at $1.00 for 10 units
// 2. User3: Market SELL consuming 10 units
// 3. User3: Limit SELL at $2.50 for 15 units

const { ethers } = require("hardhat");
const {
  getContract,
  MARKET_INFO,
  CONTRACT_ADDRESSES,
} = require("./config/contracts");

async function main() {
  console.log("📋 PLACING ORDERS USING CONFIG & INTERACTIVE TRADER METHODS");
  console.log("=".repeat(70));

  // Load contracts exactly like interactive trader
  console.log("🔧 Loading contracts from config...");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const vault = await getContract("CENTRALIZED_VAULT");
  const mockUSDC = await getContract("MOCK_USDC");

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  // Display configuration info (like interactive trader)
  console.log(`\n📊 CONTRACT CONFIGURATION:`);
  console.log(`   OrderBook: ${await orderBook.getAddress()}`);
  console.log(`   Vault: ${await vault.getAddress()}`);
  console.log(`   USDC: ${await mockUSDC.getAddress()}`);

  console.log(`\n🏭 MARKET INFO:`);
  const aluminumMarket = MARKET_INFO.ALUMINUM;
  console.log(`   Symbol: ${aluminumMarket.symbol}`);
  console.log(`   Market ID: ${aluminumMarket.marketId}`);
  console.log(`   OrderBook: ${aluminumMarket.orderBook}`);
  console.log(`   Margin: ${aluminumMarket.marginRequirement}%`);

  console.log(`\n👥 USERS:`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   User3: ${user3.address}`);

  try {
    // ============ ORDER 1: DEPLOYER LIMIT BUY (Interactive Trader Style) ============
    console.log("\n" + "=".repeat(60));
    console.log("📈 ORDER 1: DEPLOYER LIMIT BUY");
    console.log("=".repeat(60));
    console.log("🎯 PLACE BUY LIMIT ORDER (1:1 MARGIN)");
    console.log("💡 1:1 Margin: $100 position requires $100 collateral");

    const buyPrice = "1.0"; // $1.00
    const buyAmount = "10"; // 10 ALU

    console.log(`💰 Price: $${buyPrice} USDC`);
    console.log(`📊 Amount: ${buyAmount} ALU`);

    // Format exactly like interactive trader
    const buyPriceWei = ethers.parseUnits(buyPrice, 6); // 6 decimals for USDC
    const buyAmountWei = ethers.parseUnits(buyAmount, 18); // 18 decimals for token

    console.log("⏳ Placing limit buy order...");

    // Use EXACT same function call as interactive trader
    const tx1 = await orderBook
      .connect(deployer)
      .placeMarginLimitOrder(buyPriceWei, buyAmountWei, true); // true = buy

    console.log("⏳ Transaction submitted...");
    const receipt1 = await tx1.wait();

    console.log("✅ Order placed successfully!");
    console.log(`📄 Transaction: ${tx1.hash}`);
    console.log(`⛽ Gas used: ${receipt1.gasUsed}`);

    // Wait between orders (like interactive trader)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ============ ORDER 2: USER3 MARKET SELL (Interactive Trader Style) ============
    console.log("\n" + "=".repeat(60));
    console.log("📉 ORDER 2: USER3 MARKET SELL");
    console.log("=".repeat(60));
    console.log("🛒 PLACE SELL MARKET ORDER (1:1 MARGIN)");
    console.log("💡 1:1 Margin: Collateral reserved based on execution price");

    const sellAmount1 = "10"; // 10 ALU

    console.log(`📊 Amount: ${sellAmount1} ALU`);
    console.log("🎯 Type: Market sell (consuming buy orders)");

    // Format exactly like interactive trader
    const sellAmount1Wei = ethers.parseUnits(sellAmount1, 18); // 18 decimals for token

    console.log("⏳ Placing market sell order...");

    // Use EXACT same function call as interactive trader (simple version without slippage)
    const tx2 = await orderBook
      .connect(user3)
      .placeMarginMarketOrder(sellAmount1Wei, false); // false = sell

    console.log("⏳ Transaction submitted...");
    const receipt2 = await tx2.wait();

    console.log("✅ Order executed successfully!");
    console.log(`📄 Transaction: ${tx2.hash}`);
    console.log(`⛽ Gas used: ${receipt2.gasUsed}`);

    // Check for trade events (like interactive trader)
    let tradesExecuted = 0;
    for (const log of receipt2.logs) {
      try {
        const decoded = orderBook.interface.parseLog(log);
        if (decoded.name === "TradeExecuted") {
          tradesExecuted++;
          console.log(
            `🔄 Trade executed: ${ethers.formatUnits(
              decoded.args.amount,
              18
            )} ALU @ $${ethers.formatUnits(decoded.args.price, 6)}`
          );
          console.log(`   👤 Buyer: ${decoded.args.buyer}`);
          console.log(`   👤 Seller: ${decoded.args.seller}`);
        }
      } catch (e) {
        // Skip non-orderbook events
      }
    }

    if (tradesExecuted === 0) {
      console.log("⚠️  No immediate trades - order may be pending");
    } else {
      console.log(`✅ ${tradesExecuted} trade(s) executed!`);
    }

    // Wait between orders
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ============ ORDER 3: USER3 LIMIT SELL (Interactive Trader Style) ============
    console.log("\n" + "=".repeat(60));
    console.log("📉 ORDER 3: USER3 LIMIT SELL");
    console.log("=".repeat(60));
    console.log("🎯 PLACE SELL LIMIT ORDER (1:1 MARGIN)");
    console.log("💡 1:1 Margin: $100 position requires $100 collateral");

    const sellPrice = "2.5"; // $2.50
    const sellAmount2 = "15"; // 15 ALU

    console.log(`💰 Price: $${sellPrice} USDC`);
    console.log(`📊 Amount: ${sellAmount2} ALU`);

    // Format exactly like interactive trader
    const sellPriceWei = ethers.parseUnits(sellPrice, 6); // 6 decimals for USDC
    const sellAmount2Wei = ethers.parseUnits(sellAmount2, 18); // 18 decimals for token

    console.log("⏳ Placing limit sell order...");

    // Use EXACT same function call as interactive trader
    const tx3 = await orderBook
      .connect(user3)
      .placeMarginLimitOrder(sellPriceWei, sellAmount2Wei, false); // false = sell

    console.log("⏳ Transaction submitted...");
    const receipt3 = await tx3.wait();

    console.log("✅ Order placed successfully!");
    console.log(`📄 Transaction: ${tx3.hash}`);
    console.log(`⛽ Gas used: ${receipt3.gasUsed}`);

    // ============ FINAL STATUS (Interactive Trader Style) ============
    console.log("\n" + "=".repeat(70));
    console.log("📊 FINAL ORDER PLACEMENT SUMMARY");
    console.log("=".repeat(70));

    console.log("🎉 ALL ORDERS PLACED SUCCESSFULLY!");
    console.log("");
    console.log("📋 ORDER SUMMARY:");
    console.log(
      `✅ Order 1: Deployer limit buy @ $${buyPrice} for ${buyAmount} ALU`
    );
    console.log(`   📄 TX: ${tx1.hash}`);
    console.log(`   ⛽ Gas: ${receipt1.gasUsed}`);
    console.log("");
    console.log(`✅ Order 2: User3 market sell for ${sellAmount1} ALU`);
    console.log(`   📄 TX: ${tx2.hash}`);
    console.log(`   ⛽ Gas: ${receipt2.gasUsed}`);
    if (tradesExecuted > 0) {
      console.log(`   🔄 Trades: ${tradesExecuted} executed`);
    }
    console.log("");
    console.log(
      `✅ Order 3: User3 limit sell @ $${sellPrice} for ${sellAmount2} ALU`
    );
    console.log(`   📄 TX: ${tx3.hash}`);
    console.log(`   ⛽ Gas: ${receipt3.gasUsed}`);
    console.log("");

    console.log("🏭 MARKET CONFIGURATION USED:");
    console.log(`   Symbol: ${aluminumMarket.symbol}`);
    console.log(`   Market ID: ${aluminumMarket.marketId}`);
    console.log(`   OrderBook: ${aluminumMarket.orderBook}`);
    console.log(`   Margin: ${aluminumMarket.marginRequirement}% (1:1 ratio)`);
    console.log("");

    console.log("🔗 CONTRACT ADDRESSES USED:");
    console.log(`   OrderBook: ${await orderBook.getAddress()}`);
    console.log(`   Vault: ${await vault.getAddress()}`);
    console.log(`   USDC: ${await mockUSDC.getAddress()}`);
    console.log("");

    console.log(
      "✨ Use the interactive trader to view order book or place more orders:"
    );
    console.log("   node scripts/interactive-trader.js");
  } catch (error) {
    console.error("❌ Failed to place orders:", error.message);

    // Provide helpful debugging info (like interactive trader)
    if (error.message.includes("insufficient")) {
      console.error("💡 Hint: User may need more collateral");
      console.error("   Run deployment script to fund accounts");
    } else if (error.message.includes("revert")) {
      console.error("💡 Contract reverted - check order parameters");
    } else if (error.message.includes("decode")) {
      console.error("💡 ABI mismatch - try recompiling contracts");
    }

    console.error("\n🔧 Debug info:");
    console.error(`   OrderBook address: ${await orderBook.getAddress()}`);
    console.error(`   Config market: ${MARKET_INFO.ALUMINUM.symbol}`);
    console.error(`   Deployer: ${deployer.address}`);
    console.error(`   User3: ${user3.address}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });

