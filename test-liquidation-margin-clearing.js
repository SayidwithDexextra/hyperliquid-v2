#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

async function main() {
  console.log("\n🔥 TESTING LIQUIDATION & MARGIN CLEARING");
  console.log("═".repeat(80));

  const signers = await ethers.getSigners();
  const user3 = signers[3]; // User with the short position
  const deployer = signers[0]; // For admin functions

  console.log(`\n📋 USER3: ${user3.address}`);
  console.log("─".repeat(60));

  try {
    // Load contracts
    console.log("🔧 Loading smart contracts...");
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Read market ID directly from deployment file (config may be outdated)
    const fs = require("fs");
    const deployment = JSON.parse(
      fs.readFileSync("./deployments/localhost-deployment.json", "utf8")
    );
    const marketId = deployment.aluminumMarket.marketId;

    console.log(`✅ Market: ${deployment.aluminumMarket.symbol}`);
    console.log(`✅ Market ID: ${marketId}`);

    // STEP 1: Check current state (pre-liquidation)
    console.log("\n📊 STEP 1: PRE-LIQUIDATION STATE");
    console.log("─".repeat(40));

    let marginSummary = await vault.getMarginSummary(user3.address);
    let positions = await vault.getUserPositions(user3.address);
    let obPosition = await orderBook.userPositions(user3.address);
    let markPrice = await vault.getMarkPrice(marketId);

    console.log(
      `💰 Margin Locked: ${ethers.formatUnits(
        marginSummary.marginUsed,
        6
      )} USDC`
    );
    console.log(`📊 Vault Positions: ${positions.length}`);
    console.log(
      `📈 OrderBook Position: ${ethers.formatUnits(obPosition, 18)} ALU`
    );
    console.log(`💲 Current Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

    if (positions.length > 0) {
      console.log(
        `   Position: ${ethers.formatUnits(
          positions[0].size,
          18
        )} ALU @ $${ethers.formatUnits(positions[0].entryPrice, 6)}`
      );
      console.log(
        `   Position Margin: ${ethers.formatUnits(
          positions[0].marginLocked,
          6
        )} USDC`
      );
    }

    // STEP 2: Trigger liquidation through market activity
    console.log("\n🔥 STEP 2: TRIGGERING LIQUIDATION");
    console.log("─".repeat(40));

    console.log("💡 Strategy: User1 will place market buy order for 5 ALU");
    console.log("   This will execute against User2's limit sell at $2.50");
    console.log(
      "   Price rise from $1.00 → $2.50 should liquidate User3's short"
    );

    const user1 = signers[1];
    const buyAmount = ethers.parseUnits("5", 18); // 5 ALU

    console.log(`👤 User1: ${user1.address}`);
    console.log(`📦 Market Buy: ${ethers.formatUnits(buyAmount, 18)} ALU`);

    // Place market buy order from User1
    const marketBuyTx = await orderBook.connect(user1).placeMarginMarketOrder(
      buyAmount,
      true // isBuy = true
    );
    await marketBuyTx.wait();
    console.log("✅ Market buy order executed!");

    // Check new market conditions
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`📊 Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
    console.log(`📊 Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);

    // Get updated mark price
    const newMarkPrice = await vault.getMarkPrice(marketId);
    console.log(`💲 New Mark Price: $${ethers.formatUnits(newMarkPrice, 6)}`);

    // Check if liquidation was triggered automatically
    console.log("🔍 Checking if liquidation was triggered automatically...");

    // STEP 3: Check post-liquidation state
    console.log("\n📊 STEP 3: POST-LIQUIDATION STATE");
    console.log("─".repeat(40));

    marginSummary = await vault.getMarginSummary(user3.address);
    positions = await vault.getUserPositions(user3.address);
    obPosition = await orderBook.userPositions(user3.address);
    const liquidatedCount = await vault.getUserLiquidatedPositionsCount(
      user3.address
    );

    console.log(
      `💰 Margin Locked: ${ethers.formatUnits(
        marginSummary.marginUsed,
        6
      )} USDC`
    );
    console.log(`📊 Vault Positions: ${positions.length}`);
    console.log(
      `📈 OrderBook Position: ${ethers.formatUnits(obPosition, 18)} ALU`
    );
    console.log(`🔥 Liquidated Positions: ${liquidatedCount}`);

    // STEP 4: Analysis and issue detection
    console.log("\n🔍 STEP 4: MARGIN CLEARING ANALYSIS");
    console.log("─".repeat(40));

    if (liquidatedCount > 0) {
      console.log("✅ LIQUIDATION OCCURRED!");

      const liquidatedPositions = await vault.getUserLiquidatedPositions(
        user3.address
      );
      for (let i = 0; i < liquidatedPositions.length; i++) {
        const pos = liquidatedPositions[i];
        console.log(`   Liquidation ${i + 1}:`);
        console.log(`     Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
        console.log(
          `     Entry Price: $${ethers.formatUnits(pos.entryPrice, 6)}`
        );
        console.log(
          `     Liquidation Price: $${ethers.formatUnits(
            pos.liquidationPrice,
            6
          )}`
        );
        console.log(
          `     Margin Locked: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`
        );
        console.log(
          `     Margin Lost: ${ethers.formatUnits(pos.marginLost, 6)} USDC`
        );
        console.log(`     Reason: ${pos.reason}`);
      }

      // Check for the margin clearing bug
      if (marginSummary.marginUsed > 0 && positions.length === 0) {
        console.log(
          "\n🔴 BUG DETECTED: MARGIN STILL LOCKED AFTER LIQUIDATION!"
        );
        console.log(
          `   ${ethers.formatUnits(
            marginSummary.marginUsed,
            6
          )} USDC is still locked`
        );
        console.log(`   But user has ${positions.length} active positions`);
        console.log(`   This is the issue you reported!`);

        // Detailed analysis of what's still locked
        console.log("\n🔍 DEBUGGING LOCKED MARGIN:");
        const marginForAluminum = await vault.userMarginByMarket(
          user3.address,
          marketId
        );
        console.log(
          `   userMarginByMarket[ALU]: ${ethers.formatUnits(
            marginForAluminum,
            6
          )} USDC`
        );

        // Check if market ID is still in user's list
        try {
          let marketIndex = 0;
          let foundMarkets = [];
          while (true) {
            try {
              const marketId = await vault.userMarketIds(
                user3.address,
                marketIndex
              );
              const marginForMarket = await vault.userMarginByMarket(
                user3.address,
                marketId
              );
              foundMarkets.push({
                marketId: marketId,
                margin: ethers.formatUnits(marginForMarket, 6),
              });
              marketIndex++;
            } catch (error) {
              break;
            }
          }

          console.log(`   Active market IDs: ${foundMarkets.length}`);
          foundMarkets.forEach((market, i) => {
            console.log(
              `     Market ${i + 1}: ${market.margin} USDC (${market.marketId})`
            );
          });
        } catch (error) {
          console.log(`   Error checking market IDs: ${error.message}`);
        }
      } else if (marginSummary.marginUsed === 0n && positions.length === 0) {
        console.log("\n✅ PERFECT: MARGIN PROPERLY CLEARED AFTER LIQUIDATION!");
        console.log(
          "   No margin locked, no active positions - liquidation cleanup worked correctly"
        );
      } else if (positions.length > 0) {
        console.log("\n🟡 PARTIAL LIQUIDATION OR LIQUIDATION FAILED");
        console.log(`   Still have ${positions.length} active positions`);
        console.log("   This means liquidation didn't complete properly");
      }
    } else {
      console.log("⚠️  NO LIQUIDATION OCCURRED");
      console.log("   Position may not be liquidatable at current price");
      console.log("   Or liquidation logic may have issues");

      // Check if position should be liquidatable
      if (positions.length > 0) {
        const pos = positions[0];
        const entryPrice = pos.entryPrice;
        const currentPrice = newMarkPrice;
        const sizeBN = pos.size;

        console.log("\n📊 LIQUIDATION CRITERIA CHECK:");
        console.log(`   Entry Price: $${ethers.formatUnits(entryPrice, 6)}`);
        console.log(
          `   Current Price: $${ethers.formatUnits(currentPrice, 6)}`
        );
        console.log(`   Position Size: ${ethers.formatUnits(sizeBN, 18)} ALU`);

        if (sizeBN < 0) {
          // Short position - liquidatable when price goes up significantly
          const priceDiff = currentPrice - entryPrice;
          const percentChange = Number((priceDiff * 10000n) / entryPrice) / 100;
          console.log(`   Price Change: +${percentChange.toFixed(2)}%`);

          // User3 sold at $1.00, if new price is $2.50, they have 150% loss on their short
          if (percentChange > 100) {
            console.log(
              `   🔥 Should be liquidatable! (${percentChange.toFixed(
                2
              )}% loss on short)`
            );
          } else if (percentChange > 50) {
            console.log(
              `   ⚠️  May be approaching liquidation (${percentChange.toFixed(
                2
              )}% loss)`
            );
          } else {
            console.log(`   💡 Not yet at liquidation threshold`);
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error during liquidation test:", error.message);
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
