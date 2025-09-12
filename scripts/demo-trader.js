// demo-trader.js - Demo script showing interactive trader features
//
// 🎯 PURPOSE: Demonstrate the interactive trader capabilities
//
const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

// Color functions
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function gradient(text) {
  const chars = text.split("");
  const gradientColors = [colors.magenta, colors.blue, colors.cyan];
  return chars
    .map((char, i) =>
      colorText(char, gradientColors[i % gradientColors.length])
    )
    .join("");
}

async function main() {
  console.clear();

  const demoArt = `
${gradient("🎮 HYPERLIQUID INTERACTIVE TRADER DEMO 🎮")}
${gradient("═".repeat(60))}
`;

  console.log(demoArt);
  console.log(
    colorText("\n🚀 Welcome to the Interactive Trading Demo!", colors.bright)
  );
  console.log(
    colorText(
      "This demo shows what you can do with the interactive trader.",
      colors.cyan
    )
  );

  try {
    // Load contracts
    console.log(colorText("\n📡 Loading smart contracts...", colors.yellow));
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await getContract("MOCK_USDC");
    const vault = await getContract("CENTRALIZED_VAULT");

    // Get users
    const [deployer, user1, user2] = await ethers.getSigners();

    console.log(colorText("✅ Contracts loaded successfully!", colors.green));

    // Show current market state
    console.log(colorText("\n📊 CURRENT MARKET STATE", colors.bright));
    console.log(colorText("─".repeat(40), colors.dim));

    const [buyCount, sellCount] = await orderBook.getActiveOrdersCount();
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();

    console.log(colorText(`📈 Active Buy Orders: ${buyCount}`, colors.green));
    console.log(colorText(`📉 Active Sell Orders: ${sellCount}`, colors.red));
    console.log(
      colorText(`💰 Best Bid: $${ethers.formatUnits(bestBid, 6)}`, colors.green)
    );
    console.log(
      colorText(
        `💸 Best Ask: $${ethers.formatUnits(bestAsk > 0 ? bestAsk : 0, 6)}`,
        colors.red
      )
    );

    // Show user portfolios
    console.log(colorText("\n👥 USER PORTFOLIOS", colors.bright));
    console.log(colorText("─".repeat(40), colors.dim));

    const users = [
      { name: "Deployer", signer: deployer },
      { name: "User 1", signer: user1 },
      { name: "User 2", signer: user2 },
    ];

    for (const user of users) {
      const balance = await mockUSDC.balanceOf(user.signer.address);
      const collateral = await vault.userCollateral(user.signer.address);
      const orders = await orderBook.getUserOrders(user.signer.address);

      console.log(colorText(`\n${user.name}:`, colors.cyan));
      console.log(
        colorText(
          `  💳 USDC Balance: ${ethers.formatUnits(balance, 6)} USDC`,
          colors.yellow
        )
      );
      console.log(
        colorText(
          `  🏦 Collateral: ${ethers.formatUnits(collateral, 6)} USDC`,
          colors.blue
        )
      );
      console.log(
        colorText(`  📋 Active Orders: ${orders.length}`, colors.magenta)
      );
    }

    // Show interactive trader features
    console.log(colorText("\n🎮 INTERACTIVE TRADER FEATURES", colors.bright));
    console.log(colorText("─".repeat(40), colors.dim));

    const features = [
      "📈 Place Limit Buy/Sell Orders",
      "🛒 Execute Market Orders",
      "📊 Real-time Order Book Display",
      "💰 Portfolio Management",
      "🏦 Collateral Deposit/Withdrawal",
      "📋 Order History & Tracking",
      "❌ Order Cancellation",
      "🔄 Multi-user Account Switching",
      "🎨 Beautiful Terminal Interface",
      "⚡ Live Market Data Updates",
    ];

    features.forEach((feature, i) => {
      console.log(colorText(`  ${feature}`, colors.cyan));
    });

    // Instructions
    console.log(colorText("\n🚀 HOW TO START TRADING", colors.bright));
    console.log(colorText("─".repeat(40), colors.dim));

    console.log(
      colorText("\n1. Launch the interactive trader:", colors.yellow)
    );
    console.log(colorText("   npm run trade", colors.green));
    console.log(colorText("   OR", colors.dim));
    console.log(
      colorText(
        "   npx hardhat run scripts/interactive-trader.js --network localhost",
        colors.green
      )
    );

    console.log(colorText("\n2. Select your trading account", colors.yellow));
    console.log(
      colorText("3. Choose from the interactive menu options", colors.yellow)
    );
    console.log(
      colorText("4. Place orders and manage your portfolio", colors.yellow)
    );

    console.log(colorText("\n🎯 QUICK COMMANDS", colors.bright));
    console.log(colorText("─".repeat(40), colors.dim));
    console.log(
      colorText("  npm run trade    - Start interactive trader", colors.cyan)
    );
    console.log(colorText("  npm run viewer   - View order book", colors.cyan));
    console.log(
      colorText("  node trade.js    - Alternative launcher", colors.cyan)
    );

    console.log(
      colorText(
        "\n✨ Ready to start trading! Launch the interactive trader now!",
        colors.bright
      )
    );
    console.log(gradient("═".repeat(60)));
  } catch (error) {
    console.log(colorText("❌ Demo failed: " + error.message, colors.red));
  }
}

main().catch(console.error);
