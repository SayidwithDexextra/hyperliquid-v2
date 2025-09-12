const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

async function main() {
  console.log("\n🔍 Checking User 2's P&L Issue");
  console.log("═".repeat(60));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const factory = await contracts.getContract("FUTURES_MARKET_FACTORY");

    // Get User 2 (third signer)
    const signers = await ethers.getSigners();
    const user2 = signers[2];
    console.log(`\n👤 User 2 Address: ${user2.address}`);

    // Get margin summary
    const marginSummary = await vault.getMarginSummary(user2.address);
    console.log(`\n📊 Margin Summary:`);
    console.log(
      `   Total Collateral: ${ethers.formatUnits(
        marginSummary.totalCollateral,
        6
      )} USDC`
    );
    console.log(
      `   Margin Used: ${ethers.formatUnits(marginSummary.marginUsed, 6)} USDC`
    );
    console.log(
      `   Margin Reserved: ${ethers.formatUnits(
        marginSummary.marginReserved,
        6
      )} USDC`
    );
    console.log(
      `   Available Collateral: ${ethers.formatUnits(
        marginSummary.availableCollateral,
        6
      )} USDC`
    );
    console.log(`   Unrealized P&L (raw): ${marginSummary.unrealizedPnL}`);
    console.log(
      `   Unrealized P&L (formatted): ${ethers.formatUnits(
        marginSummary.unrealizedPnL,
        6
      )} USDC`
    );

    // Get positions
    const positions = await vault.getUserPositions(user2.address);
    console.log(`\n📈 Positions (${positions.length}):`);

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const positionSizeBigInt = BigInt(position.size.toString());
      const isLong = positionSizeBigInt >= 0n;
      const absSize = isLong ? positionSizeBigInt : -positionSizeBigInt;
      const size = ethers.formatUnits(absSize, 18);
      const entryPrice = ethers.formatUnits(position.entryPrice, 6);

      console.log(`\n   Position ${i + 1}:`);
      console.log(`   - Market ID: ${position.marketId}`);
      console.log(`   - Raw Size: ${position.size}`);
      console.log(`   - Side: ${isLong ? "LONG" : "SHORT"}`);
      console.log(`   - Size: ${size} ALU`);
      console.log(`   - Entry Price: $${entryPrice} USDC`);

      // Get current mark price
      const markPrice = await vault.marketMarkPrices(position.marketId);
      console.log(
        `   - Current Mark Price: $${ethers.formatUnits(markPrice, 6)} USDC`
      );

      // Calculate P&L manually
      const sizeNum = parseFloat(size);
      const entryPriceNum = parseFloat(entryPrice);
      const markPriceNum = parseFloat(ethers.formatUnits(markPrice, 6));

      let pnl;
      if (isLong) {
        pnl = (markPriceNum - entryPriceNum) * sizeNum;
      } else {
        pnl = (entryPriceNum - markPriceNum) * sizeNum;
      }

      console.log(`   - Calculated P&L: $${pnl.toFixed(2)} USDC`);
      console.log(
        `   - P&L Calculation: ${isLong ? "LONG" : "SHORT"} (${
          isLong ? markPriceNum : entryPriceNum
        } - ${isLong ? entryPriceNum : markPriceNum}) × ${sizeNum}`
      );
    }

    // Check the actual P&L calculation in the contract
    const unrealizedPnL = await vault.getUnrealizedPnL(user2.address);
    console.log(`\n🔍 Direct Contract P&L Query:`);
    console.log(`   Raw value: ${unrealizedPnL}`);
    console.log(`   Formatted: ${ethers.formatUnits(unrealizedPnL, 6)} USDC`);

    // Get deployment info to check market ID
    const deploymentInfo = require("../deployments/localhost-deployment.json");
    const actualMarketId = deploymentInfo.actualMarketId;
    console.log(`\n📋 Deployment Info:`);
    console.log(`   Actual Market ID: ${actualMarketId}`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("Stack:", error.stack);
  }
}

main().catch(console.error);
