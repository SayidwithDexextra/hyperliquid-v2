#!/usr/bin/env node

// debug-pnl.js - Debug unrealized P&L calculation issue

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

async function main() {
  console.log("\n🔍 DEBUGGING UNREALIZED P&L CALCULATION");
  console.log("═".repeat(60));

  try {
    // Get contracts
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Get signers
    const [deployer, user1] = await ethers.getSigners();

    // Check who has positions
    const testUsers = [
      { address: deployer.address, name: "Deployer" },
      { address: user1.address, name: "User 1" },
    ];

    for (const user of testUsers) {
      console.log(`\n📊 Checking ${user.name}: ${user.address}`);
      console.log("─".repeat(60));

      // Get positions
      const positions = await vault.getUserPositions(user.address);
      console.log(`  Positions: ${positions.length}`);

      if (positions.length > 0) {
        for (let i = 0; i < positions.length; i++) {
          const pos = positions[i];
          console.log(`\n  Position ${i + 1}:`);
          console.log(`    Market ID: ${pos.marketId}`);
          console.log(`    Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
          console.log(
            `    Entry Price: ${ethers.formatUnits(pos.entryPrice, 6)} USDC`
          );
          console.log(
            `    Margin Locked: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`
          );

          // Check mark price
          const markPrice = await vault.marketMarkPrices(pos.marketId);
          console.log(
            `    Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`
          );

          // Get market ID for ALU-USD
          const aluMarketSymbol = "ALU-USD";
          const deploymentInfo = require("../deployments/localhost-deployment.json");
          const expectedMarketId = deploymentInfo.aluminumMarket.marketId;
          console.log(`    Expected Market ID: ${expectedMarketId}`);
          console.log(
            `    Market IDs Match: ${pos.marketId === expectedMarketId}`
          );
        }

        // Get margin summary
        const marginSummary = await vault.getMarginSummary(user.address);
        console.log(`\n  Margin Summary:`);
        console.log(
          `    Total Collateral: ${ethers.formatUnits(
            marginSummary.totalCollateral,
            6
          )} USDC`
        );
        console.log(
          `    Margin Used: ${ethers.formatUnits(
            marginSummary.marginUsed,
            6
          )} USDC`
        );
        console.log(
          `    Realized P&L: ${ethers.formatUnits(
            marginSummary.realizedPnL,
            6
          )} USDC`
        );

        // Debug unrealized P&L
        console.log(`\n  🔍 Unrealized P&L Debug:`);
        console.log(`    Raw value: ${marginSummary.unrealizedPnL}`);
        console.log(`    Type: ${typeof marginSummary.unrealizedPnL}`);

        // Try different interpretations
        try {
          // As int256
          const asInt256 = BigInt(marginSummary.unrealizedPnL.toString());
          console.log(`    As BigInt: ${asInt256}`);

          // Check if it's negative by looking at the two's complement
          const MAX_INT256 = BigInt(2) ** BigInt(255) - BigInt(1);
          const isNegative = asInt256 > MAX_INT256;

          if (isNegative) {
            // Convert from two's complement
            const negativeValue = asInt256 - BigInt(2) ** BigInt(256);
            console.log(`    Negative value: ${negativeValue}`);
            console.log(
              `    Formatted: ${ethers.formatUnits(negativeValue, 6)} USDC`
            );
          } else {
            console.log(
              `    Formatted: ${ethers.formatUnits(asInt256, 6)} USDC`
            );
          }

          // Check the actual calculation
          console.log(`\n  📐 P&L Calculation:`);
          const pos = positions[0];
          const markPrice = await vault.marketMarkPrices(pos.marketId);
          const entryPrice = pos.entryPrice;
          const size = pos.size;

          console.log(
            `    Entry Price: ${entryPrice} (${ethers.formatUnits(
              entryPrice,
              6
            )} USDC)`
          );
          console.log(
            `    Mark Price: ${markPrice} (${ethers.formatUnits(
              markPrice,
              6
            )} USDC)`
          );
          console.log(
            `    Position Size: ${size} (${ethers.formatUnits(size, 18)} ALU)`
          );

          if (markPrice === 0n) {
            console.log(`    ⚠️  Mark price is 0 - this causes the huge P&L!`);
            console.log(`    Calculation: (0 - ${entryPrice}) * ${size} / 1e6`);
            const priceDiff = BigInt(0) - BigInt(entryPrice);
            console.log(`    Price Diff: ${priceDiff}`);
            const pnl = (priceDiff * BigInt(size)) / BigInt(1e6);
            console.log(`    P&L: ${pnl}`);
            console.log(
              `    P&L Formatted: ${ethers.formatUnits(pnl, 6)} USDC`
            );
          }
        } catch (e) {
          console.log(`    Error parsing: ${e.message}`);
        }
      }
    }

    // Check OrderBook best prices
    console.log(`\n📈 OrderBook Prices:`);
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`  Best Bid: ${ethers.formatUnits(bestBid, 6)} USDC`);
    console.log(`  Best Ask: ${ethers.formatUnits(bestAsk, 6)} USDC`);

    console.log("\n💡 SOLUTION:");
    console.log("  The mark price needs to be set for proper P&L calculation.");
    console.log("  Either:");
    console.log(
      "  1. Set mark price manually via updateMarkPrice (requires SETTLEMENT_ROLE)"
    );
    console.log("  2. Use OrderBook prices as mark price");
    console.log("  3. Set initial mark price when creating market");
  } catch (error) {
    console.error("\n❌ Debug failed:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
