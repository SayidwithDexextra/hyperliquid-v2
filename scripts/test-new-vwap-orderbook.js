// test-new-vwap-orderbook.js
// Generated test script for the new VWAP OrderBook

const { ethers } = require("hardhat");

async function main() {
  console.log("\n🧪 Testing New VWAP OrderBook");
  console.log("═".repeat(60));
  
  const [deployer, user1, user2] = await ethers.getSigners();
  
  // Connect to the new OrderBook
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const orderBook = OrderBook.attach("0xB0D4afd8879eD9F52b28595d31B441D079B2Ca07");
  
  // Connect to other contracts
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = MockUSDC.attach("0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E");
  
  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");
  const vault = CentralizedVault.attach("0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690");
  
  console.log("\n📊 Connected to:");
  console.log(`  OrderBook (VWAP): ${await orderBook.getAddress()}`);
  console.log(`  Vault: ${await vault.getAddress()}`);
  console.log(`  USDC: ${await usdc.getAddress()}`);
  
  // Check VWAP configuration
  console.log("\n⚙️  VWAP Configuration:");
  const vwapTimeWindow = await orderBook.vwapTimeWindow();
  const minVolume = await orderBook.minVolumeForVWAP();
  const useVWAP = await orderBook.useVWAPForMarkPrice();
  
  console.log(`  Time Window: ${vwapTimeWindow} seconds`);
  console.log(`  Min Volume: ${ethers.formatUnits(minVolume, 18)} units`);
  console.log(`  Use VWAP: ${useVWAP}`);
  
  // Get current VWAP data
  console.log("\n📈 Current VWAP Data:");
  try {
    const vwapData = await orderBook.calculateVWAP(3600);
    console.log(`  VWAP Price: $${ethers.formatUnits(vwapData.vwap, 6)}`);
    console.log(`  Volume: ${ethers.formatUnits(vwapData.totalVolume, 18)} units`);
    console.log(`  Trade Count: ${vwapData.tradeCount}`);
    console.log(`  Is Valid: ${vwapData.isValid}`);
  } catch (error) {
    console.log("  Error getting VWAP:", error.message);
  }
  
  // Get mark price
  const markPrice = await orderBook.calculateMarkPrice();
  console.log(`\n💰 Current Mark Price: $${ethers.formatUnits(markPrice, 6)}`);
  
  console.log("\n✅ VWAP OrderBook is ready for testing!");
  console.log("\nTo execute trades, ensure:");
  console.log("1. OrderBook has ORDERBOOK_ROLE in vault");
  console.log("2. OrderBook is registered with vault");
  console.log("3. Users have USDC and collateral deposited");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
