#!/usr/bin/env node

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

function formatNumber(value, decimals = 2) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function main() {
  console.log(colorText("\n🔍 MARKET STATE ANALYSIS", colors.bright));
  console.log(colorText("═".repeat(80), colors.cyan));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await contracts.getContract("MOCK_USDC");
    const factory = await contracts.getContract("FUTURES_MARKET_FACTORY");

    // Get deployment info
    const deploymentInfo = require("../deployments/localhost-deployment.json");
    const marketId = deploymentInfo.aluminumMarket.marketId;
    const deployer = deploymentInfo.deployer;

    console.log(colorText("\n📊 MARKET INFORMATION", colors.yellow));
    console.log(`  Market Symbol: ${deploymentInfo.aluminumMarket.symbol}`);
    console.log(`  Market ID: ${marketId}`);
    console.log(
      `  OrderBook Address: ${deploymentInfo.aluminumMarket.orderBook}`
    );
    console.log(`  Deployer Address: ${deployer}`);

    // Get market details from factory
    const marketSymbol = await factory.getMarketSymbol(marketId);
    const marketOrderBook = await factory.getOrderBookForMarket(marketId);
    const marketExists = await factory.doesMarketExist(marketId);
    console.log(colorText("\n🏭 FACTORY MARKET INFO", colors.blue));
    console.log(`  Symbol: ${marketSymbol}`);
    console.log(`  OrderBook: ${marketOrderBook}`);
    console.log(`  Exists: ${marketExists ? "Yes" : "No"}`);

    // Check mark price
    const markPrice = await vault.marketMarkPrices(marketId);
    console.log(colorText("\n💰 PRICING INFORMATION", colors.green));
    console.log(`  Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`);

    // Get order book state
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`  Best Bid: ${ethers.formatUnits(bestBid, 6)} USDC`);
    console.log(`  Best Ask: ${ethers.formatUnits(bestAsk, 6)} USDC`);

    // Calculate mid price if both exist
    if (bestBid > 0 && bestAsk > 0) {
      const midPrice = (BigInt(bestBid) + BigInt(bestAsk)) / 2n;
      console.log(`  Mid Price: ${ethers.formatUnits(midPrice, 6)} USDC`);
    }

    // Get active orders count
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    console.log(`  Active Buy Orders: ${buyCount}`);
    console.log(`  Active Sell Orders: ${sellCount}`);

    // Analyze deployer's state
    console.log(colorText("\n👤 DEPLOYER ANALYSIS", colors.magenta));
    console.log(`  Address: ${deployer}`);

    // Get collateral info
    const collateralBalance = await vault.userCollateral(deployer);
    console.log(
      `  Vault Collateral: ${ethers.formatUnits(collateralBalance, 6)} USDC`
    );

    // Get USDC balance
    const usdcBalance = await mockUSDC.balanceOf(deployer);
    console.log(`  USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

    // Get positions
    const positions = await vault.getUserPositions(deployer);
    console.log(`\n  📈 Positions (${positions.length}):`);

    let totalSize = 0n;
    let totalNotional = 0n;
    let totalPnL = 0n;

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      console.log(`\n  Position ${i + 1}:`);
      console.log(`    Market ID: ${pos.marketId}`);
      console.log(`    Is Long: ${pos.isLong ? "YES" : "NO"}`);
      console.log(`    Size: ${ethers.formatUnits(pos.size, 18)} ALU`);
      console.log(
        `    Entry Price: ${ethers.formatUnits(pos.entryPrice, 6)} USDC`
      );
      console.log(
        `    Margin Locked: ${ethers.formatUnits(pos.marginLocked, 6)} USDC`
      );

      // Calculate position details
      const notionalValue = (pos.size * pos.entryPrice) / BigInt(10 ** 18); // Adjust for decimals
      console.log(
        `    Notional Value: ${ethers.formatUnits(notionalValue, 6)} USDC`
      );

      // Calculate P&L
      if (markPrice > 0) {
        let pnl;
        if (pos.isLong) {
          pnl = ((markPrice - pos.entryPrice) * pos.size) / BigInt(10 ** 18);
        } else {
          pnl = ((pos.entryPrice - markPrice) * pos.size) / BigInt(10 ** 18);
        }
        console.log(`    Unrealized P&L: ${ethers.formatUnits(pnl, 6)} USDC`);
        totalPnL += pnl;
      }

      totalSize += pos.size;
      totalNotional += notionalValue;
    }

    console.log(`\n  📊 Position Summary:`);
    console.log(`    Total Size: ${ethers.formatUnits(totalSize, 18)} ALU`);
    console.log(
      `    Total Notional: ${ethers.formatUnits(totalNotional, 6)} USDC`
    );
    if (markPrice > 0) {
      console.log(
        `    Total Unrealized P&L: ${ethers.formatUnits(totalPnL, 6)} USDC`
      );
    }

    // Get margin summary
    const marginSummary = await vault.getMarginSummary(deployer);
    console.log(`\n  💳 Margin Summary:`);
    console.log(
      `    Total Locked Margin: ${ethers.formatUnits(
        marginSummary.totalLockedMargin,
        6
      )} USDC`
    );
    console.log(
      `    Available Collateral: ${ethers.formatUnits(
        marginSummary.availableCollateral,
        6
      )} USDC`
    );
    console.log(
      `    Unrealized P&L: ${ethers.formatUnits(
        marginSummary.unrealizedPnL,
        6
      )} USDC`
    );

    // Get active orders
    const orderIds = await orderBook.getUserOrders(deployer);
    console.log(`\n  📋 Active Orders (${orderIds.length}):`);

    for (const orderId of orderIds) {
      const order = await orderBook.getOrder(orderId);
      if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
        const price = ethers.formatUnits(order.price, 6);
        const amount = ethers.formatUnits(order.amount, 18);
        const side = order.isBuy ? "BUY" : "SELL";
        const filled = ethers.formatUnits(order.filled, 18);
        const remaining = ethers.formatUnits(order.amount - order.filled, 18);

        console.log(`\n    Order #${orderId}:`);
        console.log(`      ${side} ${amount} ALU @ ${price} USDC`);
        console.log(`      Filled: ${filled} ALU`);
        console.log(`      Remaining: ${remaining} ALU`);
        console.log(
          `      Status: ${order.filled === order.amount ? "FILLED" : "ACTIVE"}`
        );
      }
    }

    // Analyze how deployer got 150 size
    console.log(colorText("\n🔍 POSITION ANALYSIS", colors.yellow));
    console.log("  How did the deployer get a position size of 150 ALU?");
    console.log("  Possible scenarios:");
    console.log("  1. Executed buy orders totaling 150 ALU");
    console.log("  2. Multiple trades that netted to 150 ALU");
    console.log("  3. Market maker or liquidity provider activity");

    // Try to get trade history (if available)
    console.log("\n  Checking for trade execution...");

    // Calculate theoretical P&L for different scenarios
    if (positions.length > 0 && totalSize > 0) {
      const avgEntryPrice = positions[0].entryPrice; // Simplified for single position
      console.log(`\n  📈 P&L Scenarios:`);
      console.log(
        `    Entry Price: ${ethers.formatUnits(avgEntryPrice, 6)} USDC`
      );

      if (markPrice > 0) {
        const priceChange = Number(
          ethers.formatUnits(markPrice - avgEntryPrice, 6)
        );
        const percentChange =
          (priceChange / Number(ethers.formatUnits(avgEntryPrice, 6))) * 100;
        console.log(
          `    Current Mark Price: ${ethers.formatUnits(markPrice, 6)} USDC`
        );
        console.log(
          `    Price Change: ${priceChange >= 0 ? "+" : ""}${formatNumber(
            priceChange
          )} USDC (${percentChange >= 0 ? "+" : ""}${formatNumber(
            percentChange
          )}%)`
        );
      } else {
        console.log(
          `    ⚠️  Mark price is 0 - P&L calculation may be incorrect`
        );
      }
    }

    // Check for any system events or logs
    console.log(colorText("\n📝 RECOMMENDATIONS", colors.cyan));
    console.log(
      "  1. Check trade execution logs to see when positions were created"
    );
    console.log("  2. Verify mark price is being updated correctly");
    console.log("  3. Review order matching logic in the OrderBook contract");
    console.log(
      "  4. Ensure proper decimal handling between ALU (18 decimals) and USDC (6 decimals)"
    );
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
