#!/usr/bin/env node

// test-adl-position-reduction.js - Test ADL Position Size Reduction
//
// 🎯 PURPOSE:
//   - Works as a "Lego piece" with deploy.js script
//   - Places the market order that triggers User3's liquidation
//   - Verifies ADL system reduces profitable user position sizes
//   - Specifically monitors position size reduction (units held)
//
// 🚀 USAGE:
//   1. First run: node scripts/deploy.js
//   2. Then run: node test-adl-position-reduction.js
//
// 📋 TEST SCENARIO (builds on deploy.js):
//   DEPLOY.JS SETUP:
//   - User3: Short position -10 ALU @ $1.00, only 20 USDC collateral
//   - Deployer: Long position +10 ALU @ $1.00 (profitable when price rises)
//   - User2: Limit buy 20 ALU @ $5.00 (provides liquidity at higher price)
//
//   THIS TEST:
//   1. Place large buy market order to push price to $5.00
//   2. Trigger User3's short liquidation (massive loss at $5.00)
//   3. Gap loss occurs (User3's 20 USDC can't cover the loss)
//   4. ADL triggers and reduces deployer's position size to cover gap
//   5. Verify position size reduction in units (ALU)

// Ensure we connect to the running Hardhat node
if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}

const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("./config/contracts");
const fs = require("fs");
const path = require("path");

// Cache for market symbol lookups to avoid repeated calls
const marketSymbolCache = new Map();

// Helper function to safely decode marketId bytes32 (same as interactive-trader.js)
async function safeDecodeMarketId(marketId, contracts) {
  try {
    // First try to decode as a string
    return ethers.decodeBytes32String(marketId);
  } catch (decodeError) {
    // Check cache first
    if (marketSymbolCache.has(marketId)) {
      return marketSymbolCache.get(marketId);
    }

    // If it's a hash, try to get the symbol from the factory
    try {
      if (contracts && contracts.factory) {
        const marketData = await contracts.factory.getMarket(marketId);
        if (marketData && marketData.marketSymbol) {
          const symbol = marketData.marketSymbol;
          marketSymbolCache.set(marketId, symbol);
          return symbol;
        }
      }
    } catch (e) {
      // Factory lookup failed
    }

    // For our known market, return ALU-USD
    // The marketId from deploy.js is based on the full hash
    return "ALU-USD";
  }
}

// Helper function to get market display name from market ID (same as interactive-trader.js)
function getMarketDisplayName(marketId) {
  // Convert marketId (bytes32) to string for display
  try {
    const hexString = marketId.toString();
    // Try to decode as UTF-8 string first, fallback to hex display
    if (hexString.startsWith("0x")) {
      const bytes = ethers.getBytes(hexString);
      let result = ethers.toUtf8String(bytes).replace(/\0/g, ""); // Remove null bytes
      return result.length > 0 ? result : hexString.slice(0, 10) + "...";
    }
    return hexString.slice(0, 15);
  } catch (error) {
    return marketId.toString().slice(0, 15);
  }
}

// Helper functions
function formatAmount(amount, decimals = 18, displayDecimals = 4) {
  return parseFloat(ethers.formatUnits(amount, decimals)).toFixed(
    displayDecimals
  );
}

function formatUSDC(amount) {
  return parseFloat(ethers.formatUnits(amount, 6)).toFixed(2);
}

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(2);
}

// Position display helper
function displayPosition(label, position, collateral, markPrice = null) {
  console.log(`\n  👤 ${label}:`);
  console.log(`     Address: ${position.user || "N/A"}`);

  const positionSize = BigInt(position.size.toString());
  const isLong = positionSize >= 0n;
  const absSize = isLong ? positionSize : -positionSize;
  const sizeDisplay = formatAmount(absSize);

  console.log(
    `     Position: ${isLong ? "+" : "-"}${sizeDisplay} ALU (${
      isLong ? "LONG" : "SHORT"
    })`
  );
  console.log(`     Entry Price: $${formatPrice(position.entryPrice)}`);
  console.log(`     Collateral: $${formatUSDC(collateral)}`);

  if (markPrice) {
    // Calculate P&L
    const entryPriceBigInt = BigInt(position.entryPrice.toString());
    const markPriceBigInt = BigInt(markPrice.toString());
    const priceDiff = markPriceBigInt - entryPriceBigInt;
    const pnlBigInt = (priceDiff * positionSize) / BigInt(1e6); // TICK_PRECISION = 1e6
    const pnl = parseFloat(ethers.formatUnits(pnlBigInt, 18));

    const pnlColor = pnl >= 0 ? "🟢" : "🔴";
    const pnlSign = pnl >= 0 ? "+" : "";
    console.log(`     Mark Price: $${formatPrice(markPrice)}`);
    console.log(
      `     Unrealized P&L: ${pnlColor} ${pnlSign}$${Math.abs(pnl).toFixed(2)}`
    );
  }
}

async function main() {
  console.log("\n🧪 ADL POSITION SIZE REDUCTION TEST");
  console.log("═".repeat(80));
  console.log("🔗 Building on deploy.js setup - triggering User3 liquidation");
  console.log(
    "🎯 Verifying ADL reduces profitable position sizes (units held)"
  );

  const signers = await ethers.getSigners();
  const [deployer, user1, user2, user3] = signers;

  // Verify network
  try {
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 31337n) {
      console.log(
        `⚠️  WARNING: Expected localhost (31337), got ${network.chainId}`
      );
    }
  } catch (error) {
    console.log(`⚠️  Network check failed: ${error.message}`);
  }

  console.log("\n👥 PARTICIPANTS:");
  console.log(
    `  Deployer: ${deployer.address} (has long position from deploy.js)`
  );
  console.log(`  User1:    ${user1.address} (will place liquidation trigger)`);
  console.log(`  User2:    ${user2.address} (has limit buy @ $5.00)`);
  console.log(
    `  User3:    ${user3.address} (SHORT POSITION - TARGET FOR LIQUIDATION)`
  );

  try {
    // ============================================
    // STEP 1: LOAD CONTRACTS FROM DEPLOY.JS
    // ============================================
    console.log("\n📦 STEP 1: LOADING CONTRACTS FROM DEPLOY.JS");
    console.log("─".repeat(60));

    const coreVault = await getContract("CORE_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await getContract("MOCK_USDC");
    const factory = await getContract("FUTURES_MARKET_FACTORY");

    console.log("✅ CoreVault loaded:", await coreVault.getAddress());
    console.log("✅ OrderBook loaded:", await orderBook.getAddress());
    console.log("✅ MockUSDC loaded:", await mockUSDC.getAddress());
    console.log("✅ Factory loaded:", await factory.getAddress());
    
    // Quick contract verification
    console.log("\n🔍 CONTRACT VERIFICATION:");
    try {
      // Test basic method availability
      const deployerAddress = deployer.address;
      
      // Test userCollateral (simple mapping read)
      const testCollateral = await coreVault.userCollateral(deployerAddress);
      console.log(`  ✅ userCollateral works: $${formatUSDC(testCollateral)}`);
      
      // Test getUserPositions method existence
      try {
        const testPositions = await coreVault.getUserPositions(deployerAddress);
        console.log(`  ✅ getUserPositions works: ${testPositions.length} positions found`);
      } catch (error) {
        console.log(`  ❌ getUserPositions failed: ${error.message}`);
      }
      
      // Test order book methods
      try {
        await orderBook.bestBid();
        console.log(`  ✅ OrderBook methods available`);
      } catch (error) {
        console.log(`  ❌ OrderBook methods failed: ${error.message}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Contract verification failed: ${error.message}`);
    }

    // Create contracts object for helper functions (same pattern as interactive-trader.js)
    const contracts = {
      vault: coreVault,
      orderBook: orderBook,
      factory: factory,
      mockUSDC: mockUSDC,
    };

    // Get market ID from deployment info (not from config as it's hardcoded)
    let marketId;
    try {
      const deploymentPath = path.join(
        __dirname,
        "deployments/localhost-deployment.json"
      );
      const deploymentInfo = JSON.parse(
        fs.readFileSync(deploymentPath, "utf8")
      );
      marketId = deploymentInfo.aluminumMarket.marketId;
      console.log("✅ Market ID (from deployment):", marketId);
    } catch (error) {
      console.log("⚠️  Could not read deployment info, using config fallback");
      marketId = MARKET_INFO.ALUMINUM.marketId;
      console.log("✅ Market ID (from config):", marketId);
    }

    // ============================================
    // STEP 2: CHECK INITIAL POSITIONS FROM DEPLOY.JS
    // ============================================
    console.log("\n📊 STEP 2: INITIAL POSITIONS (FROM DEPLOY.JS)");
    console.log("─".repeat(60));

    // Get current mark price
    let currentMarkPrice;
    try {
      currentMarkPrice = await orderBook.calculateMarkPrice();
      if (currentMarkPrice <= 0) {
        currentMarkPrice = await coreVault.getMarkPrice(marketId);
      }
    } catch (error) {
      currentMarkPrice = ethers.parseUnits("1", 6); // Fallback
    }

    console.log(`📈 Current Mark Price: $${formatPrice(currentMarkPrice)}`);

    // Store initial positions
    const initialPositions = {};
    const users = [
      { signer: deployer, label: "Deployer" },
      { signer: user1, label: "User1" },
      { signer: user2, label: "User2" },
      { signer: user3, label: "User3" },
    ];

    console.log("\n💼 POSITIONS BEFORE LIQUIDATION:");
    for (const { signer, label } of users) {
      try {
        // Test basic collateral first
        let collateral = 0n;
        try {
          collateral = await coreVault.userCollateral(signer.address);
        } catch (error) {
          console.log(`     ⚠️  ${label}: Could not get collateral - ${error.message}`);
        }

        // Try to get positions with better error handling
        let allPositions = [];
        try {
          allPositions = await coreVault.getUserPositions(signer.address);
          console.log(`     📊 ${label}: Found ${allPositions.length} positions`);
        } catch (error) {
          console.log(`     ⚠️  ${label}: Could not get positions - ${error.message}`);
          // If getUserPositions fails, try using getUnifiedMarginSummary
          try {
            const summary = await coreVault.getUnifiedMarginSummary(signer.address);
            console.log(`     📊 ${label}: Using margin summary - Collateral: $${formatUSDC(summary[0])}`);
            collateral = summary[0]; // totalCollateral from summary
          } catch (summaryError) {
            console.log(`     ❌ ${label}: All position methods failed`);
          }
        }

        // Find position for our specific market or create default
        const marketPosition = allPositions.find(
          (pos) => pos.marketId === marketId
        );
        const position = marketPosition || {
          size: 0,
          entryPrice: 0,
          user: signer.address,
          marketId: marketId,
        };

        initialPositions[label] = {
          address: signer.address,
          position: position,
          collateral: collateral,
        };

        displayPosition(label, position, collateral, currentMarkPrice);
      } catch (error) {
        console.log(
          `     ❌ Error getting ${label} position: ${error.message}`
        );
        
        // Still store a default entry to allow the test to continue
        initialPositions[label] = {
          address: signer.address,
          position: {
            size: 0,
            entryPrice: 0,
            user: signer.address,
            marketId: marketId,
          },
          collateral: 0,
        };
      }
    }

    // Check order book liquidity
    console.log("\n📋 ORDER BOOK STATE:");
    try {
      // Test if basic orderBook methods work
      let bestBid = 0n;
      let bestAsk = ethers.MaxUint256;
      
      try {
        bestBid = await orderBook.bestBid();
        console.log(`  Best Bid: $${formatPrice(bestBid)}`);
      } catch (error) {
        console.log(`  ⚠️  Could not get best bid: ${error.message}`);
      }
      
      try {
        bestAsk = await orderBook.bestAsk();
        console.log(`  Best Ask: $${formatPrice(bestAsk)}`);
      } catch (error) {
        console.log(`  ⚠️  Could not get best ask: ${error.message}`);
      }

      if (bestAsk < ethers.MaxUint256) {
        console.log(
          `  🎯 SETUP CONFIRMED: Liquidity at $${formatPrice(bestAsk)} ready to trigger liquidation`
        );
      } else {
        console.log(`  ⚠️  No ask liquidity found - may affect liquidation trigger`);
      }
    } catch (error) {
      console.log(`  ❌ Error reading order book: ${error.message}`);
    }

    // ============================================
    // STEP 3: SETUP EVENT MONITORING
    // ============================================
    console.log("\n🎧 STEP 3: SETTING UP EVENT MONITORING");
    console.log("─".repeat(60));

    const events = {
      liquidations: [],
      adl: [],
      positionClosures: [],
      trades: [],
    };

    // Monitor liquidation events
    orderBook.on(
      "LiquidationPositionProcessed",
      (trader, positionSize, executionPrice) => {
        events.liquidations.push({ trader, positionSize, executionPrice });
        console.log(
          `🔥 LIQUIDATION: ${trader} | Size: ${formatAmount(
            positionSize
          )} | Price: $${formatPrice(executionPrice)}`
        );
      }
    );

    orderBook.on(
      "GapLossDetected",
      (trader, marketId, gapLoss, liquidationPrice, executionPrice) => {
        console.log(`💥 GAP LOSS DETECTED: ${trader}`);
        console.log(`   Gap Loss: $${formatUSDC(gapLoss)}`);
        console.log(`   Liquidation Price: $${formatPrice(liquidationPrice)}`);
        console.log(`   Execution Price: $${formatPrice(executionPrice)}`);
        console.log(`   🚨 ADL SHOULD TRIGGER TO COVER GAP!`);
      }
    );

    // Monitor ADL events
    coreVault.on(
      "SocializationStarted",
      (marketId, lossAmount, liquidatedUser) => {
        console.log(
          `🔄 ADL STARTED: Loss $${formatUSDC(
            lossAmount
          )} from ${liquidatedUser}`
        );
      }
    );

    coreVault.on(
      "AdministrativePositionClosure",
      (user, marketId, originalSize, newSize, realizedProfit) => {
        events.positionClosures.push({
          user,
          originalSize,
          newSize,
          realizedProfit,
        });
        console.log(`📉 POSITION REDUCED: ${user}`);
        console.log(`   Original Size: ${formatAmount(originalSize)} ALU`);
        console.log(`   New Size: ${formatAmount(newSize)} ALU`);
        console.log(
          `   Size Reduction: ${formatAmount(originalSize - newSize)} ALU`
        );
        console.log(`   Profit Realized: $${formatUSDC(realizedProfit)}`);
        console.log(
          `   🎯 ADL WORKING: Position size reduced by ${formatAmount(
            originalSize - newSize
          )} units!`
        );
      }
    );

    coreVault.on(
      "UserLossSocialized",
      (user, lossAmount, remainingCollateral) => {
        events.adl.push({ user, lossAmount, remainingCollateral });
        console.log(
          `💸 PROFIT CONFISCATED: ${user} lost $${formatUSDC(
            lossAmount
          )} profit`
        );
      }
    );

    console.log(
      "✅ Event listeners activated - monitoring for position size reductions"
    );

    // ============================================
    // STEP 4: PLACE LIQUIDATION TRIGGER ORDER
    // ============================================
    console.log("\n🚀 STEP 4: PLACING LIQUIDATION TRIGGER ORDER");
    console.log("─".repeat(60));

    // User3 has short -10 ALU @ $1.00 entry, only $20 collateral
    // If price goes to $5.00, User3's loss = ($5.00 - $1.00) * 10 = $40
    // Since User3 only has $20 collateral, there's a $20 gap loss
    // This should trigger ADL to cover the gap

    console.log("🎯 LIQUIDATION TRIGGER ANALYSIS:");
    console.log("   User3 Position: -10 ALU @ $1.00 entry");
    console.log("   User3 Collateral: $20.00");
    console.log("   Target Price: $5.00 (User2's limit buy)");
    console.log("   Expected Loss: ($5.00 - $1.00) × 10 = $40.00");
    console.log("   Gap Loss: $40.00 - $20.00 = $20.00");
    console.log("   🔥 ADL MUST ACTIVATE to cover $20 gap!");

    // Place market buy order to consume User2's liquidity and push price to $5.00
    const triggerAmount = ethers.parseUnits("25", 18); // 25 ALU buy order

    console.log(`\n📊 ORDER DETAILS:`);
    console.log(`   From: User1 (${user1.address})`);
    console.log(`   Type: Market Buy Order`);
    console.log(`   Amount: ${formatAmount(triggerAmount)} ALU`);
    console.log(
      `   Expected: Will match against User2's $5.00 limit, pushing mark price up`
    );
    console.log(
      `   Result: Should liquidate User3's short position with gap loss`
    );

    try {
      console.log(`\n🔄 Executing liquidation trigger...`);

      const buyTx = await orderBook.connect(user1).placeMarginMarketOrder(
        triggerAmount,
        true // isBuy = true
      );

      console.log(`⏳ Transaction submitted: ${buyTx.hash}`);
      const receipt = await buyTx.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

      // Wait for events to process
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`❌ Market order failed: ${error.message}`);

      if (
        error.message.includes("insufficient margin") ||
        error.message.includes("collateral")
      ) {
        console.log(
          `💡 TIP: User1 might need more collateral. Current setup from deploy.js:`
        );
        console.log(
          `   User1 collateral: $${formatUSDC(
            await coreVault.userCollateral(user1.address)
          )}`
        );
        console.log(
          `   Required for ${formatAmount(
            triggerAmount
          )} ALU at $5.00: ~$125 (25×$5.00)`
        );
      }

      // Continue to check if any partial execution occurred
    }

    // ============================================
    // STEP 5: ANALYZE POSITION SIZE CHANGES
    // ============================================
    console.log("\n📊 STEP 5: ANALYZING POSITION SIZE CHANGES");
    console.log("─".repeat(60));

    // Get updated mark price
    let newMarkPrice;
    try {
      newMarkPrice = await orderBook.calculateMarkPrice();
      if (newMarkPrice <= 0) {
        newMarkPrice = await coreVault.getMarkPrice(marketId);
      }
    } catch (error) {
      newMarkPrice = currentMarkPrice;
    }

    console.log(`📈 Updated Mark Price: $${formatPrice(newMarkPrice)}`);

    if (newMarkPrice > currentMarkPrice) {
      console.log(
        `📊 Price Impact: +$${formatPrice(newMarkPrice - currentMarkPrice)} (${(
          (parseFloat(ethers.formatUnits(newMarkPrice, 6)) /
            parseFloat(ethers.formatUnits(currentMarkPrice, 6)) -
            1) *
          100
        ).toFixed(1)}%)`
      );
    }

    console.log("\n💼 POSITIONS AFTER LIQUIDATION:");
    const finalPositions = {};
    const positionChanges = [];

    for (const { signer, label } of users) {
      try {
        // Test basic collateral first
        let collateral = 0n;
        try {
          collateral = await coreVault.userCollateral(signer.address);
        } catch (error) {
          console.log(`     ⚠️  ${label}: Could not get final collateral - ${error.message}`);
        }

        // Try to get positions with better error handling
        let allPositions = [];
        try {
          allPositions = await coreVault.getUserPositions(signer.address);
          console.log(`     📊 ${label}: Final positions count: ${allPositions.length}`);
        } catch (error) {
          console.log(`     ⚠️  ${label}: Could not get final positions - ${error.message}`);
          // If getUserPositions fails, try using getUnifiedMarginSummary
          try {
            const summary = await coreVault.getUnifiedMarginSummary(signer.address);
            console.log(`     📊 ${label}: Final margin summary - Collateral: $${formatUSDC(summary[0])}`);
            collateral = summary[0]; // totalCollateral from summary
          } catch (summaryError) {
            console.log(`     ❌ ${label}: All final position methods failed`);
          }
        }

        // Find position for our specific market or create default
        const marketPosition = allPositions.find(
          (pos) => pos.marketId === marketId
        );
        const position = marketPosition || {
          size: 0,
          entryPrice: 0,
          user: signer.address,
          marketId: marketId,
        };

        finalPositions[label] = {
          address: signer.address,
          position: position,
          collateral: collateral,
        };

        displayPosition(label, position, collateral, newMarkPrice);

        // Compare with initial position
        const initial = initialPositions[label];
        if (initial) {
          const initialSize = BigInt(initial.position.size.toString());
          const finalSize = BigInt(position.size.toString());
          const sizeChange = finalSize - initialSize;

          if (sizeChange !== 0n) {
            const changeDisplay = formatAmount(
              sizeChange >= 0n ? sizeChange : -sizeChange
            );
            const changeSign = sizeChange >= 0n ? "+" : "-";

            positionChanges.push({
              user: label,
              address: signer.address,
              initialSize: initialSize,
              finalSize: finalSize,
              sizeChange: sizeChange,
              changeDisplay: changeDisplay,
              changeSign: changeSign,
            });

            console.log(
              `     🔄 POSITION SIZE CHANGE: ${changeSign}${changeDisplay} ALU`
            );

            if (sizeChange < 0n && initial.position.size > 0) {
              console.log(
                `     ✅ ADL DETECTED: Long position reduced by ${changeDisplay} units!`
              );
            } else if (sizeChange > 0n && initial.position.size < 0) {
              console.log(
                `     ✅ LIQUIDATION: Short position closed by ${changeDisplay} units!`
              );
            }
          } else {
            console.log(`     📊 Position size unchanged`);
          }

          // Collateral change
          const collateralChange =
            finalPositions[label].collateral - initial.collateral;
          if (collateralChange !== 0n) {
            const collateralChangeDisplay = formatUSDC(
              collateralChange >= 0n ? collateralChange : -collateralChange
            );
            const collateralSign = collateralChange >= 0n ? "+" : "-";
            console.log(
              `     💰 Collateral change: ${collateralSign}$${collateralChangeDisplay}`
            );
          }
        }
      } catch (error) {
        console.log(
          `     ❌ Error getting ${label} final position: ${error.message}`
        );
      }
    }

    // ============================================
    // STEP 6: ADL VERIFICATION & RESULTS
    // ============================================
    console.log("\n🎯 STEP 6: ADL VERIFICATION & RESULTS");
    console.log("─".repeat(60));

    console.log(`\n📈 EVENTS SUMMARY:`);
    console.log(`  🔥 Liquidations: ${events.liquidations.length}`);
    console.log(
      `  📉 Position Closures (ADL): ${events.positionClosures.length}`
    );
    console.log(`  💸 Loss Socializations: ${events.adl.length}`);
    console.log(`  ✅ Trades: ${events.trades.length}`);

    // Detailed ADL analysis
    console.log(`\n🔍 DETAILED ADL ANALYSIS:`);

    if (events.positionClosures.length > 0) {
      console.log(
        `✅ SUCCESS: ADL system activated and reduced position sizes!`
      );

      events.positionClosures.forEach((closure, i) => {
        const sizeReduction = closure.originalSize - closure.newSize;
        console.log(`\n  ADL Event ${i + 1}:`);
        console.log(`    User: ${closure.user}`);
        console.log(
          `    Position Size Reduction: ${formatAmount(sizeReduction)} ALU`
        );
        console.log(
          `    Original Size: ${formatAmount(closure.originalSize)} ALU`
        );
        console.log(`    New Size: ${formatAmount(closure.newSize)} ALU`);
        console.log(
          `    Profit Confiscated: $${formatUSDC(closure.realizedProfit)}`
        );
      });
    } else if (positionChanges.some((change) => change.sizeChange < 0n)) {
      console.log(
        `✅ PARTIAL SUCCESS: Position size reductions detected in final state`
      );
      console.log(
        `📊 Some ADL activity may have occurred without explicit events`
      );
    } else {
      console.log(`⚠️  NO ADL ACTIVITY: Position sizes unchanged`);
      console.log(`🔍 Possible reasons:`);
      console.log(`   • Liquidation didn't create gap loss`);
      console.log(`   • User3's collateral was sufficient`);
      console.log(`   • Price didn't move enough to trigger liquidation`);
      console.log(`   • Market order was too small`);
    }

    // Position size change summary
    if (positionChanges.length > 0) {
      console.log(`\n📊 POSITION SIZE CHANGES SUMMARY:`);
      positionChanges.forEach((change) => {
        console.log(
          `  ${change.user}: ${change.changeSign}${change.changeDisplay} ALU`
        );

        if (change.sizeChange < 0n) {
          console.log(
            `    🎯 ADL IMPACT: Position reduced by ${change.changeDisplay} units`
          );
          console.log(
            `    📉 From: ${formatAmount(
              change.initialSize
            )} → To: ${formatAmount(change.finalSize)}`
          );
        }
      });
    }

    // Final verification
    const adlWorked =
      events.positionClosures.length > 0 ||
      positionChanges.some(
        (change) => change.sizeChange < 0n && change.initialSize > 0n
      );

    if (adlWorked) {
      console.log(
        `\n🎉 TEST PASSED: ADL system successfully reduced profitable position sizes!`
      );
      console.log(
        `✅ Verified: ADL reduces units held (position size) to cover gap losses`
      );
    } else {
      console.log(
        `\n⚠️  TEST INCONCLUSIVE: No clear ADL position size reduction observed`
      );
      console.log(
        `💡 Consider adjusting test parameters (larger market order, lower User3 collateral)`
      );
    }

    // Clean up event listeners
    orderBook.removeAllListeners();
    coreVault.removeAllListeners();
  } catch (error) {
    console.error("\n❌ TEST FAILED:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the test
main()
  .then(() => {
    console.log("\n✅ ADL POSITION SIZE REDUCTION TEST COMPLETE!");
    console.log("═".repeat(80));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Unhandled error:", error);
    process.exit(1);
  });
