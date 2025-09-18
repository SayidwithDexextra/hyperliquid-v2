#!/usr/bin/env node

// test-liquidation-adl.js - Test script for ADL liquidation system
//
// 🎯 PURPOSE:
//   - Test market buy order from User1 that triggers liquidation
//   - Verify ADL system reduces deployer's profit to cover socialized loss
//   - Monitor all events and position changes
//
// 🚀 USAGE:
//   node test-liquidation-adl.js
//   OR
//   npx hardhat run test-liquidation-adl.js --network localhost
//
// 📋 TEST SCENARIO:
//   1. Check initial positions (Deployer should have ~+40 profit)
//   2. Place market buy order from User1
//   3. Trigger liquidation event (User3's short position)
//   4. Verify ADL reduces Deployer's profit to cover loss
//   5. Display final positions and balances

// Ensure we connect to the running Hardhat node (localhost) for all direct node runs
// This avoids ABI mismatches caused by connecting to the in-process "hardhat" network
if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}

const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("./config/contracts");
const fs = require("fs");
const path = require("path");

// Helper function to format amounts with proper decimals
function formatAmount(amount, decimals = 18, displayDecimals = 4) {
  return ethers.formatUnits(amount, decimals);
}

function formatUSDC(amount) {
  return formatAmount(amount, 6, 2);
}

// 🔧 Format already-converted decimal numbers for display (not BigInt)
function formatDecimalUSDC(amount, decimals = 2) {
  return parseFloat(amount).toFixed(decimals);
}

// 🔧 Safe absolute value function that handles both Number and BigInt
function safeAbs(value) {
  if (typeof value === "bigint") {
    return value >= 0n ? value : -value;
  }
  return Math.abs(value);
}

// Price validation function (same as interactive-trader.js)
function formatPriceWithValidation(
  price,
  decimals = 6,
  displayDecimals = 2,
  showWarning = true
) {
  const formatted = formatAmount(price, decimals, displayDecimals);
  return formatted;
}

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

// Helper function to get market display name (same as interactive-trader.js)
function getMarketDisplayName(marketId) {
  if (marketId === MARKET_INFO.ALUMINUM.marketId) {
    return "ALU-USD";
  }
  if (marketId === MARKET_INFO.BTC.marketId) {
    return "BTC-USD";
  }
  // For unknown markets, show first 8 chars of the ID
  return marketId ? marketId.substring(0, 8) + "..." : "Unknown";
}

/**
 * Helper function to get mark price and calculate P&L from smart contracts (same as interactive-trader.js)
 * Uses real-time mark price calculation from OrderBook for consistency
 * @param {Object} contracts - Smart contract instances
 * @param {Object} position - Position object with marketId, size, entryPrice
 * @returns {Promise<{markPrice: number, pnl: number}>}
 */
async function getMarkPriceAndPnL(contracts, position) {
  try {
    // Get real-time mark price from OrderBook (consistent with order book display)
    let markPriceBigInt = 0n;

    try {
      // Try to get the OrderBook address for this market
      const orderBookAddress = await contracts.vault.marketToOrderBook(
        position.marketId
      );

      if (orderBookAddress && orderBookAddress !== ethers.ZeroAddress) {
        // Create OrderBook contract instance for this specific market
        const OrderBook = await ethers.getContractFactory("OrderBook");
        const orderBook = OrderBook.attach(orderBookAddress);

        // Get real-time calculated mark price
        markPriceBigInt = await orderBook.calculateMarkPrice();
      } else {
        // Fallback to default OrderBook if market-specific one not found
        markPriceBigInt = await contracts.orderBook.calculateMarkPrice();
      }
    } catch (error) {
      // Fallback to default OrderBook if market mapping fails
      console.log(
        `Using default OrderBook for market ${position.marketId.substring(
          0,
          8
        )}...`
      );
      markPriceBigInt = await contracts.orderBook.calculateMarkPrice();
    }

    if (markPriceBigInt > 0) {
      // 🔧 FIX: Use formatPriceWithValidation with 4 decimal places for higher precision
      const markPrice = parseFloat(
        formatPriceWithValidation(markPriceBigInt, 6, 4, false)
      );

      // Calculate P&L using the same formula as the smart contract
      // Formula: (markPrice - entryPrice) * size / TICK_PRECISION
      // Result: 6-decimal prices × 18-decimal size ÷ 1e6 = 18-decimal result
      const positionSize = BigInt(position.size.toString());
      const entryPriceBigInt = BigInt(position.entryPrice.toString());
      const priceDiffBigInt = markPriceBigInt - entryPriceBigInt;
      const pnlBigInt = (priceDiffBigInt * positionSize) / BigInt(1e6); // TICK_PRECISION = 1e6
      const pnl = parseFloat(ethers.formatUnits(pnlBigInt, 18)); // Result is in 18 decimals

      // 🔍 DEBUG: Enhanced precision debugging
      console.log(`\n🔍 DETAILED P&L CALCULATION DEBUG:`);
      console.log(`   📍 Raw Mark Price BigInt: ${markPriceBigInt}`);
      console.log(`   📍 Formatted Mark Price: $${markPrice}`);
      console.log(`   📍 Raw Entry Price BigInt: ${entryPriceBigInt}`);
      console.log(
        `   📍 Formatted Entry Price: $${formatPriceWithValidation(
          entryPriceBigInt,
          6,
          4,
          false
        )}`
      );
      console.log(`   📍 Raw Position Size BigInt: ${positionSize}`);
      console.log(
        `   📍 Formatted Position Size: ${ethers.formatUnits(
          positionSize,
          18
        )} ALU`
      );
      console.log(`   📍 Price Diff BigInt (6 decimals): ${priceDiffBigInt}`);
      console.log(
        `   📍 Price Diff Formatted: $${ethers.formatUnits(priceDiffBigInt, 6)}`
      );
      console.log(`   📍 P&L BigInt (18 decimals): ${pnlBigInt}`);
      console.log(`   📍 P&L Final Result: $${pnl}`);
      console.log(
        `   🧮 EXPECTED CALC: ($${markPrice} - $${formatPriceWithValidation(
          entryPriceBigInt,
          6,
          4,
          false
        )}) × ${ethers.formatUnits(positionSize, 18)} = $${
          (markPrice -
            parseFloat(
              formatPriceWithValidation(entryPriceBigInt, 6, 4, false)
            )) *
          parseFloat(ethers.formatUnits(positionSize, 18))
        }`
      );
      console.log(`   ✅ CONTRACT CALC: $${pnl}\n`);

      return { markPrice, pnl };
    } else {
      // Fallback: calculate manually using order book data
      const bestBid = await contracts.orderBook.bestBid();
      const bestAsk = await contracts.orderBook.bestAsk();

      if (bestBid > 0 && bestAsk < ethers.MaxUint256) {
        // 🔧 FIX: Use higher precision for bid/ask prices
        const bidPrice = parseFloat(
          formatPriceWithValidation(bestBid, 6, 4, false)
        );
        const askPrice = parseFloat(
          formatPriceWithValidation(bestAsk, 6, 4, false)
        );

        if (
          !isNaN(bidPrice) &&
          !isNaN(askPrice) &&
          bidPrice > 0 &&
          askPrice > 0
        ) {
          const markPrice = (bidPrice + askPrice) / 2;
          const entryPrice = parseFloat(
            formatPriceWithValidation(
              BigInt(position.entryPrice.toString()),
              6,
              4,
              false
            )
          );

          // 🔧 FIX: Use BigInt arithmetic for better precision in fallback calculation
          const markPriceBigInt = ethers.parseUnits(markPrice.toFixed(6), 6);
          const entryPriceBigInt = BigInt(position.entryPrice.toString());
          const positionSize = BigInt(position.size.toString());
          const priceDiffBigInt = markPriceBigInt - entryPriceBigInt;
          const pnlBigInt = (priceDiffBigInt * positionSize) / BigInt(1e6);
          const pnl = parseFloat(ethers.formatUnits(pnlBigInt, 18));

          return { markPrice, pnl };
        }
      }

      // Final fallback
      const entryPrice = parseFloat(
        formatPriceWithValidation(
          BigInt(position.entryPrice.toString()),
          6,
          4,
          false
        )
      );
      return { markPrice: entryPrice, pnl: 0 };
    }
  } catch (error) {
    console.error("Error getting mark price and P&L:", error);
    const entryPrice = parseFloat(
      formatPriceWithValidation(
        BigInt(position.entryPrice.toString()),
        6,
        4,
        false
      )
    );
    return { markPrice: entryPrice, pnl: 0 };
  }
}

// Helper function to display position info with comprehensive P&L data
function displayPosition(
  userLabel,
  position,
  collateral,
  unrealizedPnL = null,
  realizedPnL = null
) {
  console.log(`\n  💼 ${userLabel}:`);
  console.log(`     Address: ${position.user || "N/A"}`);
  // 🔧 FIX: Handle BigInt position.size safely
  const positionSize = BigInt(position.size.toString());
  const absSize = positionSize >= 0n ? positionSize : -positionSize;
  const sizeDisplay = parseFloat(ethers.formatUnits(absSize, 18));
  console.log(
    `     Position Size: ${sizeDisplay} ${
      positionSize >= 0n ? "LONG" : "SHORT"
    } ALU`
  );
  console.log(`     Entry Price: $${formatUSDC(position.entryPrice)}`);
  console.log(`     Collateral: ${formatUSDC(collateral)} USDC`);

  if (realizedPnL !== null) {
    const realizedColor = realizedPnL >= 0 ? "✅" : "❌";
    const realizedSign = realizedPnL >= 0 ? "+" : "-";
    console.log(
      `     Realized P&L: ${realizedColor} ${realizedSign}$${formatDecimalUSDC(
        safeAbs(realizedPnL)
      )} USDC (Lifetime)`
    );
  }

  if (unrealizedPnL !== null) {
    const unrealizedColor = unrealizedPnL >= 0 ? "✅" : "❌";
    const unrealizedSign = unrealizedPnL >= 0 ? "+" : "-";
    // 🔧 DEBUG: Show high precision unrealized P&L
    console.log(
      `     Unrealized P&L: ${unrealizedColor} ${unrealizedSign}$${safeAbs(
        unrealizedPnL
      ).toFixed(8)} USDC (Current)`
    );
    // Debug: Only log if significant unrealized P&L
    if (Math.abs(unrealizedPnL) > 1) {
      console.log(`     🔍 Debug Raw Unrealized P&L: ${unrealizedPnL}`);
    }
  }

  if (realizedPnL !== null && unrealizedPnL !== null) {
    const totalPnL = realizedPnL + unrealizedPnL;
    const totalColor = totalPnL >= 0 ? "🟢" : "🔴";
    const totalSign = totalPnL >= 0 ? "+" : "-";

    // 🔍 DEBUG: Total P&L calculation (condensed)
    if (totalPnL !== 0) {
      console.log(
        `     🔍 DEBUG Total P&L: realized=${realizedPnL}, unrealized=${unrealizedPnL}, total=${totalPnL}`
      );
    }

    console.log(
      `     Total P&L: ${totalColor} ${totalSign}$${formatDecimalUSDC(
        safeAbs(totalPnL)
      )} USDC`
    );
  }
}

/**
 * Helper function to get comprehensive P&L data for a user (same as interactive-trader.js)
 * @param {Object} contracts - Smart contract instances
 * @param {string} userAddress - User address
 * @returns {Promise<{realizedPnL: number, unrealizedPnL: number}>}
 */
async function getComprehensivePnLData(contracts, userAddress) {
  try {
    // Get unified margin summary (includes realized P&L)
    const [
      totalCollateral,
      marginUsed,
      marginReserved,
      availableMargin,
      realizedPnLRaw,
      // unrealizedPnLRaw, // We calculate this separately for accuracy
    ] = await contracts.vault.getUnifiedMarginSummary(userAddress);

    // Handle realizedPnL - it's stored with 18 decimals
    const realizedPnLBigInt = BigInt(realizedPnLRaw.toString());
    const realizedPnL = parseFloat(ethers.formatUnits(realizedPnLBigInt, 18));

    // 🔍 DEBUG: Realized P&L scaling (only if non-zero)
    if (realizedPnL !== 0) {
      console.log(
        `🔍 DEBUG Realized P&L: raw=${realizedPnLRaw}, bigInt=${realizedPnLBigInt}, final=${realizedPnL}`
      );
    }

    // Get real-time unrealized P&L using unified mark price calculation
    const positions = await contracts.vault.getUserPositions(userAddress);
    let unrealizedPnL = 0;

    for (const position of positions) {
      try {
        const { pnl } = await getMarkPriceAndPnL(contracts, position);
        unrealizedPnL += pnl;
      } catch (error) {
        console.error(
          `Error calculating P&L for position ${position.marketId.substring(
            0,
            8
          )}:`,
          error.message
        );
      }
    }

    return { realizedPnL, unrealizedPnL };
  } catch (error) {
    console.error("Error getting comprehensive P&L data:", error.message);
    return { realizedPnL: 0, unrealizedPnL: 0 };
  }
}

async function main() {
  console.log("\n🧪 ADL LIQUIDATION TEST SCRIPT");
  console.log("═".repeat(80));
  console.log("🎯 Testing market buy order that triggers liquidation");
  console.log("📊 Verifying ADL system reduces profitable positions");

  const signers = await ethers.getSigners();
  const [deployer, user1, user2, user3] = signers;

  // Verify network connection
  try {
    const network = await ethers.provider.getNetwork();
    console.log(
      `🌐 Connected to network: ${network.name || "localhost"} (Chain ID: ${
        network.chainId
      })`
    );

    if (network.chainId !== 31337n) {
      console.log(
        `⚠️  WARNING: Expected localhost chain ID 31337, got ${network.chainId}`
      );
      console.log(`   Make sure Hardhat node is running: npx hardhat node`);
    }
  } catch (error) {
    console.log(`⚠️  Could not verify network connection: ${error.message}`);
  }

  console.log("\n👥 PARTICIPANTS:");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  User1:    ${user1.address} (will place buy order)`);
  console.log(`  User2:    ${user2.address}`);
  console.log(`  User3:    ${user3.address} (expected liquidation target)`);

  try {
    // ============================================
    // STEP 1: LOAD EXISTING CONTRACTS
    // ============================================
    console.log("\n📦 STEP 1: LOADING EXISTING CONTRACTS");
    console.log("─".repeat(60));

    const coreVault = await getContract("CORE_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await getContract("MOCK_USDC");
    const factory = await getContract("FUTURES_MARKET_FACTORY");

    // Create contracts object for helper functions (same pattern as interactive-trader.js)
    const contracts = {
      vault: coreVault,
      orderBook: orderBook,
      factory: factory,
      mockUSDC: mockUSDC,
    };

    // Get market ID from MARKET_INFO (same as interactive-trader.js)
    const aluminumMarket = MARKET_INFO.ALUMINUM;
    const marketId = aluminumMarket.marketId;

    // Use safeDecodeMarketId to get readable symbol
    const marketSymbol = await safeDecodeMarketId(marketId, contracts);
    console.log("✅ Using market ID from config:", marketId);
    console.log("✅ Market Symbol:", marketSymbol);

    const coreVaultAddress = await coreVault.getAddress();
    const orderBookAddress = await orderBook.getAddress();
    const mockUSDCAddress = await mockUSDC.getAddress();

    console.log("✅ CoreVault loaded:", coreVaultAddress);
    console.log("✅ OrderBook loaded:", orderBookAddress);
    console.log("✅ MockUSDC loaded:", mockUSDCAddress);
    console.log("✅ Market ID:", marketId);

    // Verify we can read basic contract state
    try {
      const blockNumber = await ethers.provider.getBlockNumber();
      const vaultBalance = await mockUSDC.balanceOf(coreVaultAddress);
      console.log(`📊 Current block: ${blockNumber}`);
      console.log(`📊 Vault USDC balance: ${formatUSDC(vaultBalance)} USDC`);
    } catch (error) {
      console.log(
        `⚠️  Warning: Could not read basic contract state: ${error.message}`
      );
    }

    // ============================================
    // STEP 2: CHECK INITIAL POSITIONS & P&L DATA
    // ============================================
    console.log("\n📊 STEP 2: INITIAL POSITIONS & P&L DATA");
    console.log("─".repeat(60));
    console.log(
      "🎯 Getting comprehensive P&L data (realized + unrealized) for all users"
    );

    // Get current mark price using the same pattern as interactive-trader.js
    let currentMarkPrice;
    try {
      // First try to get mark price from OrderBook's calculateMarkPrice
      currentMarkPrice = await orderBook.calculateMarkPrice();

      if (currentMarkPrice > 0) {
        console.log(
          `📈 Current Mark Price (from OrderBook): $${formatUSDC(
            currentMarkPrice
          )}`
        );
      } else {
        // Fallback: calculate from best bid/ask
        const bestBid = await orderBook.bestBid();
        const bestAsk = await orderBook.bestAsk();

        if (bestBid > 0 && bestAsk < ethers.MaxUint256) {
          const bidPrice = parseFloat(ethers.formatUnits(bestBid, 6));
          const askPrice = parseFloat(ethers.formatUnits(bestAsk, 6));

          if (
            !isNaN(bidPrice) &&
            !isNaN(askPrice) &&
            bidPrice > 0 &&
            askPrice > 0
          ) {
            currentMarkPrice = ethers.parseUnits(
              ((bidPrice + askPrice) / 2).toFixed(6),
              6
            );
            console.log(
              `📈 Current Mark Price (from bid/ask): $${formatUSDC(
                currentMarkPrice
              )}`
            );
          }
        } else {
          // Final fallback: Use vault's mark price
          currentMarkPrice = await coreVault.getMarkPrice(marketId);
          console.log(
            `📈 Current Mark Price (from vault): $${formatUSDC(
              currentMarkPrice
            )}`
          );
        }
      }
    } catch (error) {
      console.log(
        `⚠️  Could not get mark price from primary sources: ${error.message}`
      );
      console.log(`   Falling back to default price...`);
      currentMarkPrice = ethers.parseUnits("1", 6); // $1.00 default
      console.log(
        `📈 Using fallback mark price: $${formatUSDC(currentMarkPrice)}`
      );
    }

    // Check all user positions
    console.log("\n💼 CURRENT POSITIONS:");
    const users = [
      { signer: deployer, label: "Deployer" },
      { signer: user1, label: "User1" },
      { signer: user2, label: "User2" },
      { signer: user3, label: "User3" },
    ];

    const initialState = {};

    for (const { signer, label } of users) {
      try {
        let position, collateral;
        try {
          // Get all positions for the user (same as interactive-trader.js)
          const allPositions = await coreVault.getUserPositions(signer.address);
          collateral = await coreVault.userCollateral(signer.address);

          // Find position for our specific market
          const marketPosition = allPositions.find(
            (pos) => pos.marketId === marketId
          );

          if (marketPosition) {
            position = {
              size: marketPosition.size,
              entryPrice: marketPosition.entryPrice,
              user: signer.address,
              marketId: marketPosition.marketId,
            };
          } else {
            // No position in this market
            position = {
              size: 0,
              entryPrice: 0,
              user: signer.address,
              marketId: marketId,
            };
          }
        } catch (error) {
          console.log(
            `     ❌ Error getting position/collateral for ${label}: ${error.message}`
          );
          // Use default values to continue
          position = {
            size: 0,
            entryPrice: 0,
            user: signer.address,
            marketId: marketId,
          };
          collateral = 0;
        }

        // Get comprehensive P&L data (both realized and unrealized)
        let realizedPnL = null;
        let unrealizedPnL = null;

        try {
          const pnlData = await getComprehensivePnLData(
            contracts,
            signer.address
          );
          realizedPnL = pnlData.realizedPnL;
          unrealizedPnL = pnlData.unrealizedPnL;
        } catch (error) {
          console.log(
            `     ⚠️  Could not get P&L data for ${label}: ${error.message}`
          );
        }

        displayPosition(
          label,
          position,
          collateral,
          unrealizedPnL,
          realizedPnL
        );

        // Store initial state
        initialState[label] = {
          address: signer.address,
          position: position,
          collateral: collateral,
          realizedPnL: realizedPnL,
          unrealizedPnL: unrealizedPnL,
        };
      } catch (error) {
        console.log(
          `     ❌ Error getting ${label} position: ${error.message}`
        );
      }
    }

    // Check order book liquidity
    console.log("\n📋 ORDER BOOK STATE:");
    try {
      const bestBid = await orderBook.bestBid();
      const bestAsk = await orderBook.bestAsk();
      console.log(`  Best Bid: $${formatUSDC(bestBid)}`);
      console.log(`  Best Ask: $${formatUSDC(bestAsk)}`);
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
      adlEvents: [],
      gaps: [],
      trades: [],
    };

    // Monitor OrderBook liquidation debug events
    orderBook.on(
      "DebugLiquidationCall",
      (trader, marketId, positionSize, stage, event) => {
        console.log(
          `🔍 LIQUIDATION FLOW: ${trader} | Stage: ${stage} | Size: ${formatAmount(
            positionSize,
            18,
            2
          )}`
        );
      }
    );

    // Monitor OrderBook events
    orderBook.on(
      "LiquidationPositionProcessed",
      (trader, positionSize, executionPrice, event) => {
        events.liquidations.push({
          trader,
          positionSize,
          executionPrice,
          event,
        });
        console.log(
          `🔥 LIQUIDATION PROCESSED: ${trader} | Size: ${formatAmount(
            positionSize
          )} | Price: $${formatUSDC(executionPrice)}`
        );
      }
    );

    orderBook.on(
      "GapLossDetected",
      (
        trader,
        marketId,
        gapLoss,
        liquidationPrice,
        executionPrice,
        positionSize,
        event
      ) => {
        events.gaps.push({
          trader,
          marketId,
          gapLoss,
          liquidationPrice,
          executionPrice,
          positionSize,
          event,
        });
        // Use getMarketDisplayName for readable market display
        console.log(
          `⚠️  GAP LOSS: ${trader} | Market: ${getMarketDisplayName(
            marketId
          )} | Gap: $${formatUSDC(gapLoss)} | Liquidation: $${formatUSDC(
            liquidationPrice
          )} | Execution: $${formatUSDC(executionPrice)}`
        );
      }
    );

    orderBook.on("TradeExecuted", (buyer, seller, amount, price, event) => {
      events.trades.push({ buyer, seller, amount, price, event });
      console.log(
        `✅ TRADE: ${buyer} bought ${formatAmount(
          amount
        )} ALU from ${seller} at $${formatUSDC(price)}`
      );
    });

    // Monitor CoreVault liquidation debugging events
    // NOTE: These debug events don't exist in current CoreVault contract
    // Available debug events: DebugProfitCalculation, DebugPositionReduction, DebugSocializationState

    /* DISABLED - Event doesn't exist
    coreVault.on(
      "DebugPositionSearch",
      (user, marketId, totalPositions, positionFound, event) => {
        console.log(`🔍 POSITION SEARCH: ${user}`);
        console.log(`   Market: ${getMarketDisplayName(marketId)}`);
        console.log(`   Total Positions: ${totalPositions}`);
        console.log(`   Short Position Found: ${positionFound ? "YES" : "NO"}`);
      }
    );

    coreVault.on(
      "DebugLiquidationLoss",
      (
        user,
        marketId,
        actualLoss,
        coveredByUser,
        uncoveredLoss,
        userCollateral,
        event
      ) => {
        console.log(`🔍 LIQUIDATION DEBUG: ${user}`);
        console.log(`   Market: ${getMarketDisplayName(marketId)}`);
        console.log(`   Actual Loss: $${formatUSDC(actualLoss)}`);
        console.log(`   Covered by User: $${formatUSDC(coveredByUser)}`);
        console.log(`   Uncovered Loss: $${formatUSDC(uncoveredLoss)}`);
        console.log(`   User Collateral: $${formatUSDC(userCollateral)}`);
        console.log(
          `   🎯 ADL SHOULD TRIGGER: ${uncoveredLoss > 0 ? "YES" : "NO"}`
        );
      }
    );
    */

    // Monitor actual CoreVault debug events
    coreVault.on(
      "DebugProfitCalculation",
      (
        user,
        marketId,
        entryPrice,
        markPrice,
        positionSize,
        unrealizedPnL,
        profitScore,
        event
      ) => {
        console.log(`🔍 DEBUG PROFIT CALC: ${user}`);
        console.log(`   Market: ${getMarketDisplayName(marketId)}`);
        console.log(`   Entry Price: $${formatUSDC(entryPrice)}`);
        console.log(`   Mark Price: $${formatUSDC(markPrice)}`);
        console.log(`   Position Size: ${ethers.formatEther(positionSize)}`);
        console.log(`   Unrealized PnL: $${formatUSDC(unrealizedPnL)}`);
        console.log(`   Profit Score: ${profitScore.toString()}`);
      }
    );

    coreVault.on(
      "DebugPositionReduction",
      (
        user,
        marketId,
        originalSize,
        reductionAmount,
        newSize,
        realizedPnL,
        event
      ) => {
        console.log(`🔍 DEBUG POSITION REDUCTION: ${user}`);
        console.log(`   Market: ${getMarketDisplayName(marketId)}`);
        console.log(`   Original Size: ${ethers.formatEther(originalSize)}`);
        console.log(
          `   Reduction Amount: ${ethers.formatEther(reductionAmount)}`
        );
        console.log(`   New Size: ${ethers.formatEther(newSize)}`);
        console.log(`   Realized PnL: $${formatUSDC(realizedPnL)}`);
      }
    );

    coreVault.on(
      "DebugSocializationState",
      (
        marketId,
        remainingLoss,
        totalProfitableUsers,
        processedUsers,
        event
      ) => {
        console.log(`🔍 DEBUG SOCIALIZATION STATE:`);
        console.log(`   Market: ${getMarketDisplayName(marketId)}`);
        console.log(`   Remaining Loss: $${formatUSDC(remainingLoss)}`);
        console.log(`   Total Profitable Users: ${totalProfitableUsers}`);
        console.log(`   Processed Users: ${processedUsers}`);
      }
    );

    // Monitor CoreVault ADL events
    coreVault.on(
      "SocializedLossApplied",
      (marketId, lossAmount, liquidatedUser, event) => {
        events.adlEvents.push({
          type: "SocializedLossApplied",
          marketId,
          lossAmount,
          liquidatedUser,
          event,
        });
        // Use safeDecodeMarketId for readable market display
        safeDecodeMarketId(marketId, contracts).then((symbol) => {
          console.log(
            `🔄 ADL APPLIED: Market ${symbol} | Socialized Loss: $${formatUSDC(
              lossAmount
            )} | Liquidated User: ${liquidatedUser}`
          );
        });
      }
    );

    coreVault.on(
      "UserLossSocialized",
      (user, lossAmount, remainingCollateral, event) => {
        events.adlEvents.push({
          type: "UserLossSocialized",
          user,
          lossAmount,
          remainingCollateral,
          event,
        });
        console.log(
          `💰 USER ADL: ${user} | Loss Taken: $${formatUSDC(
            lossAmount
          )} | Remaining Collateral: $${formatUSDC(remainingCollateral)}`
        );
      }
    );

    // Monitor profitable position detection
    coreVault.on(
      "ProfitablePositionFound",
      (
        user,
        marketId,
        positionSize,
        entryPrice,
        markPrice,
        unrealizedPnL,
        profitScore,
        event
      ) => {
        console.log(`🎯 PROFITABLE POSITION FOUND: ${user}`);
        console.log(`   Size: ${formatAmount(positionSize, 18, 2)}`);
        console.log(
          `   Entry: $${formatPriceWithValidation(entryPrice, 6, 4, false)}`
        );
        console.log(
          `   Mark: $${formatPriceWithValidation(markPrice, 6, 4, false)}`
        );
        console.log(`   Unrealized P&L: $${formatUSDC(unrealizedPnL)}`);
        console.log(`   Profit Score: ${profitScore}`);
      }
    );

    // Additional ADL debug events
    coreVault.on(
      "SocializationStarted",
      (marketId, lossAmount, liquidatedUser, timestamp, event) => {
        console.log(
          `🔄 ADL STARTED: Market ${getMarketDisplayName(
            marketId
          )} | Loss: $${formatUSDC(lossAmount)} | Liquidated: ${liquidatedUser}`
        );
      }
    );

    coreVault.on(
      "SocializationFailed",
      (marketId, lossAmount, reason, liquidatedUser, event) => {
        console.log(
          `❌ ADL FAILED: Market ${getMarketDisplayName(
            marketId
          )} | Loss: $${formatUSDC(lossAmount)} | Reason: ${reason}`
        );
      }
    );

    coreVault.on(
      "SocializationCompleted",
      (
        marketId,
        totalLossCovered,
        remainingLoss,
        positionsAffected,
        liquidatedUser,
        event
      ) => {
        console.log(
          `✅ ADL COMPLETED: Market ${getMarketDisplayName(
            marketId
          )} | Covered: $${formatUSDC(
            totalLossCovered
          )} | Remaining: $${formatUSDC(
            remainingLoss
          )} | Positions: ${positionsAffected}`
        );
      }
    );

    console.log("✅ Event listeners activated");

    // ============================================
    // STEP 4: PLACE MARKET BUY ORDER FROM USER1
    // ============================================
    console.log(
      "\n🚀 STEP 4: PLACING MARKET BUY ORDER (USER1) [READY TO TEST]"
    );
    console.log("─".repeat(60));
    console.log(
      "💡 Uncomment the market order below to trigger liquidation test"
    );

    // Determine order size that will trigger liquidation
    // Based on the scenario, we need to buy more than what's available after reserving 10 units for liquidation

    // 🔥 UNCOMMENT TO ACTIVATE: Market buy order that will trigger liquidation
    const buyAmount = ethers.parseUnits("5", 18); // 20 ALU - should trigger the liquidation

    console.log(`  📋 Order Details:`);
    console.log(`     From: User1 (${user1.address})`);
    console.log(`     Type: Market Buy`);
    console.log(`     Amount: ${formatAmount(buyAmount)} ALU`);
    console.log(
      `     Expected: Should trigger liquidation of User3's short position`
    );

    try {
      console.log(`\n  🔄 Executing market buy order...`);

      const buyTx = await orderBook.connect(user1).placeMarginMarketOrder(
        buyAmount,
        true // isBuy = true
      );

      console.log(`  ⏳ Transaction submitted: ${buyTx.hash}`);
      const receipt = await buyTx.wait();
      console.log(`  ✅ Transaction confirmed in block ${receipt.blockNumber}`);
    } catch (error) {
      console.log(`  ❌ Market order FAILED: ${error.message}`);

      // Check if this is the expected overflow error
      if (
        error.message.includes("panic code 0x11") ||
        error.message.includes("Arithmetic operation overflowed")
      ) {
        console.log(
          `  🎯 EXPECTED: This is the arithmetic overflow we're testing!`
        );
        console.log(
          `  📋 The error confirms insufficient liquidity for both user order and liquidation reserve`
        );
      }
    }

    // // Wait a moment for events to process
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // ============================================
    // STEP 5: CHECK FINAL POSITIONS & P&L DATA
    // ============================================
    console.log("\n📊 STEP 5: FINAL POSITIONS & P&L DATA");
    console.log("─".repeat(60));
    console.log(
      "🔍 Comparing final P&L data with initial state to detect ADL activity"
    );

    console.log("\n💼 FINAL POSITIONS:");
    const finalState = {};

    for (const { signer, label } of users) {
      try {
        let position, collateral;
        try {
          // Get all positions for the user (same as interactive-trader.js)
          const allPositions = await coreVault.getUserPositions(signer.address);
          collateral = await coreVault.userCollateral(signer.address);

          // Find position for our specific market
          const marketPosition = allPositions.find(
            (pos) => pos.marketId === marketId
          );

          if (marketPosition) {
            position = {
              size: marketPosition.size,
              entryPrice: marketPosition.entryPrice,
              user: signer.address,
              marketId: marketPosition.marketId,
            };
          } else {
            // No position in this market
            position = {
              size: 0,
              entryPrice: 0,
              user: signer.address,
              marketId: marketId,
            };
          }
        } catch (error) {
          console.log(
            `     ❌ Error getting final position/collateral for ${label}: ${error.message}`
          );
          // Use default values to continue
          position = {
            size: 0,
            entryPrice: 0,
            user: signer.address,
            marketId: marketId,
          };
          collateral = 0;
        }

        // Get comprehensive P&L data (both realized and unrealized)
        let realizedPnL = null;
        let unrealizedPnL = null;

        try {
          const pnlData = await getComprehensivePnLData(
            contracts,
            signer.address
          );
          realizedPnL = pnlData.realizedPnL;
          unrealizedPnL = pnlData.unrealizedPnL;
        } catch (error) {
          // P&L calculation might fail, that's ok
        }

        displayPosition(
          label,
          position,
          collateral,
          unrealizedPnL,
          realizedPnL
        );

        // Store final state
        finalState[label] = {
          address: signer.address,
          position: position,
          collateral: collateral,
          realizedPnL: realizedPnL,
          unrealizedPnL: unrealizedPnL,
        };

        // Compare with initial state
        const initial = initialState[label];
        if (initial) {
          const collateralChange = collateral - initial.collateral;
          const realizedPnLChange =
            (realizedPnL || 0) - (initial.realizedPnL || 0);
          const unrealizedPnLChange =
            (unrealizedPnL || 0) - (initial.unrealizedPnL || 0);
          const totalPnLChange = realizedPnLChange + unrealizedPnLChange;

          console.log(`     📈 CHANGES ANALYSIS:`);
          console.log(
            `       Collateral: ${
              collateralChange >= 0 ? "+" : ""
            }$${formatUSDC(safeAbs(collateralChange))} USDC`
          );

          if (initial.realizedPnL !== null && realizedPnL !== null) {
            const realizedColor = realizedPnLChange >= 0 ? "🟢" : "🔴";
            console.log(
              `       Realized P&L: ${realizedColor} ${
                realizedPnLChange >= 0 ? "+" : ""
              }$${formatUSDC(safeAbs(realizedPnLChange))} USDC`
            );
          }

          if (initial.unrealizedPnL !== null && unrealizedPnL !== null) {
            const unrealizedColor = unrealizedPnLChange >= 0 ? "🟢" : "🔴";
            console.log(
              `       Unrealized P&L: ${unrealizedColor} ${
                unrealizedPnLChange >= 0 ? "+" : ""
              }$${formatUSDC(safeAbs(unrealizedPnLChange))} USDC`
            );
          }

          if (realizedPnLChange !== 0 || unrealizedPnLChange !== 0) {
            const totalColor = totalPnLChange >= 0 ? "🟢" : "🔴";
            console.log(
              `       Total P&L Change: ${totalColor} ${
                totalPnLChange >= 0 ? "+" : ""
              }$${formatUSDC(safeAbs(totalPnLChange))} USDC`
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
    // STEP 6: EVENT SUMMARY
    // ============================================
    console.log("\n📋 STEP 6: EVENT SUMMARY");
    console.log("─".repeat(60));

    console.log(`\n🔥 Liquidations: ${events.liquidations.length}`);
    events.liquidations.forEach((event, i) => {
      console.log(`  ${i + 1}. Trader: ${event.trader}`);
      console.log(`     Size: ${formatAmount(event.positionSize)} ALU`);
      console.log(`     Price: $${formatUSDC(event.executionPrice)}`);
    });

    console.log(`\n⚠️  Gap Losses: ${events.gaps.length}`);
    events.gaps.forEach((event, i) => {
      console.log(`  ${i + 1}. Trader: ${event.trader}`);
      console.log(`     Gap Loss: $${formatUSDC(event.gapLoss)}`);
      console.log(
        `     Liquidation Price: $${formatUSDC(event.liquidationPrice)}`
      );
      console.log(`     Execution Price: $${formatUSDC(event.executionPrice)}`);
    });

    console.log(`\n🔄 ADL Events: ${events.adlEvents.length}`);
    events.adlEvents.forEach((event, i) => {
      console.log(`  ${i + 1}. Type: ${event.type}`);
      if (event.type === "SocializedLossApplied") {
        console.log(`     Socialized Loss: $${formatUSDC(event.lossAmount)}`);
        console.log(`     Liquidated User: ${event.liquidatedUser}`);
      } else if (event.type === "UserLossSocialized") {
        console.log(`     User: ${event.user}`);
        console.log(`     Loss Amount: $${formatUSDC(event.lossAmount)}`);
        console.log(
          `     Remaining Collateral: $${formatUSDC(event.remainingCollateral)}`
        );
      }
    });

    console.log(`\n✅ Trades: ${events.trades.length}`);
    events.trades.forEach((event, i) => {
      console.log(
        `  ${i + 1}. ${event.buyer} ← ${formatAmount(event.amount)} ALU ← ${
          event.seller
        } @ $${formatUSDC(event.price)}`
      );
    });

    // ============================================
    // STEP 7: ADL VERIFICATION
    // ============================================
    console.log("\n🎯 STEP 7: ADL SYSTEM VERIFICATION");
    console.log("─".repeat(60));

    // Check if deployer's profit was reduced
    const deployerInitial = initialState.Deployer;
    const deployerFinal = finalState.Deployer;

    if (deployerInitial && deployerFinal) {
      console.log(`\n💼 DEPLOYER ADL ANALYSIS:`);

      // Realized P&L Analysis
      const initialRealizedPnL = deployerInitial.realizedPnL || 0;
      const finalRealizedPnL = deployerFinal.realizedPnL || 0;
      const realizedPnLChange = finalRealizedPnL - initialRealizedPnL;

      // Unrealized P&L Analysis
      const initialUnrealizedPnL = deployerInitial.unrealizedPnL || 0;
      const finalUnrealizedPnL = deployerFinal.unrealizedPnL || 0;
      const unrealizedPnLChange = finalUnrealizedPnL - initialUnrealizedPnL;

      // Total P&L Analysis
      const initialTotalPnL = initialRealizedPnL + initialUnrealizedPnL;
      const finalTotalPnL = finalRealizedPnL + finalUnrealizedPnL;
      const totalPnLChange = finalTotalPnL - initialTotalPnL;

      console.log(`  📊 P&L BREAKDOWN:`);
      console.log(
        `    Initial Realized P&L: ${
          initialRealizedPnL >= 0 ? "+" : ""
        }$${formatUSDC(safeAbs(initialRealizedPnL))}`
      );
      console.log(
        `    Final Realized P&L:   ${
          finalRealizedPnL >= 0 ? "+" : ""
        }$${formatUSDC(safeAbs(finalRealizedPnL))}`
      );
      console.log(
        `    Initial Unrealized P&L: ${
          initialUnrealizedPnL >= 0 ? "+" : ""
        }$${formatUSDC(safeAbs(initialUnrealizedPnL))}`
      );
      console.log(
        `    Final Unrealized P&L:   ${
          finalUnrealizedPnL >= 0 ? "+" : ""
        }$${formatUSDC(safeAbs(finalUnrealizedPnL))}`
      );
      console.log(
        `    Initial Total P&L: ${initialTotalPnL >= 0 ? "+" : ""}$${formatUSDC(
          safeAbs(initialTotalPnL)
        )}`
      );
      console.log(
        `    Final Total P&L:   ${finalTotalPnL >= 0 ? "+" : ""}$${formatUSDC(
          safeAbs(finalTotalPnL)
        )}`
      );

      console.log(`\n  💰 COLLATERAL ANALYSIS:`);
      console.log(
        `    Initial Collateral: $${formatUSDC(deployerInitial.collateral)}`
      );
      console.log(
        `    Final Collateral:   $${formatUSDC(deployerFinal.collateral)}`
      );

      const collateralChange =
        deployerFinal.collateral - deployerInitial.collateral;
      console.log(
        `    Collateral Change: ${
          collateralChange >= 0 ? "+" : ""
        }$${formatUSDC(safeAbs(collateralChange))}`
      );

      console.log(`\n  🔄 ADL EFFECTIVENESS ANALYSIS:`);

      // Check for realized P&L reduction (most direct sign of ADL)
      if (realizedPnLChange < 0) {
        console.log(
          `  ✅ REALIZED P&L REDUCED: ADL confiscated $${formatUSDC(
            safeAbs(realizedPnLChange)
          )} from deployer`
        );
        console.log(`  🎯 SUCCESS: ADL system is working correctly!`);
      }

      // Check for collateral reduction
      if (collateralChange < 0) {
        console.log(
          `  ✅ COLLATERAL REDUCED: ADL reduced deployer's collateral by $${formatUSDC(
            safeAbs(collateralChange)
          )}`
        );
        console.log(`  🎯 SUCCESS: Socialized loss mechanism is active!`);
      }

      // Check total P&L impact
      if (totalPnLChange < 0) {
        console.log(
          `  📉 TOTAL P&L IMPACT: Deployer lost $${formatUSDC(
            safeAbs(totalPnLChange)
          )} total value`
        );
      }

      // If no negative changes detected
      if (
        realizedPnLChange >= 0 &&
        collateralChange >= 0 &&
        totalPnLChange >= 0
      ) {
        console.log(
          `  ⚠️  NO ADL ACTIVITY DETECTED: No profit confiscation occurred`
        );
        console.log(
          `  📋 This may indicate insufficient liquidation events or ADL not triggered`
        );
      }
    }

    // ============================================
    // TEST COMPLETE
    // ============================================
    console.log("\n✅ ADL LIQUIDATION TEST COMPLETE!");
    console.log("═".repeat(80));

    if (events.adlEvents.length > 0) {
      console.log("🎉 ADL events detected - system is functioning!");
    } else if (events.liquidations.length > 0) {
      console.log("🔥 Liquidation events detected");
    } else {
      console.log(
        "⚠️  No liquidation events detected - may need to adjust test conditions"
      );
    }

    console.log("\n📋 SUMMARY:");
    console.log(`  • Liquidations: ${events.liquidations.length}`);
    console.log(`  • ADL Events: ${events.adlEvents.length}`);
    console.log(`  • Gap Losses: ${events.gaps.length}`);
    console.log(`  • Trades: ${events.trades.length}`);

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
    console.log("\n🏁 Test script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Unhandled error:", error);
    process.exit(1);
  });
