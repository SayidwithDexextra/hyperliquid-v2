#!/usr/bin/env node

/**
 * 📜 TRADE HISTORY CHECKER
 *
 * This script retrieves and analyzes the trade history to understand
 * how the deployer's position was created.
 */

const { ethers } = require("hardhat");
const contracts = require("../config/contracts");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function formatTimestamp(timestamp) {
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

async function main() {
  console.log(colorText("\n📜 TRADE HISTORY ANALYSIS", colors.bright));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");

    // Get deployment info
    const deploymentInfo = require("../deployments/localhost-deployment.json");
    const marketId = deploymentInfo.aluminumMarket.marketId;
    const deployer = deploymentInfo.deployer;

    console.log(colorText("\n🔍 SEARCHING FOR DEPLOYER TRADES", colors.yellow));
    console.log(`  Deployer Address: ${deployer}`);
    console.log(`  Market ID: ${marketId}`);

    // Get total number of trades
    const totalTrades = await orderBook.totalTradeCount();
    console.log(`  Total Trades in System: ${totalTrades}`);

    // Get all trades (paginated)
    console.log(colorText("\n📊 ALL TRADES IN SYSTEM:", colors.magenta));
    console.log("─".repeat(80));

    let offset = 0;
    const limit = 20; // Get 20 trades at a time
    let allTrades = [];

    while (offset < totalTrades) {
      const [trades, hasMore] = await orderBook.getAllTrades(offset, limit);

      for (const trade of trades) {
        if (trade.tradeId > 0) {
          // Skip empty entries
          allTrades.push(trade);

          const isBuyerDeployer =
            trade.buyer.toLowerCase() === deployer.toLowerCase();
          const isSellerDeployer =
            trade.seller.toLowerCase() === deployer.toLowerCase();

          if (isBuyerDeployer || isSellerDeployer) {
            console.log(colorText(`\n🎯 DEPLOYER TRADE FOUND!`, colors.green));
          }

          console.log(`\nTrade #${trade.tradeId}:`);
          console.log(`  Timestamp: ${formatTimestamp(trade.timestamp)}`);
          console.log(
            `  Buyer: ${trade.buyer}${isBuyerDeployer ? " 👈 DEPLOYER" : ""}`
          );
          console.log(
            `  Seller: ${trade.seller}${isSellerDeployer ? " 👈 DEPLOYER" : ""}`
          );
          console.log(`  Price: $${ethers.formatUnits(trade.price, 6)} USDC`);
          console.log(`  Amount: ${ethers.formatUnits(trade.amount, 18)} ALU`);
          console.log(
            `  Trade Value: $${ethers.formatUnits(trade.tradeValue, 6)} USDC`
          );
          console.log(
            `  Buyer Fee: $${ethers.formatUnits(trade.buyerFee, 6)} USDC`
          );
          console.log(
            `  Seller Fee: $${ethers.formatUnits(trade.sellerFee, 6)} USDC`
          );

          if (isBuyerDeployer) {
            console.log(
              colorText(
                `  → Deployer BOUGHT ${ethers.formatUnits(
                  trade.amount,
                  18
                )} ALU`,
                colors.green
              )
            );
          }
          if (isSellerDeployer) {
            console.log(
              colorText(
                `  → Deployer SOLD ${ethers.formatUnits(trade.amount, 18)} ALU`,
                colors.red
              )
            );
          }
        }
      }

      if (!hasMore) break;
      offset += limit;
    }

    // Get user-specific trades for deployer
    console.log(colorText("\n\n📋 DEPLOYER'S TRADE HISTORY:", colors.yellow));
    console.log("─".repeat(80));

    const deployerTradeCount = await orderBook.getUserTradeCount(deployer);
    console.log(`  Total Trades by Deployer: ${deployerTradeCount}`);

    if (deployerTradeCount > 0) {
      const [deployerTrades] = await orderBook.getUserTrades(deployer, 0, 100);

      let totalBought = 0n;
      let totalSold = 0n;
      let weightedBuyPrice = 0n;
      let weightedSellPrice = 0n;

      for (const trade of deployerTrades) {
        if (trade.tradeId > 0) {
          const isBuyer = trade.buyer.toLowerCase() === deployer.toLowerCase();
          const amount = trade.amount;

          console.log(`\nTrade #${trade.tradeId}:`);
          console.log(`  Role: ${isBuyer ? "BUYER" : "SELLER"}`);
          console.log(`  Price: $${ethers.formatUnits(trade.price, 6)} USDC`);
          console.log(`  Amount: ${ethers.formatUnits(amount, 18)} ALU`);
          console.log(`  Timestamp: ${formatTimestamp(trade.timestamp)}`);

          if (isBuyer) {
            totalBought += amount;
            weightedBuyPrice += amount * trade.price;
          } else {
            totalSold += amount;
            weightedSellPrice += amount * trade.price;
          }
        }
      }

      console.log(colorText("\n📈 POSITION CALCULATION:", colors.cyan));
      console.log(`  Total Bought: ${ethers.formatUnits(totalBought, 18)} ALU`);
      console.log(`  Total Sold: ${ethers.formatUnits(totalSold, 18)} ALU`);
      console.log(
        `  Net Position: ${ethers.formatUnits(totalBought - totalSold, 18)} ALU`
      );

      if (totalSold > totalBought) {
        console.log(colorText(`  → NET SHORT POSITION`, colors.red));

        // Calculate weighted average price for sells
        if (totalSold > 0n) {
          const avgSellPrice = weightedSellPrice / totalSold;
          console.log(
            `  Average Sell Price: $${ethers.formatUnits(avgSellPrice, 6)} USDC`
          );

          // Check if this matches the entry price
          const expectedEntryPrice = ethers.formatUnits(avgSellPrice, 6);
          console.log(colorText(`\n💡 ANALYSIS:`, colors.yellow));
          console.log(`  The entry price of 1.166667 might come from:`);
          console.log(`  - Weighted average of multiple sell orders`);
          console.log(`  - Position netting calculations in the vault`);
          console.log(
            `  - Calculated average sell price: $${expectedEntryPrice}`
          );
        }
      }
    }

    // Check for any position updates from the vault
    console.log(colorText("\n\n🔍 CHECKING POSITION DETAILS:", colors.blue));

    const positions = await vault.getUserPositions(deployer);
    if (positions.length > 0) {
      const pos = positions[0];
      console.log(`  Current Position:`);
      console.log(`    Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(
        `    Entry Price: $${ethers.formatUnits(pos.entryPrice, 6)} USDC`
      );
      console.log(`    Is Long: ${pos.isLong}`);

      // Try to reconstruct how the entry price was calculated
      console.log(colorText(`\n🧮 ENTRY PRICE ANALYSIS:`, colors.magenta));
      console.log(`  Entry price of $1.166667 = 7/6 = $1.16̄`);
      console.log(`  This suggests a calculation like:`);
      console.log(`  - Total volume: 175 USDC`);
      console.log(`  - Total amount: 150 ALU`);
      console.log(`  - 175 / 150 = 1.166667`);
      console.log(`  `);
      console.log(`  Or it could be from multiple trades:`);
      console.log(`  - Trade 1: X ALU at price P1`);
      console.log(`  - Trade 2: Y ALU at price P2`);
      console.log(`  - Weighted average: (X*P1 + Y*P2) / (X+Y) = 1.166667`);
    }

    console.log(colorText("\n═".repeat(80), colors.cyan));
  } catch (error) {
    console.error(colorText("\n❌ Error:", colors.red), error.message);
    console.error(error.stack);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
