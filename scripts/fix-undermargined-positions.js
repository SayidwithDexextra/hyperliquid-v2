const { ethers } = require("hardhat");

async function main() {
  const [deployer, user1, user2] = await ethers.getSigners();
  
  // Load deployed contracts
  const deployment = require("../deployments/localhost-deployment.json");
  const vault = await ethers.getContractAt("CentralizedVault", deployment.contracts.CENTRALIZED_VAULT);
  const orderbook = await ethers.getContractAt("OrderBook", deployment.contracts.ALUMINUM_ORDERBOOK);
  
  console.log("\n🔧 FIXING UNDER-MARGINED POSITIONS\n");
  
  // Check if deployer has admin role
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
  const hasAdminRole = await vault.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  console.log(`Deployer has admin role: ${hasAdminRole}`);
  
  // Get all users with positions
  const users = [user1.address, user2.address];
  
  for (const userAddress of users) {
    console.log(`\n📊 Checking positions for ${userAddress}:`);
    
    // Get user positions
    const positions = await vault.getUserPositions(userAddress);
    
    for (const pos of positions) {
      if (pos.size === 0n) continue;
      
      const absSize = pos.size < 0 ? -pos.size : pos.size;
      const expectedMargin = (absSize * pos.entryPrice) / (10n**18n);
      
      console.log(`\nPosition in market ${pos.marketId}:`);
      console.log(`- Size: ${pos.size < 0 ? 'SHORT' : 'LONG'} ${ethers.formatUnits(absSize, 18)} ALU`);
      console.log(`- Entry Price: $${ethers.formatUnits(pos.entryPrice, 6)}`);
      console.log(`- Current Margin: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`);
      console.log(`- Expected Margin: ${ethers.formatUnits(expectedMargin, 6)} USDC`);
      
      if (pos.marginLocked < expectedMargin) {
        const marginDeficit = expectedMargin - pos.marginLocked;
        console.log(`⚠️  Under-margined by: ${ethers.formatUnits(marginDeficit, 6)} USDC`);
        
        // Calculate available collateral
        const availableCollateral = await vault.getAvailableCollateral(userAddress);
        console.log(`- Available Collateral: ${ethers.formatUnits(availableCollateral, 6)} USDC`);
        
        if (availableCollateral >= marginDeficit) {
          console.log("✅ User has sufficient collateral to fix margin");
          
          // Use the recalculatePositionMargin function to fix the margin
          try {
            const marginReqBps = await orderbook.marginRequirementBps();
            console.log(`Recalculating margin with ${marginReqBps} bps requirement...`);
            
            const tx = await vault.recalculatePositionMargin(
              userAddress,
              pos.marketId,
              marginReqBps
            );
            
            await tx.wait();
            console.log(`✅ Margin recalculated for position in tx: ${tx.hash}`);
            
            // Verify the fix
            const updatedPositions = await vault.getUserPositions(userAddress);
            const updatedPos = updatedPositions.find(p => p.marketId === pos.marketId);
            if (updatedPos) {
              console.log(`- New Margin Locked: ${ethers.formatUnits(updatedPos.marginLocked, 6)} USDC`);
            }
          } catch (error) {
            console.error("❌ Failed to recalculate margin:", error.message);
          }
        } else {
          console.log("❌ User has insufficient collateral to fix margin");
          console.log("   User needs to deposit more collateral first");
        }
      } else {
        console.log("✅ Position is correctly margined");
      }
    }
  }
  
  console.log("\n📊 FINAL MARGIN SUMMARY\n");
  
  for (const userAddress of users) {
    const marginSummary = await vault.getMarginSummary(userAddress);
    console.log(`${userAddress}:`);
    console.log(`- Total Collateral: ${ethers.formatUnits(marginSummary.totalCollateral, 6)} USDC`);
    console.log(`- Margin Used: ${ethers.formatUnits(marginSummary.marginUsed, 6)} USDC`);
    console.log(`- Available: ${ethers.formatUnits(marginSummary.availableCollateral, 6)} USDC`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
