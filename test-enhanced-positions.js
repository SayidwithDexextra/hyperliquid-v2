// Test script to verify enhanced position system works
const { InteractiveTrader } = require('./scripts/interactive-trader.js');

async function testEnhancedPositions() {
  console.log("🧪 Testing Enhanced Position System...");
  
  try {
    const trader = new InteractiveTrader();
    
    // Test contract loading
    console.log("📋 Loading contracts...");
    await trader.loadContracts();
    
    // Test enhanced position access
    console.log("🔍 Testing enhanced position access...");
    const testAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // User1
    
    // Test the helper function
    const { getUserEnhancedPositions } = require('./scripts/interactive-trader.js');
    const positions = await getUserEnhancedPositions(trader.contracts, testAddress);
    
    console.log(`✅ Successfully fetched ${positions.length} enhanced positions`);
    
    if (positions.length > 0) {
      console.log("📊 Position structure:");
      const pos = positions[0];
      console.log("  - marketId:", pos.marketId);
      console.log("  - size:", pos.size.toString());
      console.log("  - avgEntryPrice:", pos.avgEntryPrice.toString());
      console.log("  - totalMarginPosted:", pos.totalMarginPosted.toString());
      console.log("  - lastUpdateTime:", pos.lastUpdateTime.toString());
      console.log("  - entryCount:", pos.entryCount.toString());
    }
    
    // Test position count
    const positionCount = await trader.contracts.vault.getUserPositionCount(testAddress);
    console.log(`✅ Position count: ${positionCount}`);
    
    console.log("✅ SUCCESS: Enhanced position system working correctly!");
    
    // Clean exit
    if (trader.rl) {
      trader.rl.close();
    }
    process.exit(0);
    
  } catch (error) {
    console.error("❌ FAILED:", error.message);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
}

testEnhancedPositions();

