#!/usr/bin/env node

// grand-analyzer.js - Comprehensive Order Book & Trading System Analyzer
//
// 🎯 FEATURES:
//   ✅ Complete system state overview
//   ✅ Position analysis with PnL calculations
//   ✅ Order book depth analysis
//   ✅ Liquidation risk assessment
//   ✅ Margin requirement analysis
//   ✅ Market health metrics
//   ✅ Liquidation simulation capabilities
//
// 🚀 USAGE:
//   npx hardhat run scripts/grand-analyzer.js --network localhost
//

const { ethers } = require("hardhat");
const {
  getContract,
  getAddress,
  MARKET_INFO,
  displayFullConfig,
} = require("../config/contracts");

// 🎨 ENHANCED COLOR PALETTE
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

// Helper function to format values with correct decimal precision
function formatWithAutoDecimalDetection(
  value,
  expectedDecimals = 6,
  displayDecimals = 2
) {
  if (!value || value === 0n) return "0.00";

  try {
    const valueBigInt =
      typeof value === "bigint" ? value : BigInt(value.toString());
    const absValue = valueBigInt >= 0n ? valueBigInt : -valueBigInt;

    if (absValue > 10n ** 6n) {
      const divBy1e6 = parseFloat(ethers.formatUnits(valueBigInt, 6));
      if (divBy1e6 >= 0.01 && divBy1e6 <= 1000000) {
        return divBy1e6.toFixed(displayDecimals);
      }

      if (absValue > 10n ** 12n) {
        const as12Decimals = parseFloat(ethers.formatUnits(valueBigInt, 12));
        if (as12Decimals >= 0.01 && as12Decimals <= 1000000) {
          return as12Decimals.toFixed(displayDecimals);
        }
        return parseFloat(ethers.formatUnits(valueBigInt, 18)).toFixed(
          displayDecimals
        );
      }
    }

    return parseFloat(
      ethers.formatUnits(valueBigInt, expectedDecimals)
    ).toFixed(displayDecimals);
  } catch (error) {
    return "Error";
  }
}

// Helper function to format price
function formatPrice(price) {
  return formatWithAutoDecimalDetection(price, 6, 2);
}

// Helper function to format amount
function formatAmount(amount) {
  return formatWithAutoDecimalDetection(amount, 18, 4);
}

// Helper function to format USDC
function formatUSDC(amount) {
  return formatWithAutoDecimalDetection(amount, 6, 2);
}

// Calculate PnL for a position
function calculatePnL(positionSize, entryPrice, currentPrice) {
  if (positionSize === 0n) return { pnl: 0n, isProfit: true, percentage: 0 };

  const sizeFloat = parseFloat(ethers.formatUnits(positionSize, 18));
  const entryFloat = parseFloat(ethers.formatUnits(entryPrice, 6));
  const currentFloat = parseFloat(ethers.formatUnits(currentPrice, 6));

  const pnlFloat =
    positionSize > 0n
      ? sizeFloat * (currentFloat - entryFloat) // Long position
      : sizeFloat * (entryFloat - currentFloat); // Short position

  const pnl = BigInt(Math.round(pnlFloat * 1e6)); // Convert back to 6 decimals
  const isProfit = pnl >= 0n;
  const percentage =
    entryFloat > 0 ? Math.abs(pnlFloat / (sizeFloat * entryFloat)) * 100 : 0;

  return { pnl, isProfit, percentage };
}

// Get all users from the system
async function getAllUsers(orderBook, vault) {
  const users = new Set();

  // Get users from positions
  try {
    const positionEvents = await orderBook.queryFilter(
      orderBook.filters.PositionUpdated()
    );
    positionEvents.forEach((event) => {
      if (event.args && event.args.user) {
        users.add(event.args.user);
      }
    });
  } catch (error) {
    console.log(
      `${colors.yellow}Warning: Could not fetch position events${colors.reset}`
    );
  }

  // Get users from orders
  try {
    const orderEvents = await orderBook.queryFilter(
      orderBook.filters.OrderPlaced()
    );
    orderEvents.forEach((event) => {
      if (event.args && event.args.trader) {
        users.add(event.args.trader);
      }
    });
  } catch (error) {
    console.log(
      `${colors.yellow}Warning: Could not fetch order events${colors.reset}`
    );
  }

  return Array.from(users);
}

// Analyze order book depth
async function analyzeOrderBookDepth(orderBook) {
  console.log(
    `\n${colors.brightCyan}📊 ORDER BOOK DEPTH ANALYSIS${colors.reset}`
  );
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  try {
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    console.log(`\n${colors.bright}Market Spread:${colors.reset}`);
    if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
      const spread = bestAsk - bestBid;
      const spreadFloat = parseFloat(ethers.formatUnits(spread, 6));
      const midPrice = (bestBid + bestAsk) / 2n;
      const midPriceFloat = parseFloat(ethers.formatUnits(midPrice, 6));
      const spreadPercentage = (spreadFloat / midPriceFloat) * 100;

      console.log(
        `  Best Bid: ${colors.green}$${formatPrice(bestBid)}${colors.reset}`
      );
      console.log(
        `  Best Ask: ${colors.red}$${formatPrice(bestAsk)}${colors.reset}`
      );
      console.log(
        `  Spread: ${colors.yellow}$${formatPrice(
          spread
        )} (${spreadPercentage.toFixed(2)}%)${colors.reset}`
      );
      console.log(
        `  Mid Price: ${colors.blue}$${formatPrice(midPrice)}${colors.reset}`
      );
    } else {
      console.log(`  ${colors.red}No active orders in the book${colors.reset}`);
    }

    // Note: Detailed order book depth analysis requires additional functions
    // that are not currently available in the contract
    console.log(`\n${colors.bright}Order Book Depth:${colors.reset}`);
    console.log(
      `  ${colors.yellow}Note: Detailed depth analysis not available${colors.reset}`
    );
    console.log(
      `  ${colors.yellow}Only best bid/ask prices are accessible${colors.reset}`
    );
  } catch (error) {
    console.log(
      `${colors.red}Error analyzing order book depth: ${error.message}${colors.reset}`
    );
  }
}

// Analyze user positions
async function analyzeUserPositions(orderBook, vault, users) {
  console.log(
    `\n${colors.brightCyan}👥 USER POSITIONS ANALYSIS${colors.reset}`
  );
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  const currentPrice = await orderBook.getMarkPrice();
  console.log(
    `\n${colors.bright}Current Mark Price: ${colors.blue}$${formatPrice(
      currentPrice
    )}${colors.reset}\n`
  );

  for (const user of users) {
    try {
      const position = await orderBook.userPositions(user);
      const availableCollateral = await vault.getAvailableCollateral(user);

      if (position !== 0n) {
        console.log(
          `${colors.bright}User: ${colors.cyan}${user}${colors.reset}`
        );
        console.log(
          `  Simple Position: ${
            position > 0n ? colors.green : colors.red
          }${formatAmount(position)} units${colors.reset}`
        );
        console.log(
          `  Available Collateral: $${formatUSDC(availableCollateral)}`
        );

        // Check isolated positions for more detailed analysis
        const positionIds = await orderBook.getUserPositions(user);
        if (positionIds.length > 0) {
          console.log(`  Isolated Positions: ${positionIds.length}`);

          for (const positionId of positionIds) {
            const isolatedPos = await orderBook.getPosition(user, positionId);
            const { pnl, isProfit, percentage } = calculatePnL(
              isolatedPos.size,
              isolatedPos.entryPrice,
              currentPrice
            );

            const positionType = isolatedPos.size > 0n ? "LONG" : "SHORT";
            const positionColor =
              isolatedPos.size > 0n ? colors.green : colors.red;
            const pnlColor = isProfit ? colors.green : colors.red;

            console.log(`    Position #${positionId}:`);
            console.log(
              `      Size: ${positionColor}${positionType} ${formatAmount(
                isolatedPos.size
              )} units${colors.reset}`
            );
            console.log(
              `      Entry Price: $${formatPrice(isolatedPos.entryPrice)}`
            );
            console.log(`      Current Price: $${formatPrice(currentPrice)}`);
            console.log(
              `      PnL: ${pnlColor}${isProfit ? "+" : ""}$${formatUSDC(
                pnl
              )} (${percentage.toFixed(2)}%)${colors.reset}`
            );
            console.log(
              `      Isolated Margin: $${formatUSDC(
                isolatedPos.isolatedMargin
              )}`
            );
            console.log(
              `      Liquidation Price: ${colors.red}$${formatPrice(
                isolatedPos.liquidationPrice
              )}${colors.reset}`
            );
          }
        }

        console.log();
      } else {
        // Check if user has isolated positions even if simple position is 0
        const positionIds = await orderBook.getUserPositions(user);
        if (positionIds.length > 0) {
          console.log(
            `${colors.bright}User: ${colors.cyan}${user}${colors.reset}`
          );
          console.log(`  Simple Position: ${colors.dim}None${colors.reset}`);
          console.log(`  Isolated Positions: ${positionIds.length}`);

          for (const positionId of positionIds) {
            const isolatedPos = await orderBook.getPosition(user, positionId);
            const { pnl, isProfit, percentage } = calculatePnL(
              isolatedPos.size,
              isolatedPos.entryPrice,
              currentPrice
            );

            const positionType = isolatedPos.size > 0n ? "LONG" : "SHORT";
            const positionColor =
              isolatedPos.size > 0n ? colors.green : colors.red;
            const pnlColor = isProfit ? colors.green : colors.red;

            console.log(`    Position #${positionId}:`);
            console.log(
              `      Size: ${positionColor}${positionType} ${formatAmount(
                isolatedPos.size
              )} units${colors.reset}`
            );
            console.log(
              `      Entry Price: $${formatPrice(isolatedPos.entryPrice)}`
            );
            console.log(`      Current Price: $${formatPrice(currentPrice)}`);
            console.log(
              `      PnL: ${pnlColor}${isProfit ? "+" : ""}$${formatUSDC(
                pnl
              )} (${percentage.toFixed(2)}%)${colors.reset}`
            );
            console.log(
              `      Isolated Margin: $${formatUSDC(
                isolatedPos.isolatedMargin
              )}`
            );
            console.log(
              `      Liquidation Price: ${colors.red}$${formatPrice(
                isolatedPos.liquidationPrice
              )}${colors.reset}`
            );
          }
          console.log();
        } else {
          console.log(
            `${colors.bright}User: ${colors.cyan}${user}${colors.reset} - ${colors.dim}No position${colors.reset}`
          );
          console.log(
            `  Available Collateral: $${formatUSDC(availableCollateral)}\n`
          );
        }
      }
    } catch (error) {
      console.log(
        `${colors.red}Error analyzing user ${user}: ${error.message}${colors.reset}\n`
      );
    }
  }
}

// Analyze open orders
async function analyzeOpenOrders(orderBook, users) {
  console.log(`\n${colors.brightCyan}📋 OPEN ORDERS ANALYSIS${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  for (const user of users) {
    try {
      const userOrders = await orderBook.getUserOrders(user);

      if (userOrders.length > 0) {
        console.log(
          `\n${colors.bright}User: ${colors.cyan}${user}${colors.reset}`
        );

        for (const orderId of userOrders) {
          const order = await orderBook.orders(orderId);
          if (order.amount > 0n) {
            // Only show active orders
            const orderType = order.isBuy ? "BUY" : "SELL";
            const orderColor = order.isBuy ? colors.green : colors.red;

            console.log(
              `  Order #${orderId}: ${orderColor}${orderType}${
                colors.reset
              } ${formatAmount(order.amount)} @ $${formatPrice(order.price)}`
            );
            console.log(
              `    Margin Required: $${formatUSDC(order.marginRequired)}`
            );
            console.log(
              `    Timestamp: ${new Date(
                Number(order.timestamp) * 1000
              ).toLocaleString()}`
            );
          }
        }
      }
    } catch (error) {
      console.log(
        `${colors.red}Error analyzing orders for user ${user}: ${error.message}${colors.reset}`
      );
    }
  }
}

// Simulate liquidation scenario
async function simulateLiquidation(orderBook, vault, targetUser, targetPrice) {
  console.log(`\n${colors.brightCyan}⚡ LIQUIDATION SIMULATION${colors.reset}`);
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

  try {
    const currentPrice = await orderBook.getMarkPrice();
    const positionIds = await orderBook.getUserPositions(targetUser);

    if (positionIds.length === 0) {
      console.log(
        `${colors.yellow}User ${targetUser} has no positions to liquidate${colors.reset}`
      );
      return;
    }

    console.log(
      `\n${colors.bright}Target User: ${colors.cyan}${targetUser}${colors.reset}`
    );
    console.log(`Current Price: $${formatPrice(currentPrice)}`);

    // Analyze each isolated position
    for (const positionId of positionIds) {
      const isolatedPos = await orderBook.getPosition(targetUser, positionId);
      const liquidationPrice = isolatedPos.liquidationPrice;

      console.log(`\nPosition #${positionId}:`);
      console.log(
        `  Size: ${
          isolatedPos.size > 0n ? colors.green : colors.red
        }${formatAmount(isolatedPos.size)} units${colors.reset}`
      );
      console.log(`  Entry Price: $${formatPrice(isolatedPos.entryPrice)}`);
      console.log(
        `  Liquidation Price: ${colors.red}$${formatPrice(liquidationPrice)}${
          colors.reset
        }`
      );
      console.log(
        `  Isolated Margin: $${formatUSDC(isolatedPos.isolatedMargin)}`
      );

      if (targetPrice) {
        console.log(
          `\n${colors.bright}Simulating price movement to: ${
            colors.yellow
          }$${formatPrice(targetPrice)}${colors.reset}`
        );

        const { pnl, isProfit, percentage } = calculatePnL(
          isolatedPos.size,
          isolatedPos.entryPrice,
          targetPrice
        );
        console.log(
          `PnL at target price: ${
            isProfit ? colors.green : colors.red
          }$${formatUSDC(pnl)} (${percentage.toFixed(2)}%)${colors.reset}`
        );

        const willLiquidate =
          (isolatedPos.size > 0n && targetPrice <= liquidationPrice) ||
          (isolatedPos.size < 0n && targetPrice >= liquidationPrice);

        if (willLiquidate) {
          console.log(
            `${colors.brightRed}⚠️  POSITION WOULD BE LIQUIDATED! ⚠️${colors.reset}`
          );
        } else {
          console.log(
            `${colors.green}✅ Position would remain safe${colors.reset}`
          );
        }
      }

      // Calculate steps needed to reach liquidation
      const priceDiff =
        isolatedPos.size > 0n
          ? liquidationPrice - currentPrice
          : currentPrice - liquidationPrice;

      const priceDiffFloat = parseFloat(ethers.formatUnits(priceDiff, 6));
      console.log(`\n${colors.bright}Steps to liquidation:${colors.reset}`);
      console.log(
        `  Price movement needed: ${colors.yellow}$${formatPrice(priceDiff)}${
          colors.reset
        }`
      );
      console.log(
        `  Percentage move: ${colors.yellow}${(
          (priceDiffFloat / parseFloat(ethers.formatUnits(currentPrice, 6))) *
          100
        ).toFixed(2)}%${colors.reset}`
      );
    }
  } catch (error) {
    console.log(
      `${colors.red}Error in liquidation simulation: ${error.message}${colors.reset}`
    );
  }
}

// Main analyzer function
async function runGrandAnalyzer() {
  console.log(`${colors.brightCyan}`);
  console.log(
    "╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║                    🎯 GRAND ANALYZER 🎯                      ║"
  );
  console.log(
    "║              Comprehensive Trading System Analysis           ║"
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log(`${colors.reset}`);

  try {
    // Get contracts
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const usdc = await getContract("MOCK_USDC");

    console.log(
      `${colors.bright}📡 Connected to contracts successfully${colors.reset}\n`
    );

    // Get all users
    const users = await getAllUsers(orderBook, vault);
    console.log(
      `${colors.bright}👥 Found ${users.length} users in the system${colors.reset}\n`
    );

    // Analyze order book depth
    await analyzeOrderBookDepth(orderBook);

    // Analyze user positions
    await analyzeUserPositions(orderBook, vault, users);

    // Analyze open orders
    await analyzeOpenOrders(orderBook, users);

    // System health summary
    console.log(
      `\n${colors.brightCyan}🏥 SYSTEM HEALTH SUMMARY${colors.reset}`
    );
    console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`);

    const currentPrice = await orderBook.getMarkPrice();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    console.log(`\n${colors.bright}Market Status:${colors.reset}`);
    console.log(`  Mark Price: $${formatPrice(currentPrice)}`);
    console.log(
      `  Best Bid: ${bestBid > 0n ? `$${formatPrice(bestBid)}` : "None"}`
    );
    console.log(
      `  Best Ask: ${
        bestAsk < ethers.MaxUint256 ? `$${formatPrice(bestAsk)}` : "None"
      }`
    );

    if (bestBid > 0n && bestAsk < ethers.MaxUint256) {
      const spread = bestAsk - bestBid;
      const midPrice = (bestBid + bestAsk) / 2n;
      const spreadPercentage =
        (parseFloat(ethers.formatUnits(spread, 6)) /
          parseFloat(ethers.formatUnits(midPrice, 6))) *
        100;
      console.log(
        `  Spread: $${formatPrice(spread)} (${spreadPercentage.toFixed(2)}%)`
      );
    }

    // Check for liquidation risks
    console.log(
      `\n${colors.bright}Liquidation Risk Assessment:${colors.reset}`
    );
    let liquidationRisks = 0;

    for (const user of users) {
      try {
        // Check isolated positions for liquidation risk
        const positionIds = await orderBook.getUserPositions(user);
        for (const positionId of positionIds) {
          const isolatedPos = await orderBook.getPosition(user, positionId);
          const liquidationPrice = isolatedPos.liquidationPrice;

          const isAtRisk =
            (isolatedPos.size > 0n &&
              currentPrice <= (liquidationPrice * 110n) / 100n) ||
            (isolatedPos.size < 0n &&
              currentPrice >= (liquidationPrice * 90n) / 100n);

          if (isAtRisk) {
            liquidationRisks++;
            console.log(
              `  ${
                colors.red
              }⚠️  ${user} (Position #${positionId}): Liquidation at $${formatPrice(
                liquidationPrice
              )}${colors.reset}`
            );
          }
        }
      } catch (error) {
        // Skip users with errors
      }
    }

    if (liquidationRisks === 0) {
      console.log(
        `  ${colors.green}✅ No immediate liquidation risks detected${colors.reset}`
      );
    } else {
      console.log(
        `  ${colors.red}⚠️  ${liquidationRisks} position(s) at liquidation risk${colors.reset}`
      );
    }

    console.log(
      `\n${colors.brightGreen}🎉 Analysis complete!${colors.reset}\n`
    );
  } catch (error) {
    console.log(
      `${colors.red}❌ Error in grand analyzer: ${error.message}${colors.reset}`
    );
    console.log(error.stack);
  }
}

// Export functions for reuse
module.exports = {
  runGrandAnalyzer,
  analyzeOrderBookDepth,
  analyzeUserPositions,
  analyzeOpenOrders,
  simulateLiquidation,
  calculatePnL,
  formatPrice,
  formatAmount,
  formatUSDC,
};

// Run if called directly
if (require.main === module) {
  runGrandAnalyzer().catch(console.error);
}
