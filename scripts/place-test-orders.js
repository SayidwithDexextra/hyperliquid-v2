// place-test-orders.js - Place test orders on aluminum market for orderbook viewing
const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("../config");

async function main() {
  console.log("📊 PLACING TEST ORDERS ON ALUMINUM MARKET");
  console.log("═".repeat(60));

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  try {
    // Get contracts from config
    const router = await getContract("TRADING_ROUTER");
    const aluminumMarketId = MARKET_INFO.ALUMINUM.marketId;

    console.log("📋 Market Information:");
    console.log("  Market ID:", aluminumMarketId);
    console.log("  TradingRouter:", router.address);
    console.log("  Users:", [user1.address, user2.address, user3.address]);

    // Place multiple orders to create an interesting orderbook
    console.log("\n🔵 PLACING BUY ORDERS:");

    // User 1: Buy orders at different price levels
    const buyOrders = [
      { user: user1, amount: "10", price: "1.00", desc: "10 ALU @ $1.00" },
      { user: user1, amount: "20", price: "0.98", desc: "20 ALU @ $0.98" },
      { user: user2, amount: "15", price: "0.95", desc: "15 ALU @ $0.95" },
      { user: user3, amount: "25", price: "0.92", desc: "25 ALU @ $0.92" },
    ];

    for (const order of buyOrders) {
      try {
        const tx = await router.connect(order.user).placeLimitOrder(
          aluminumMarketId,
          0, // BUY
          ethers.utils.parseUnits(order.amount, 18),
          ethers.utils.parseUnits(order.price, 6),
          ethers.utils.parseUnits("1", 18), // 1x leverage
          0 // no expiry
        );
        await tx.wait();
        console.log(`  ✅ ${order.desc} (${tx.hash.slice(0, 10)}...)`);
      } catch (error) {
        console.log(`  ❌ Failed ${order.desc}: ${error.message}`);
      }
    }

    console.log("\n🔴 PLACING SELL ORDERS:");

    // User 2 & 3: Sell orders at different price levels
    const sellOrders = [
      { user: user2, amount: "8", price: "1.05", desc: "8 ALU @ $1.05" },
      { user: user2, amount: "12", price: "1.08", desc: "12 ALU @ $1.08" },
      { user: user3, amount: "18", price: "1.12", desc: "18 ALU @ $1.12" },
      { user: user3, amount: "22", price: "1.15", desc: "22 ALU @ $1.15" },
    ];

    for (const order of sellOrders) {
      try {
        const tx = await router.connect(order.user).placeLimitOrder(
          aluminumMarketId,
          1, // SELL
          ethers.utils.parseUnits(order.amount, 18),
          ethers.utils.parseUnits(order.price, 6),
          ethers.utils.parseUnits("1", 18), // 1x leverage
          0 // no expiry
        );
        await tx.wait();
        console.log(`  ✅ ${order.desc} (${tx.hash.slice(0, 10)}...)`);
      } catch (error) {
        console.log(`  ❌ Failed ${order.desc}: ${error.message}`);
      }
    }

    console.log("\n🎉 TEST ORDERS PLACEMENT COMPLETED!");
    console.log("═".repeat(60));
    console.log("📊 Order Summary:");
    console.log("  Buy Orders: 4 orders at $0.92 - $1.00");
    console.log("  Sell Orders: 4 orders at $1.05 - $1.15");
    console.log("  Total Volume: ~95 ALU units");
    console.log("═".repeat(60));
    console.log("🔍 Run the live orderbook viewer to see the results:");
    console.log(
      "  npx hardhat run scripts/live-orderbook-viewer.js --network localhost"
    );
    console.log("═".repeat(60));
  } catch (error) {
    console.error("❌ Failed to place test orders:", error.message);
    throw error;
  }
}

main()
  .then(() => {
    console.log("\n✨ Test orders placed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error.message);
    process.exit(1);
  });
