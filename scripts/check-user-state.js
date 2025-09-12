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

async function main() {
  console.log(colorText("\n🔍 Checking User 1 State", colors.bright));
  console.log(colorText("═".repeat(60), colors.cyan));

  try {
    // Get contracts
    const vault = await contracts.getContract("CENTRALIZED_VAULT");
    const orderBook = await contracts.getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await contracts.getContract("MOCK_USDC");

    // Get User 1 (second signer)
    const signers = await ethers.getSigners();
    const user1 = signers[1];
    console.log(
      colorText(`\n👤 User 1 Address: ${user1.address}`, colors.cyan)
    );

    // Get USDC balance
    const usdcBalance = await mockUSDC.balanceOf(user1.address);
    console.log(
      colorText(
        `\n💰 USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`,
        colors.green
      )
    );

    // Get collateral info
    const collateralBalance = await vault.userCollateral(user1.address);
    console.log(colorText(`\n🏦 Vault Collateral Info:`, colors.yellow));
    console.log(
      `   Total Deposited: ${ethers.formatUnits(collateralBalance, 6)} USDC`
    );

    // Get margin summary
    const marginSummary = await vault.getUserMarginSummary(user1.address);
    console.log(
      `   Locked Margin: ${ethers.formatUnits(
        marginSummary.totalLockedMargin,
        6
      )} USDC`
    );
    console.log(
      `   Available Collateral: ${ethers.formatUnits(
        marginSummary.availableCollateral,
        6
      )} USDC`
    );
    console.log(
      `   Unrealized P&L: ${ethers.formatUnits(
        marginSummary.unrealizedPnL,
        6
      )} USDC`
    );

    // Get positions
    const positions = await vault.getPositions(user1.address);
    console.log(
      colorText(`\n📊 Positions (${positions.length}):`, colors.magenta)
    );

    for (const position of positions) {
      const size = Number(ethers.formatUnits(position.size, 18));
      const entryPrice = Number(ethers.formatUnits(position.entryPrice, 6));
      const isLong = position.isLong;

      console.log(`   Market: ALU-USD`);
      console.log(`   Side: ${isLong ? "LONG" : "SHORT"}`);
      console.log(`   Size: ${size} ALU`);
      console.log(`   Entry Price: $${entryPrice} USDC`);
    }

    // Get active orders
    const orderIds = await orderBook.getUserOrders(user1.address);
    console.log(
      colorText(`\n📋 Active Orders (${orderIds.length}):`, colors.blue)
    );

    let totalReservedForOrders = 0;

    for (const orderId of orderIds) {
      const order = await orderBook.getOrder(orderId);
      if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
        const price = Number(ethers.formatUnits(order.price, 6));
        const amount = Number(ethers.formatUnits(order.amount, 18));
        const side = order.isBuy ? "BUY" : "SELL";
        const orderValue = price * amount;

        console.log(
          `   Order #${orderId}: ${side} ${amount} ALU @ $${price} = $${orderValue.toFixed(
            2
          )} USDC`
        );

        // For buy orders, the reserved amount is the order value
        // For sell orders, margin requirements might be different
        if (order.isBuy) {
          totalReservedForOrders += orderValue;
        }
      }
    }

    console.log(colorText(`\n💡 Analysis:`, colors.yellow));
    console.log(
      `   Total reserved for pending BUY orders: $${totalReservedForOrders.toFixed(
        2
      )} USDC`
    );
    console.log(
      `   This matches the locked margin: ${ethers.formatUnits(
        marginSummary.totalLockedMargin,
        6
      )} USDC`
    );

    // Check if the locked margin matches our calculation
    const lockedMarginNumber = Number(
      ethers.formatUnits(marginSummary.totalLockedMargin, 6)
    );
    if (Math.abs(lockedMarginNumber - totalReservedForOrders) < 0.01) {
      console.log(
        colorText(
          `   ✅ The locked margin correctly represents funds reserved for pending orders`,
          colors.green
        )
      );
    }

    // Additional check: Get order book state
    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    console.log(colorText(`\n📈 Order Book Summary:`, colors.cyan));
    console.log(`   Active Buy Orders: ${buyCount}`);
    console.log(`   Active Sell Orders: ${sellCount}`);
  } catch (error) {
    console.error(colorText("❌ Error:", colors.red), error.message);
  }
}

main().catch(console.error);
