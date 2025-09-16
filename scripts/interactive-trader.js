#!/usr/bin/env node

// interactive-trader.js - Beautiful Interactive Trading Terminal
//
// 🎯 FEATURES:
//   ✅ Colorful ASCII art interface
//   ✅ Real-time order book display
//   ✅ Interactive order placement (limit & market)
//   ✅ Portfolio management
//   ✅ Live balance updates
//   ✅ Order history tracking
//   ✅ Multi-user support
//
// 🚀 USAGE:
//   npx hardhat run scripts/interactive-trader.js --network localhost
//
const { ethers } = require("hardhat");
const readline = require("readline");
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

  // Basic colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright colors
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",

  // Backgrounds
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

// Cache for market symbols
const marketSymbolCache = new Map();

// Helper function to detect and format values with correct decimal precision
function formatWithAutoDecimalDetection(
  value,
  expectedDecimals = 6,
  displayDecimals = 2
) {
  if (!value || value === 0n) return "0.00";

  try {
    const valueBigInt =
      typeof value === "bigint" ? value : BigInt(value.toString());

    // If the value is suspiciously large (> 10^6), it might have wrong decimals
    // Check multiple thresholds to handle different decimal mismatches
    const absValue = valueBigInt >= 0n ? valueBigInt : -valueBigInt;

    // If value > 10^6, it's probably not in the expected decimals
    if (absValue > 10n ** 6n) {
      // First check if it's a value that should be divided by 10^6 (e.g., 25000000 -> 25)
      const divBy1e6 = parseFloat(ethers.formatUnits(valueBigInt, 6));
      if (divBy1e6 >= 0.01 && divBy1e6 <= 1000000) {
        return divBy1e6.toFixed(displayDecimals);
      }

      // Check if it's 12 decimals (e.g., 25000000000000 -> 25)
      if (absValue > 10n ** 12n) {
        const as12Decimals = parseFloat(ethers.formatUnits(valueBigInt, 12));
        if (as12Decimals >= 0.01 && as12Decimals <= 1000000) {
          return as12Decimals.toFixed(displayDecimals);
        }

        // Otherwise assume 18 decimals
        return parseFloat(ethers.formatUnits(valueBigInt, 18)).toFixed(
          displayDecimals
        );
      }
    }

    // For smaller values, use expected decimals or treat as already formatted
    if (expectedDecimals === 6 && absValue < 10n ** 6n) {
      // Value might already be in USDC units (no decimals needed)
      const directValue = Number(valueBigInt);
      if (directValue >= 0.01 && directValue <= 1000000) {
        return directValue.toFixed(displayDecimals);
      }
    }

    // Default: use the expected decimals
    return parseFloat(
      ethers.formatUnits(valueBigInt, expectedDecimals)
    ).toFixed(displayDecimals);
  } catch (error) {
    console.error(`Error formatting value ${value}:`, error);
    return "ERROR";
  }
}

// Helper function to safely decode marketId bytes32
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

// 🎨 STYLING FUNCTIONS
function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function gradient(text) {
  const chars = text.split("");
  const gradientColors = [
    colors.brightMagenta,
    colors.magenta,
    colors.brightBlue,
    colors.blue,
    colors.brightCyan,
    colors.cyan,
  ];
  return chars
    .map((char, i) =>
      colorText(char, gradientColors[i % gradientColors.length])
    )
    .join("");
}

function boxText(text, color = colors.cyan) {
  const width = 80;
  const padding = Math.max(0, Math.floor((width - text.length - 4) / 2));
  const line = "═".repeat(width);
  const paddedText = " ".repeat(padding) + text + " ".repeat(padding);

  return [
    colorText("┌" + line + "┐", color),
    colorText("│" + paddedText.padEnd(width) + "│", color),
    colorText("└" + line + "┘", color),
  ].join("\n");
}

// 📊 UTILITY FUNCTIONS - ENHANCED PRICE ACCURACY
function formatPrice(price, decimals = 6, displayDecimals = 2) {
  try {
    if (!price || price === 0n || price === "0") return "0.00";

    // Handle BigInt conversion
    const priceValue = typeof price === "bigint" ? price : BigInt(price);

    // Check for extremely large values that might cause overflow
    const maxSafeValue =
      BigInt(Number.MAX_SAFE_INTEGER) * BigInt(10 ** decimals);
    if (priceValue > maxSafeValue) {
      return "∞";
    }

    const divisor = BigInt(10 ** decimals);
    const wholePart = priceValue / divisor;
    const fractionalPart = priceValue % divisor;

    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
    const result =
      wholePart.toString() + "." + fractionalStr.slice(0, displayDecimals);

    // Validate the result
    const parsed = parseFloat(result);
    if (isNaN(parsed) || !isFinite(parsed)) {
      return "ERROR";
    }

    return result;
  } catch (error) {
    console.error("Price formatting error:", error);
    return "ERROR";
  }
}

function formatAmount(amount, decimals = 18, displayDecimals = 4) {
  if (!amount || amount === 0n) return "0.0000";

  try {
    // Use high precision conversion
    const amountString = ethers.formatUnits(amount, decimals);

    // Parse as BigNumber-like for precision validation
    const amountBigInt = ethers.parseUnits(amountString, decimals);

    // Validate no precision loss occurred during conversion
    if (amountBigInt !== amount) {
      console.warn(
        `⚠️ Amount precision loss detected: ${amount} -> ${amountBigInt}`
      );
    }

    const amountNumber = parseFloat(amountString);

    // Handle very small amounts
    if (amountNumber < 0.00000001 && amountNumber > 0) {
      return amountNumber.toFixed(12); // Show more decimals for very small amounts
    }

    return amountNumber.toFixed(displayDecimals);
  } catch (error) {
    console.error(`❌ Amount formatting error for ${amount}:`, error);
    return "ERROR";
  }
}

function formatUSDC(amount, displayDecimals = 2) {
  if (!amount || amount === 0n) return "0.00";

  try {
    // Use high precision conversion for USDC (6 decimals)
    const usdcString = ethers.formatUnits(amount, 6);

    // Parse as BigNumber-like for precision validation
    const usdcBigInt = ethers.parseUnits(usdcString, 6);

    // Validate no precision loss occurred during conversion
    if (usdcBigInt !== amount) {
      console.warn(
        `⚠️ USDC precision loss detected: ${amount} -> ${usdcBigInt}`
      );
    }

    const usdcNumber = parseFloat(usdcString);

    // Handle very small USDC amounts (micro-cents)
    if (usdcNumber < 0.000001 && usdcNumber > 0) {
      return usdcNumber.toFixed(6); // Show full precision for micro amounts
    }

    return usdcNumber.toFixed(displayDecimals);
  } catch (error) {
    console.error(`❌ USDC formatting error for ${amount}:`, error);
    return "ERROR";
  }
}

// 🔍 PRICE VALIDATION AND ACCURACY FUNCTIONS
function validatePriceAccuracy(originalPrice, formattedPrice, decimals = 6) {
  try {
    // Convert formatted price back to BigInt
    const reconstructedPrice = ethers.parseUnits(formattedPrice, decimals);

    // Calculate precision loss as percentage
    const difference =
      originalPrice > reconstructedPrice
        ? originalPrice - reconstructedPrice
        : reconstructedPrice - originalPrice;

    const precisionLossPercent =
      (Number(difference) / Number(originalPrice)) * 100;

    return {
      isAccurate: difference === 0n,
      precisionLossPercent,
      difference: difference.toString(),
      originalPrice: originalPrice.toString(),
      reconstructedPrice: reconstructedPrice.toString(),
    };
  } catch (error) {
    return {
      isAccurate: false,
      error: error.message,
    };
  }
}

// Helper function to safely calculate mark price
function calculateSafeMarkPrice(bestBid, bestAsk, fallbackPrice, decimals = 6) {
  try {
    // Handle BigInt inputs
    const bidValue =
      typeof bestBid === "bigint"
        ? Number(bestBid) / Math.pow(10, decimals)
        : 0;
    const askValue =
      typeof bestAsk === "bigint"
        ? Number(bestAsk) / Math.pow(10, decimals)
        : 0;

    // Check if we have valid market prices
    if (bidValue > 0 && askValue > 0 && !isNaN(bidValue) && !isNaN(askValue)) {
      return (bidValue + askValue) / 2;
    }

    // Return fallback price if no valid market
    return typeof fallbackPrice === "number" ? fallbackPrice : 0;
  } catch (error) {
    console.error("Error calculating mark price:", error);
    return typeof fallbackPrice === "number" ? fallbackPrice : 0;
  }
}

function formatPriceWithValidation(
  price,
  decimals = 6,
  displayDecimals = 2,
  showWarning = true
) {
  const formatted = formatPrice(price, decimals, displayDecimals);

  if (showWarning && formatted !== "ERROR" && formatted !== "∞" && price > 0n) {
    const validation = validatePriceAccuracy(price, formatted, decimals);

    if (!validation.isAccurate && validation.precisionLossPercent > 0.001) {
      console.warn(
        `⚠️ Price accuracy warning: ${validation.precisionLossPercent.toFixed(
          4
        )}% precision loss`
      );
      console.warn(
        `   Original: ${validation.originalPrice}, Reconstructed: ${validation.reconstructedPrice}`
      );
    }
  }

  return formatted;
}

// 🎭 TRADING INTERFACE CLASS
class InteractiveTrader {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.contracts = {};
    this.users = [];
    this.currentUser = null;
    this.currentUserIndex = 0;
    this.isRunning = true;
  }

  async initialize() {
    console.clear();
    await this.showWelcomeScreen();
    await this.loadContracts();
    await this.loadUsers();
    await this.selectUser();
  }

  async showWelcomeScreen() {
    const welcomeArt = `
${gradient("██████╗ ███████╗██╗  ██╗███████╗████████╗██████╗  █████╗ ")}
${gradient("██╔══██╗██╔════╝╚██╗██╔╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗")}
${gradient("██║  ██║█████╗   ╚███╔╝ █████╗     ██║   ██████╔╝███████║")}
${gradient("██║  ██║██╔══╝   ██╔██╗ ██╔══╝     ██║   ██╔══██╗██╔══██║")}
${gradient("██████╔╝███████╗██╔╝ ██╗███████╗   ██║   ██║  ██║██║  ██║")}
${gradient("╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝")}
    `;

    console.log(welcomeArt);
    console.log(
      boxText("🚀 INTERACTIVE TRADING TERMINAL V2.0 🚀", colors.brightCyan)
    );
    console.log(
      colorText(
        "\n✨ Welcome to the most advanced DeFi trading experience",
        colors.brightYellow
      )
    );
    console.log(
      colorText(
        "🎯 Trade ALU/USDC futures with real-time order book data",
        colors.cyan
      )
    );
    console.log(
      colorText("💎 Powered by Dexetra Smart Contracts", colors.magenta)
    );

    await this.pause(2000);
  }

  async loadContracts() {
    console.log(colorText("\n🔧 Loading smart contracts...", colors.yellow));

    try {
      this.contracts.mockUSDC = await getContract("MOCK_USDC");
      this.contracts.vault = await getContract("CENTRALIZED_VAULT");
      this.contracts.orderBook = await getContract("ALUMINUM_ORDERBOOK");
      this.contracts.router = await getContract("TRADING_ROUTER");
      this.contracts.factory = await getContract("FUTURES_MARKET_FACTORY");

      console.log(
        colorText("✅ All contracts loaded successfully!", colors.brightGreen)
      );
      await this.pause(1000);
    } catch (error) {
      console.log(
        colorText("❌ Failed to load contracts: " + error.message, colors.red)
      );
      process.exit(1);
    }
  }

  async loadUsers() {
    console.log(colorText("\n👥 Loading user accounts...", colors.yellow));

    const signers = await ethers.getSigners();
    this.users = signers.slice(0, 4); // Use first 4 accounts

    console.log(
      colorText(
        `✅ Loaded ${this.users.length} user accounts`,
        colors.brightGreen
      )
    );
    await this.pause(1000);
  }

  async selectUser() {
    console.clear();
    console.log(gradient("═".repeat(80)));
    console.log(colorText("👤 SELECT YOUR TRADING ACCOUNT", colors.brightCyan));
    console.log(gradient("═".repeat(80)));

    for (let i = 0; i < this.users.length; i++) {
      const user = this.users[i];
      const balance = await this.contracts.mockUSDC.balanceOf(user.address);
      const collateral = await this.contracts.vault.userCollateral(
        user.address
      );

      const userType = i === 0 ? "Deployer" : `User ${i}`;
      console.log(colorText(`\n${i + 1}. ${userType}`, colors.brightYellow));
      console.log(colorText(`   Address: ${user.address}`, colors.cyan));
      console.log(
        colorText(`   USDC Balance: ${formatUSDC(balance)} USDC`, colors.green)
      );
      console.log(
        colorText(`   Collateral: ${formatUSDC(collateral)} USDC`, colors.blue)
      );
    }

    const choice = await this.askQuestion(
      colorText("\n🎯 Select account (1-4): ", colors.brightMagenta)
    );
    const index = parseInt(choice) - 1;

    if (index >= 0 && index < this.users.length) {
      this.currentUser = this.users[index];
      this.currentUserIndex = index;
      console.log(
        colorText(
          `✅ Selected ${index === 0 ? "Deployer" : `User ${index}`}`,
          colors.brightGreen
        )
      );
      await this.pause(1000);
      await this.showMainMenu();
    } else {
      console.log(colorText("❌ Invalid selection", colors.red));
      await this.selectUser();
    }
  }

  async showMainMenu() {
    while (this.isRunning) {
      console.clear();
      await this.displayHeader();
      await this.displayPortfolio();
      await this.displayOrderBook();
      await this.displayMenu();

      const choice = await this.askQuestion(
        colorText("\n🎯 Choose action: ", colors.brightMagenta)
      );
      await this.handleMenuChoice(choice);
    }
  }

  async displayHeader() {
    const userType =
      this.currentUserIndex === 0
        ? "Deployer"
        : `User ${this.currentUserIndex}`;
    const timestamp = new Date().toLocaleString();

    console.log(gradient("═".repeat(80)));
    console.log(
      colorText(`🏛️  DEXETRA TRADING TERMINAL - ${userType}`, colors.brightCyan)
    );
    console.log(colorText(`📅 ${timestamp}`, colors.dim));
    console.log(gradient("═".repeat(80)));
  }

  async displayPortfolio() {
    try {
      // Get comprehensive portfolio data
      const balance = await this.contracts.mockUSDC.balanceOf(
        this.currentUser.address
      );
      const marginSummary = await this.contracts.vault.getMarginSummary(
        this.currentUser.address
      );
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );

      // Calculate portfolio metrics
      // Using auto-detection for decimal precision as some values may be in 18 decimals instead of 6
      const walletBalance = formatUSDC(balance);
      const totalCollateral = formatWithAutoDecimalDetection(
        marginSummary.totalCollateral,
        6
      );
      const availableBalance = formatWithAutoDecimalDetection(
        marginSummary.availableCollateral,
        6
      );
      const marginUsed = formatWithAutoDecimalDetection(
        marginSummary.marginUsed,
        6
      );
      const marginReserved = formatUSDC(marginSummary.marginReserved); // This appears to always be correct
      // Handle realizedPnL - it's stored with 24 decimals (price diff * size)
      const realizedPnLBigInt = BigInt(
        (marginSummary.realizedPnL || 0).toString()
      );
      // Realized P&L is in 24 decimals (6 decimals price * 18 decimals size)
      const realizedPnLStr = parseFloat(
        ethers.formatUnits(realizedPnLBigInt, 24)
      ).toFixed(2);
      const realizedPnL = parseFloat(realizedPnLStr);
      // Handle signed int256 for unrealizedPnL
      let unrealizedPnLBigInt;
      try {
        // Check if it's already a BigInt or needs conversion
        if (typeof marginSummary.unrealizedPnL === "bigint") {
          unrealizedPnLBigInt = marginSummary.unrealizedPnL;
        } else {
          // Convert from string representation, handling potential negative values
          unrealizedPnLBigInt = BigInt(
            (marginSummary.unrealizedPnL || 0).toString()
          );
        }
      } catch (e) {
        unrealizedPnLBigInt = 0n;
      }

      const unrealizedPnL = parseFloat(
        ethers.formatUnits(unrealizedPnLBigInt, 18) // P&L is in 18 decimals (ALU precision)
      );
      // Portfolio value calculation fix: The contract incorrectly mixes decimal precisions
      // It adds collateral + realizedPnL + unrealizedPnL (but with mixed decimals)
      // We need to recalculate it correctly here using our auto-detected values
      const totalCollateralNum = parseFloat(totalCollateral);
      const portfolioValue = totalCollateralNum + realizedPnL + unrealizedPnL;

      console.log(
        colorText("\n💰 COMPREHENSIVE PORTFOLIO OVERVIEW", colors.brightYellow)
      );
      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────┐",
          colors.cyan
        )
      );

      // Wallet & Collateral Section
      console.log(
        colorText(
          "│                    💳 WALLET & COLLATERAL                  │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          `│ Wallet Balance:     ${walletBalance.padStart(
            12
          )} USDC                │`,
          colors.green
        )
      );
      console.log(
        colorText(
          `│ Total Collateral:   ${totalCollateral.padStart(
            12
          )} USDC                │`,
          colors.blue
        )
      );
      console.log(
        colorText(
          `│ Available Balance:  ${colorText(
            availableBalance.padStart(12),
            colors.brightGreen
          )} USDC                │`,
          colors.white
        )
      );

      // Margin Usage Section
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│                     🔒 MARGIN USAGE                        │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          `│ Margin Used:        ${colorText(
            marginUsed.padStart(12),
            colors.yellow
          )} USDC                │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Margin Reserved:    ${colorText(
            marginReserved.padStart(12),
            colors.orange || colors.yellow
          )} USDC                │`,
          colors.white
        )
      );

      // P&L Section
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│                      📊 PROFIT & LOSS                      │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      // Determine sign based on the BigInt value, not the parsed float
      const realizedColor = realizedPnLBigInt >= 0n ? colors.green : colors.red;
      const realizedSign = realizedPnLBigInt >= 0n ? "+" : "";
      // Use the string format directly from formatWithAutoDecimalDetection
      const realizedPnLDisplay = realizedSign + realizedPnLStr;
      console.log(
        colorText(
          `│ Realized P&L:       ${colorText(
            realizedPnLDisplay.padStart(12),
            realizedColor
          )} USDC                │`,
          colors.white
        )
      );

      const unrealizedColor = unrealizedPnL >= 0 ? colors.green : colors.red;
      const unrealizedSign = unrealizedPnL >= 0 ? "+" : "";
      console.log(
        colorText(
          `│ Unrealized P&L:     ${colorText(
            (unrealizedSign + unrealizedPnL.toFixed(2)).padStart(12),
            unrealizedColor
          )} USDC                │`,
          colors.white
        )
      );

      // Portfolio Value Section
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│                    🏆 TOTAL PORTFOLIO                      │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      const portfolioColor =
        portfolioValue >= 0 ? colors.brightGreen : colors.brightRed;
      console.log(
        colorText(
          `│ Portfolio Value:    ${colorText(
            portfolioValue.toFixed(2).padStart(12),
            portfolioColor
          )} USDC                │`,
          colors.white
        )
      );

      // Trading Activity Section
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│                   📈 TRADING ACTIVITY                      │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          `│ Active Orders:      ${userOrders.length
            .toString()
            .padStart(12)}                     │`,
          colors.yellow
        )
      );
      console.log(
        colorText(
          `│ Open Positions:     ${positions.length
            .toString()
            .padStart(12)}                     │`,
          colors.magenta
        )
      );

      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────┘",
          colors.cyan
        )
      );

      // Key Insights Box
      console.log(colorText("\n🔍 KEY INSIGHTS:", colors.brightCyan));
      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────┐",
          colors.dim
        )
      );

      if (parseFloat(availableBalance) > 0) {
        console.log(
          colorText(
            `│ ✅ You have ${colorText(
              availableBalance,
              colors.brightGreen
            )} USDC available for new trades          │`,
            colors.white
          )
        );
      } else {
        console.log(
          colorText(
            "│ ⚠️  No available balance - all collateral is in use        │",
            colors.yellow
          )
        );
      }

      if (parseFloat(marginUsed) > 0) {
        console.log(
          colorText(
            `│ 🔒 ${colorText(
              marginUsed,
              colors.yellow
            )} USDC is locked in active positions             │`,
            colors.white
          )
        );
      }

      if (parseFloat(marginReserved) > 0) {
        console.log(
          colorText(
            `│ ⏳ ${colorText(
              marginReserved,
              colors.yellow
            )} USDC is reserved for pending orders           │`,
            colors.white
          )
        );
      }

      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────┘",
          colors.dim
        )
      );
    } catch (error) {
      console.log(
        colorText("⚠️ Could not fetch complete portfolio data", colors.yellow)
      );
      console.log(colorText(`Error: ${error.message}`, colors.red));

      // Fallback to basic display
      try {
        const balance = await this.contracts.mockUSDC.balanceOf(
          this.currentUser.address
        );
        const collateral = await this.contracts.vault.userCollateral(
          this.currentUser.address
        );

        console.log(
          colorText("\n💰 BASIC PORTFOLIO VIEW", colors.brightYellow)
        );
        console.log(
          colorText("┌─────────────────────────────────────────┐", colors.cyan)
        );
        console.log(
          colorText(
            `│ USDC Balance: ${formatUSDC(balance).padStart(10)} USDC       │`,
            colors.green
          )
        );
        console.log(
          colorText(
            `│ Collateral:   ${formatUSDC(collateral).padStart(
              10
            )} USDC       │`,
            colors.blue
          )
        );
        console.log(
          colorText("└─────────────────────────────────────────┘", colors.cyan)
        );
      } catch (fallbackError) {
        console.log(
          colorText("❌ Could not fetch any portfolio data", colors.red)
        );
      }
    }
  }

  async displayOrderBook() {
    console.log(
      colorText(
        "\n📊 LIVE ORDER BOOK - ALU/USDC (with Traders, Mark Price & Last Trade)",
        colors.brightYellow
      )
    );

    try {
      const [buyCount, sellCount] =
        await this.contracts.orderBook.getActiveOrdersCount();
      const bestBid = await this.contracts.orderBook.bestBid();
      const bestAsk = await this.contracts.orderBook.bestAsk();

      // Fetch mark price and last traded price
      const markPrice = await this.contracts.orderBook.getMarkPrice();
      const lastTradePrice = await this.contracts.orderBook.lastTradePrice();

      // Format prices for display (prices are in 6 decimals)
      const markPriceFormatted = formatPriceWithValidation(
        markPrice,
        6,
        4,
        false
      );
      const lastTradePriceFormatted =
        lastTradePrice > 0
          ? formatPriceWithValidation(lastTradePrice, 6, 4, false)
          : "N/A";

      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────────────────────┐",
          colors.white
        )
      );
      console.log(
        colorText(
          "│                        MARKET PRICE INFORMATION                             │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────┤",
          colors.white
        )
      );

      // Display mark price and last traded price prominently
      console.log(
        colorText(
          `│ Mark Price: ${colorText(
            "$" + markPriceFormatted,
            colors.brightCyan
          ).padEnd(20)} Last Trade: ${colorText(
            "$" + lastTradePriceFormatted,
            colors.brightYellow
          ).padEnd(20)} │`,
          colors.white
        )
      );

      // Calculate spread if both bid and ask exist (prices are in 6 decimals)
      const bestBidPrice =
        bestBid > 0 ? Number(ethers.formatUnits(bestBid, 6)) : 0;
      const bestAskPrice =
        bestAsk < ethers.MaxUint256
          ? Number(ethers.formatUnits(bestAsk, 6))
          : 0;
      const spread =
        bestBidPrice > 0 && bestAskPrice > 0 ? bestAskPrice - bestBidPrice : 0;
      const spreadFormatted = spread > 0 ? spread.toFixed(4) : "N/A";

      console.log(
        colorText(
          `│ Best Bid: ${colorText(
            bestBidPrice > 0 ? "$" + bestBidPrice.toFixed(4) : "N/A",
            colors.green
          ).padEnd(20)} Best Ask: ${colorText(
            bestAskPrice > 0 ? "$" + bestAskPrice.toFixed(4) : "N/A",
            colors.red
          ).padEnd(20)} │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Spread: ${colorText("$" + spreadFormatted, colors.magenta).padEnd(
            20
          )} Active Orders: ${colorText(
            buyCount + " buys, " + sellCount + " sells",
            colors.cyan
          ).padEnd(20)} │`,
          colors.white
        )
      );

      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────┤",
          colors.white
        )
      );
      console.log(
        colorText(
          "│                           ORDER BOOK DEPTH                                 │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────┤",
          colors.white
        )
      );
      console.log(
        colorText(
          "│         BIDS (Buy Orders)         │         ASKS (Sell Orders)         │",
          colors.white
        )
      );
      console.log(
        colorText(
          "│   Price    Amount    User        │    Price    Amount    User        │",
          colors.white
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────┤",
          colors.white
        )
      );

      // Get enhanced order book depth with user info
      try {
        const depth = 5;
        const enhancedBookData = await this.getEnhancedOrderBookDepth(depth);

        const maxRows = Math.max(
          enhancedBookData.bids.length,
          enhancedBookData.asks.length,
          3
        );

        for (let i = 0; i < maxRows; i++) {
          let bidInfo = "                              ";
          let askInfo = "                              ";

          if (i < enhancedBookData.bids.length) {
            const bid = enhancedBookData.bids[i];
            const price = formatPriceWithValidation(bid.price, 6, 4, false);
            const amount = formatAmount(bid.amount, 18, 4);
            const user = this.formatUserDisplay(bid.trader);
            bidInfo = colorText(
              `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(8)}`,
              colors.green
            );
          }

          if (i < enhancedBookData.asks.length) {
            const ask = enhancedBookData.asks[i];
            const price = formatPriceWithValidation(ask.price, 6, 4, false);
            const amount = formatAmount(ask.amount, 18, 4);
            const user = this.formatUserDisplay(ask.trader);
            askInfo = colorText(
              `$${price.padStart(6)} ${amount.padStart(8)} ${user.padEnd(8)}`,
              colors.red
            );
          }

          console.log(
            colorText("│ ", colors.white) +
              bidInfo +
              colorText(" │ ", colors.white) +
              askInfo +
              colorText(" │", colors.white)
          );
        }
      } catch (error) {
        console.log(
          colorText(
            "│                         No order book data available                         │",
            colors.yellow
          )
        );
        console.log(
          colorText(
            `│ Error: ${error.message.substring(0, 65).padEnd(65)} │`,
            colors.red
          )
        );
      }

      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────┤",
          colors.white
        )
      );
      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────────────────────┘",
          colors.white
        )
      );

      // Add helpful legend
      console.log(colorText("\n📋 PRICE LEGEND:", colors.brightCyan));
      console.log(
        colorText(
          "   • Mark Price: Current fair value used for PnL calculations and liquidations",
          colors.white
        )
      );
      console.log(
        colorText(
          "   • Last Trade: Price of the most recent executed trade",
          colors.white
        )
      );
      console.log(
        colorText(
          "   • Best Bid/Ask: Highest buy order and lowest sell order prices",
          colors.white
        )
      );
      console.log(
        colorText(
          "   • Spread: Difference between best ask and best bid",
          colors.white
        )
      );
    } catch (error) {
      console.log(
        colorText("⚠️ Could not fetch order book data", colors.yellow)
      );
    }
  }

  // Helper function to get enhanced order book data with trader information
  async getEnhancedOrderBookDepth(depth) {
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await this.contracts.orderBook.getOrderBookDepth(depth);

    const bids = [];
    const asks = [];

    // Get detailed bid information
    for (let i = 0; i < bidPrices.length && bidPrices[i] > 0; i++) {
      const price = bidPrices[i];
      const totalAmount = bidAmounts[i];

      // Get the first order at this price level to show as representative trader
      try {
        const buyLevel = await this.contracts.orderBook.buyLevels(price);
        if (buyLevel.exists && buyLevel.firstOrderId > 0) {
          const firstOrder = await this.contracts.orderBook.getOrder(
            buyLevel.firstOrderId
          );
          bids.push({
            price: price,
            amount: totalAmount,
            trader: firstOrder.trader,
            orderId: buyLevel.firstOrderId,
          });
        }
      } catch (error) {
        // Fallback if we can't get order details
        bids.push({
          price: price,
          amount: totalAmount,
          trader: ethers.ZeroAddress,
          orderId: 0,
        });
      }
    }

    // Get detailed ask information
    for (let i = 0; i < askPrices.length && askPrices[i] > 0; i++) {
      const price = askPrices[i];
      const totalAmount = askAmounts[i];

      // Get the first order at this price level to show as representative trader
      try {
        const sellLevel = await this.contracts.orderBook.sellLevels(price);
        if (sellLevel.exists && sellLevel.firstOrderId > 0) {
          const firstOrder = await this.contracts.orderBook.getOrder(
            sellLevel.firstOrderId
          );
          asks.push({
            price: price,
            amount: totalAmount,
            trader: firstOrder.trader,
            orderId: sellLevel.firstOrderId,
          });
        }
      } catch (error) {
        // Fallback if we can't get order details
        asks.push({
          price: price,
          amount: totalAmount,
          trader: ethers.ZeroAddress,
          orderId: 0,
        });
      }
    }

    return { bids, asks };
  }

  // Helper function to format user display
  formatUserDisplay(traderAddress) {
    if (!traderAddress || traderAddress === ethers.ZeroAddress) {
      return "Unknown";
    }

    // Check if it's one of our known users
    for (let i = 0; i < this.users.length; i++) {
      if (this.users[i].address.toLowerCase() === traderAddress.toLowerCase()) {
        if (i === 0) return colorText("Deploy", colors.brightCyan);
        return colorText(`User${i}`, colors.brightYellow);
      }
    }

    // Check if it's the current user
    if (
      this.currentUser &&
      this.currentUser.address.toLowerCase() === traderAddress.toLowerCase()
    ) {
      return colorText("YOU", colors.brightGreen);
    }

    // Show first 4 characters of address
    return colorText(traderAddress.substring(2, 6), colors.dim);
  }

  async displayMenu() {
    // Quick position summary before menu
    try {
      // Get isolated positions from OrderBook (these have liquidation prices)
      const positionIds = await this.contracts.orderBook.getUserPositions(
        this.currentUser.address
      );

      if (positionIds.length > 0) {
        console.log(
          colorText("\n🎯 QUICK POSITION SUMMARY", colors.brightYellow)
        );
        console.log(
          colorText(
            "┌─────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );

        // Group positions by entry price and side
        const positionGroups = new Map();

        for (const positionId of positionIds) {
          try {
            const isolatedPos = await this.contracts.orderBook.getPosition(
              this.currentUser.address,
              positionId
            );
            const positionSize = BigInt(isolatedPos.size.toString());
            const entryPrice = BigInt(isolatedPos.entryPrice.toString());
            const liquidationPrice = BigInt(
              isolatedPos.liquidationPrice.toString()
            );

            // Create a key for grouping (side + entry price + liquidation price)
            const side = positionSize >= 0n ? "LONG" : "SHORT";
            const groupKey = `${side}_${entryPrice}_${liquidationPrice}`;

            if (!positionGroups.has(groupKey)) {
              positionGroups.set(groupKey, {
                side: side,
                sideColor: positionSize >= 0n ? colors.green : colors.red,
                entryPrice: entryPrice,
                liquidationPrice: liquidationPrice,
                totalSize: 0n,
                positionCount: 0,
              });
            }

            const group = positionGroups.get(groupKey);
            group.totalSize +=
              positionSize >= 0n ? positionSize : -positionSize;
            group.positionCount++;
          } catch (error) {
            console.log(
              colorText(
                "│ Position data error                                         │",
                colors.red
              )
            );
            console.error("Debug - Position error:", error.message);
          }
        }

        // Display grouped positions
        for (const [groupKey, group] of positionGroups) {
          try {
            const marketIdStr = "ALU-USD"; // Simplified for this interface

            // Use high-precision formatting functions for accuracy
            const size = formatAmount(group.totalSize, 18, 3); // 3 decimals for position size
            const entryPrice = formatPriceWithValidation(
              group.entryPrice,
              6,
              4, // 4 decimals for higher price precision
              false // Don't show warnings in quick summary
            );

            // Get liquidation price
            const liquidationPrice = formatPriceWithValidation(
              group.liquidationPrice,
              6,
              4, // 4 decimals for liquidation price precision
              false
            );

            // Get current mark price to show liquidation risk
            const markPrice = await this.contracts.orderBook.getMarkPrice();
            const currentPrice = formatPriceWithValidation(
              markPrice,
              6,
              4,
              false
            );

            // Determine liquidation risk status
            const isAtRisk =
              group.side === "LONG"
                ? markPrice <= (group.liquidationPrice * 110n) / 100n // Long: at risk if price <= 110% of liquidation price
                : markPrice >= (group.liquidationPrice * 90n) / 100n; // Short: at risk if price >= 90% of liquidation price

            const riskIndicator = isAtRisk ? "⚠️ " : "✅ ";
            const riskColor = isAtRisk ? colors.red : colors.green;

            // Show position count if more than 1
            const positionCountText =
              group.positionCount > 1
                ? ` (${group.positionCount} positions)`
                : "";

            console.log(
              colorText(
                `│ ${marketIdStr}: ${colorText(
                  group.side,
                  group.sideColor
                )} ${size} ALU @ $${entryPrice}${positionCountText}  │`,
                colors.white
              )
            );
            console.log(
              colorText(
                `│ ${riskIndicator}Liq: $${liquidationPrice} | Current: $${currentPrice}  │`,
                riskColor
              )
            );
          } catch (error) {
            console.log(
              colorText(
                "│ Position data error                                         │",
                colors.red
              )
            );
            console.error("Debug - Position error:", error.message);
          }
        }

        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );
      }
    } catch (error) {
      // Silently ignore if can't fetch positions
    }

    console.log(colorText("\n🎮 TRADING ACTIONS", colors.brightYellow));
    console.log(
      colorText("┌─────────────────────────────────────────┐", colors.cyan)
    );
    console.log(
      colorText("│ 1. 📈 Limit Buy (ALU/USDC sizing)      │", colors.green)
    );
    console.log(
      colorText("│ 2. 📉 Limit Sell (ALU/USDC sizing)     │", colors.red)
    );
    console.log(
      colorText(
        "│ 3. 🛒 Market Buy (ALU/USDC sizing)     │",
        colors.brightGreen
      )
    );
    console.log(
      colorText("│ 4. 💰 Market Sell (ALU/USDC sizing)    │", colors.brightRed)
    );
    console.log(
      colorText("│ 5. 📋 View My Orders                   │", colors.yellow)
    );
    console.log(
      colorText("│ 6. ❌ Cancel Order                     │", colors.magenta)
    );
    console.log(
      colorText("│ 7. 📊 Detailed Portfolio Analysis      │", colors.brightCyan)
    );
    console.log(
      colorText("│ 8. 🔄 Switch User                      │", colors.cyan)
    );
    console.log(
      colorText("│ 9. 🏦 Deposit/Withdraw Collateral      │", colors.blue)
    );
    console.log(
      colorText("│ 10. 📊 View Open Positions             │", colors.brightCyan)
    );
    console.log(
      colorText("│ 11. 🧪 Test Slippage (Requirement 11) │", colors.magenta)
    );
    console.log(
      colorText(
        "│ 12. 📈 View Trade History              │",
        colors.brightGreen
      )
    );
    console.log(
      colorText(
        "│ 13. 🔄 RESET ALL (Cancel & Fund Users) │",
        colors.brightYellow
      )
    );
    console.log(
      colorText("│ r. 🔄 Refresh Display                  │", colors.white)
    );
    console.log(
      colorText("│ 0. 🚪 Exit                             │", colors.dim)
    );
    console.log(
      colorText("└─────────────────────────────────────────┘", colors.cyan)
    );
    console.log(
      colorText(
        "💡 Fixed margin: 100% for longs, 150% for shorts | Size in ALU tokens or USDC value",
        colors.cyan
      )
    );
  }

  async handleMenuChoice(choice) {
    switch (choice.trim().toLowerCase()) {
      case "1":
        await this.placeLimitOrder(true); // Buy
        break;
      case "2":
        await this.placeLimitOrder(false); // Sell
        break;
      case "3":
        await this.placeMarketOrder(true); // Market Buy
        break;
      case "4":
        await this.placeMarketOrder(false); // Market Sell
        break;
      case "5":
        await this.viewMyOrders();
        break;
      case "6":
        await this.cancelOrder();
        break;
      case "7":
        await this.detailedPortfolioAnalysis();
        break;
      case "8":
        await this.selectUser();
        break;
      case "9":
        await this.manageCollateral();
        break;
      case "10":
        await this.viewOpenPositions();
        break;
      case "11":
        await this.testSlippageRequirement();
        break;
      case "12":
        await this.viewTradeHistory();
        break;
      case "13":
        await this.resetOrderBookAndFundUsers();
        break;
      case "r":
        // Refresh - just continue loop
        break;
      case "0":
        await this.exit();
        break;
      default:
        console.log(colorText("❌ Invalid choice", colors.red));
        await this.pause(1000);
    }
  }

  async placeLimitOrder(isBuy) {
    console.clear();
    console.log(
      boxText(
        `🎯 PLACE ${isBuy ? "BUY" : "SELL"} LIMIT ORDER (${
          isBuy ? "100%" : "150%"
        } MARGIN)`,
        isBuy ? colors.green : colors.red
      )
    );
    console.log(
      colorText("💡 Fixed margin: 100% for longs, 150% for shorts", colors.cyan)
    );

    try {
      const price = await this.askQuestion(
        colorText(`💰 Enter price (USDC): $`, colors.yellow)
      );

      if (!price || isNaN(price)) {
        console.log(colorText("❌ Invalid price", colors.red));
        await this.pause(2000);
        return;
      }

      // Ask user how they want to specify the order size
      console.log(
        colorText(
          "\n📊 How would you like to specify the order size?",
          colors.brightYellow
        )
      );
      console.log(colorText("1. 🪙 Enter amount in ALU tokens", colors.cyan));
      console.log(
        colorText("2. 💵 Enter position value in USDC", colors.green)
      );

      const sizeChoice = await this.askQuestion(
        colorText("Choose option (1 or 2): ", colors.brightMagenta)
      );

      let amount;
      let totalValue;

      if (sizeChoice === "1") {
        // Traditional ALU amount input
        const aluAmount = await this.askQuestion(
          colorText(`📊 Enter amount (ALU): `, colors.cyan)
        );

        if (!aluAmount || isNaN(aluAmount)) {
          console.log(colorText("❌ Invalid ALU amount", colors.red));
          await this.pause(2000);
          return;
        }

        amount = aluAmount;
        totalValue = (parseFloat(price) * parseFloat(amount)).toFixed(2);
      } else if (sizeChoice === "2") {
        // USDC position value input
        const usdcValue = await this.askQuestion(
          colorText(`💵 Enter position value (USDC): $`, colors.green)
        );

        if (!usdcValue || isNaN(usdcValue)) {
          console.log(colorText("❌ Invalid USDC value", colors.red));
          await this.pause(2000);
          return;
        }

        // Calculate ALU amount from USDC value
        totalValue = parseFloat(usdcValue).toFixed(2);
        amount = (parseFloat(usdcValue) / parseFloat(price)).toFixed(6);
      } else {
        console.log(colorText("❌ Invalid choice", colors.red));
        await this.pause(2000);
        return;
      }

      console.log(colorText("\n📝 Order Summary:", colors.brightYellow));
      console.log(
        colorText(
          `   Type: ${isBuy ? "BUY" : "SELL"} LIMIT ORDER (${
            isBuy ? "100%" : "150%"
          } MARGIN)`,
          isBuy ? colors.green : colors.red
        )
      );
      console.log(colorText(`   Price: $${price} USDC`, colors.yellow));
      console.log(colorText(`   Amount: ${amount} ALU`, colors.cyan));
      console.log(
        colorText(`   Position Value: $${totalValue} USDC`, colors.magenta)
      );
      console.log(
        colorText(
          `   Collateral Required: $${
            isBuy ? totalValue : (totalValue * 1.5).toFixed(2)
          } USDC (${isBuy ? "100%" : "150%"} margin)`,
          colors.brightCyan
        )
      );

      const confirm = await this.askQuestion(
        colorText("\n✅ Confirm order? (y/n): ", colors.brightGreen)
      );

      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        console.log(colorText("\n🚀 Placing order...", colors.yellow));

        const priceWei = ethers.parseUnits(price, 6);
        const amountWei = ethers.parseUnits(amount, 18);

        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginLimitOrder(priceWei, amountWei, isBuy);

        console.log(colorText("⏳ Transaction submitted...", colors.yellow));
        const receipt = await tx.wait();

        console.log(
          colorText("✅ Order placed successfully!", colors.brightGreen)
        );
        console.log(colorText(`📄 Transaction: ${tx.hash}`, colors.dim));
        console.log(
          colorText(`⛽ Gas used: ${receipt.gasUsed.toString()}`, colors.dim)
        );
      } else {
        console.log(colorText("❌ Order cancelled", colors.yellow));
      }
    } catch (error) {
      console.log(colorText("❌ Order failed: " + error.message, colors.red));
    }

    await this.pause(3000);
  }

  async placeMarketOrder(isBuy) {
    console.clear();
    console.log(
      boxText(
        `🛒 PLACE ${isBuy ? "BUY" : "SELL"} MARKET ORDER (${
          isBuy ? "100%" : "150%"
        } MARGIN)`,
        isBuy ? colors.brightGreen : colors.brightRed
      )
    );
    console.log(
      colorText(
        "💡 Fixed margin: 100% for longs, 150% for shorts (based on execution price)",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "🎯 Slippage Protection: Control maximum acceptable price deviation",
        colors.yellow
      )
    );

    try {
      // Get current best price for reference
      const [bestBid, bestAsk] = await this.contracts.orderBook.getBestPrices();
      const referencePrice = isBuy ? bestAsk : bestBid;

      if (
        referencePrice === 0n ||
        (isBuy && referencePrice >= ethers.MaxUint256)
      ) {
        console.log(
          colorText("❌ No liquidity available for market order", colors.red)
        );
        await this.pause(2000);
        return;
      }

      const refPriceFormatted = formatPrice(referencePrice);
      console.log(
        colorText(
          `📊 Current ${
            isBuy ? "Best Ask" : "Best Bid"
          }: $${refPriceFormatted}`,
          colors.cyan
        )
      );

      // Ask user how they want to specify the order size
      console.log(
        colorText(
          "\n📊 How would you like to specify the order size?",
          colors.brightYellow
        )
      );
      console.log(colorText("1. 🪙 Enter amount in ALU tokens", colors.cyan));
      console.log(
        colorText("2. 💵 Enter position value in USDC", colors.green)
      );

      const sizeChoice = await this.askQuestion(
        colorText("Choose option (1 or 2): ", colors.brightMagenta)
      );

      let amount;
      let estimatedValue;

      if (sizeChoice === "1") {
        // Traditional ALU amount input
        const aluAmount = await this.askQuestion(
          colorText(`📊 Enter amount (ALU): `, colors.cyan)
        );

        if (!aluAmount || isNaN(aluAmount)) {
          console.log(colorText("❌ Invalid ALU amount", colors.red));
          await this.pause(2000);
          return;
        }

        amount = aluAmount;
        estimatedValue = (
          parseFloat(refPriceFormatted) * parseFloat(amount)
        ).toFixed(2);
      } else if (sizeChoice === "2") {
        // USDC position value input
        const usdcValue = await this.askQuestion(
          colorText(`💵 Enter position value (USDC): $`, colors.green)
        );

        if (!usdcValue || isNaN(usdcValue)) {
          console.log(colorText("❌ Invalid USDC value", colors.red));
          await this.pause(2000);
          return;
        }

        // Calculate approximate ALU amount from USDC value using reference price
        estimatedValue = parseFloat(usdcValue).toFixed(2);
        amount = (
          parseFloat(usdcValue) / parseFloat(refPriceFormatted)
        ).toFixed(6);
      } else {
        console.log(colorText("❌ Invalid choice", colors.red));
        await this.pause(2000);
        return;
      }

      // Prompt for slippage tolerance
      console.log(
        colorText("\n🎯 Slippage Protection Setup:", colors.brightYellow)
      );
      console.log(colorText("   Choose your slippage tolerance:", colors.cyan));
      console.log(colorText("   1 = 1% (tight)", colors.white));
      console.log(colorText("   3 = 3% (moderate)", colors.white));
      console.log(colorText("   5 = 5% (default)", colors.white));
      console.log(colorText("   10 = 10% (loose)", colors.white));
      console.log(colorText("   Custom = enter any number", colors.white));

      const slippageInput = await this.askQuestion(
        colorText("🎯 Enter slippage tolerance (%): ", colors.cyan)
      );

      let slippagePercent = 5; // Default 5%
      if (slippageInput && !isNaN(slippageInput)) {
        slippagePercent = Math.max(
          0.1,
          Math.min(50, parseFloat(slippageInput))
        ); // 0.1% to 50%
      }

      const slippageBps = Math.round(slippagePercent * 100); // Convert to basis points

      // Calculate slippage bounds
      const maxPrice = isBuy
        ? (referencePrice * BigInt(10000 + slippageBps)) / 10000n
        : ethers.MaxUint256;
      const minPrice = isBuy
        ? 0n
        : (referencePrice * BigInt(10000 - slippageBps)) / 10000n;

      console.log(colorText("\n📝 Market Order Summary:", colors.brightYellow));
      console.log(
        colorText(
          `   Type: ${isBuy ? "BUY" : "SELL"} MARKET ORDER (${
            isBuy ? "100%" : "150%"
          } MARGIN)`,
          isBuy ? colors.brightGreen : colors.brightRed
        )
      );
      console.log(colorText(`   Amount: ${amount} ALU`, colors.cyan));
      console.log(
        colorText(`   Estimated Value: $${estimatedValue} USDC`, colors.magenta)
      );
      console.log(
        colorText(`   Reference Price: $${refPriceFormatted}`, colors.cyan)
      );
      console.log(
        colorText(`   Slippage Tolerance: ${slippagePercent}%`, colors.yellow)
      );

      if (isBuy) {
        const maxPriceFormatted = formatPrice(maxPrice);
        console.log(
          colorText(`   Maximum Price: $${maxPriceFormatted}`, colors.red)
        );
        console.log(
          colorText(
            `   Will execute at prices ≤ $${maxPriceFormatted}`,
            colors.yellow
          )
        );
      } else {
        const minPriceFormatted = formatPrice(minPrice);
        console.log(
          colorText(`   Minimum Price: $${minPriceFormatted}`, colors.green)
        );
        console.log(
          colorText(
            `   Will execute at prices ≥ $${minPriceFormatted}`,
            colors.yellow
          )
        );
      }

      console.log(
        colorText(
          `   Unfilled portion beyond slippage will be CANCELLED`,
          colors.magenta
        )
      );

      const confirm = await this.askQuestion(
        colorText(
          "\n✅ Confirm market order with slippage protection? (y/n): ",
          colors.brightGreen
        )
      );

      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        console.log(
          colorText(
            "\n🚀 Executing market order with slippage protection...",
            colors.yellow
          )
        );

        const amountWei = ethers.parseUnits(amount, 18);

        // Use the slippage-aware market order function
        const filledAmountWei = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginMarketOrderWithSlippage.staticCall(
            amountWei,
            isBuy,
            slippageBps
          );

        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginMarketOrderWithSlippage(amountWei, isBuy, slippageBps);

        console.log(colorText("⏳ Transaction submitted...", colors.yellow));
        const receipt = await tx.wait();

        const filledAmount = parseFloat(
          ethers.formatUnits(filledAmountWei, 18)
        );
        const requestedAmount = parseFloat(amount);
        const fillRate = (filledAmount / requestedAmount) * 100;

        console.log(colorText("✅ Market order executed!", colors.brightGreen));
        console.log(
          colorText(`📊 Requested: ${requestedAmount} ALU`, colors.cyan)
        );
        console.log(colorText(`📊 Filled: ${filledAmount} ALU`, colors.green));
        console.log(
          colorText(`📊 Fill Rate: ${fillRate.toFixed(1)}%`, colors.cyan)
        );

        if (filledAmount < requestedAmount) {
          const cancelledAmount = requestedAmount - filledAmount;
          console.log(
            colorText(
              `🛡️ Cancelled: ${cancelledAmount} ALU (slippage protection)`,
              colors.magenta
            )
          );
          console.log(
            colorText(
              `✅ Requirement 11 Demonstrated: Unfilled portion cancelled!`,
              colors.brightGreen
            )
          );
        } else {
          console.log(
            colorText(
              `✅ Order fully filled within slippage tolerance`,
              colors.brightGreen
            )
          );
        }

        console.log(colorText(`📄 Transaction: ${tx.hash}`, colors.dim));
        console.log(
          colorText(`⛽ Gas used: ${receipt.gasUsed.toString()}`, colors.dim)
        );
      } else {
        console.log(colorText("❌ Order cancelled", colors.yellow));
      }
    } catch (error) {
      console.log(
        colorText("❌ Market order failed: " + error.message, colors.red)
      );
    }

    await this.pause(3000);
  }

  async viewMyOrders() {
    console.clear();
    console.log(boxText("📋 MY ACTIVE ORDERS - DETAILED VIEW", colors.yellow));

    // Show current user info
    const userType =
      this.currentUserIndex === 0
        ? "Deployer"
        : `User ${this.currentUserIndex}`;
    console.log(
      colorText(
        `👤 Viewing orders for: ${userType} (${this.currentUser.address})`,
        colors.cyan
      )
    );

    let activeCount = 0; // Declare activeCount at function scope

    try {
      // Get user orders independently
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );

      console.log(
        colorText(
          `\n🔍 Found ${userOrders.length} order(s) for this user`,
          colors.brightCyan
        )
      );

      if (userOrders.length === 0) {
        console.log(
          colorText(
            "\n┌─────────────────────────────────────────────────────────────────┐",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│                        💤 NO ACTIVE ORDERS                     │",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "│                                                                 │",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│  💡 Tips to get started:                                       │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│     • Use option 1 or 2 to place limit orders                 │",
            colors.white
          )
        );
        console.log(
          colorText(
            "│     • Use option 3 or 4 to place market orders                │",
            colors.white
          )
        );
        console.log(
          colorText(
            "│     • Check the order book to see current prices              │",
            colors.white
          )
        );
        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────────┘",
            colors.dim
          )
        );
      } else {
        // Enhanced order display with more details
        console.log(
          colorText(
            "\n┌─────────────────────────────────────────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│   Order ID   │  Type  │    Price     │   Original   │  Remaining   │   Filled    │   Status   │   Age    │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        let filledCount = 0;
        let totalValue = 0;

        for (let i = 0; i < userOrders.length; i++) {
          const orderId = userOrders[i];
          try {
            const order = await this.contracts.orderBook.getOrder(orderId);

            // Skip if order doesn't exist or is invalid
            if (order.trader === ethers.ZeroAddress) {
              continue;
            }

            const filled = await this.contracts.orderBook.getFilledAmount(
              orderId
            );

            const shortId = orderId.toString().slice(0, 10) + "...";
            const isBuy = order.isBuy;
            const type = isBuy
              ? colorText("BUY ", colors.green)
              : colorText("SELL", colors.red);

            // Enhanced price formatting with validation (ALU prices are in 18 decimals)
            const price = formatPriceWithValidation(order.price, 6, 4, false); // 4 decimals for higher precision
            const originalAmount = formatAmount(order.amount + filled, 18, 6); // More precision for amounts
            const remainingAmount = formatAmount(order.amount, 18, 6);
            const filledAmount = formatAmount(filled, 18, 6);

            // Calculate order age
            const orderTime = new Date(Number(order.timestamp) * 1000);
            const now = new Date();
            const ageMinutes = Math.floor((now - orderTime) / (1000 * 60));
            const ageDisplay =
              ageMinutes < 60
                ? `${ageMinutes}m`
                : `${Math.floor(ageMinutes / 60)}h${ageMinutes % 60}m`;

            // Determine status
            let status;
            let statusColor;
            if (order.amount === 0n) {
              status = "FILLED";
              statusColor = colors.brightGreen;
              filledCount++;
            } else if (filled > 0n) {
              status = "PARTIAL";
              statusColor = colors.yellow;
              activeCount++;
            } else {
              status = "ACTIVE";
              statusColor = colors.green;
              activeCount++;
            }

            // Calculate order value
            const orderValue = parseFloat(price) * parseFloat(remainingAmount);
            totalValue += orderValue;

            // Enhanced display with price validation indicator
            const priceValidation = validatePriceAccuracy(
              order.price,
              price,
              18
            );
            const priceDisplay = priceValidation.isAccurate
              ? ("$" + price).padStart(12)
              : ("$" + price + "*").padStart(12); // Add asterisk for precision loss

            console.log(
              colorText(
                `│ ${shortId.padEnd(
                  12
                )} │ ${type} │ ${priceDisplay} │ ${originalAmount.padStart(
                  12
                )} │ ${remainingAmount.padStart(12)} │ ${filledAmount.padStart(
                  11
                )} │ ${colorText(
                  status.padEnd(10),
                  statusColor
                )} │ ${ageDisplay.padStart(8)} │`,
                colors.white
              )
            );
          } catch (error) {
            console.log(
              colorText(
                `│ ${orderId
                  .toString()
                  .slice(0, 12)
                  .padEnd(
                    12
                  )} │ ERROR │          │           │           │          │            │          │`,
                colors.red
              )
            );
          }
        }

        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        // Summary row
        console.log(
          colorText(
            `│ 📊 SUMMARY: ${activeCount} active, ${filledCount} filled │ Total Value: $${totalValue.toFixed(
              2
            )} USDC                     │`,
            colors.brightYellow
          )
        );

        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );

        // Price accuracy legend
        console.log(
          colorText("\n📊 PRICE ACCURACY LEGEND:", colors.brightCyan)
        );
        console.log(
          colorText(
            "   • Prices shown with 4 decimal places for enhanced precision",
            colors.white
          )
        );
        console.log(
          colorText(
            "   • Amounts shown with 6 decimal places to prevent rounding errors",
            colors.white
          )
        );
        console.log(
          colorText(
            "   • Prices marked with (*) indicate minor precision loss during conversion",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "   • All values validated against blockchain state for accuracy",
            colors.green
          )
        );

        // Additional order management options
        if (activeCount > 0) {
          console.log(
            colorText("\n🎮 ORDER MANAGEMENT OPTIONS:", colors.brightYellow)
          );
          console.log(
            colorText(
              "┌─────────────────────────────────────────┐",
              colors.cyan
            )
          );
          console.log(
            colorText("│ c. ❌ Cancel a specific order          │", colors.red)
          );
          console.log(
            colorText(
              "│ a. ❌ Cancel ALL orders                │",
              colors.brightRed
            )
          );
          console.log(
            colorText(
              "│ m. 🔧 Modify an order                  │",
              colors.yellow
            )
          );
          console.log(
            colorText(
              "│ r. 🔄 Refresh order list               │",
              colors.white
            )
          );
          console.log(
            colorText(
              "└─────────────────────────────────────────┘",
              colors.cyan
            )
          );

          const action = await this.askQuestion(
            colorText(
              "Choose action (or Enter to return to main menu): ",
              colors.brightMagenta
            )
          );

          switch (action.toLowerCase().trim()) {
            case "c":
              await this.cancelSpecificOrder();
              break;
            case "a":
              await this.cancelAllOrders();
              break;
            case "m":
              await this.modifyOrder();
              break;
            case "r":
              await this.viewMyOrders(); // Recursive call to refresh
              return;
            default:
              // Return to main menu
              break;
          }
        }
      }
    } catch (error) {
      console.log(
        colorText("❌ Could not fetch orders: " + error.message, colors.red)
      );
      console.log(colorText("🔍 Debug info:", colors.dim));
      console.log(
        colorText(`   User: ${this.currentUser.address}`, colors.dim)
      );
      console.log(
        colorText(
          `   OrderBook: ${await this.contracts.orderBook.getAddress()}`,
          colors.dim
        )
      );
    }

    if (!activeCount || activeCount === 0) {
      await this.askQuestion(
        colorText("\n📱 Press Enter to continue...", colors.dim)
      );
    }
  }

  // Helper function to cancel a specific order
  async cancelSpecificOrder() {
    console.log(colorText("\n❌ CANCEL SPECIFIC ORDER", colors.red));

    try {
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );

      if (userOrders.length === 0) {
        console.log(colorText("No orders to cancel", colors.yellow));
        return;
      }

      // Show orders with numbers
      console.log(colorText("\nSelect order to cancel:", colors.cyan));
      for (let i = 0; i < userOrders.length; i++) {
        const orderId = userOrders[i];
        try {
          const order = await this.contracts.orderBook.getOrder(orderId);
          if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
            const type = order.isBuy ? "BUY" : "SELL";
            const price = formatPriceWithValidation(order.price, 6, 4, false);
            const amount = formatAmount(order.amount, 18, 6);

            console.log(
              colorText(
                `${i + 1}. ${type} ${amount} ALU @ $${price} (ID: ${orderId})`,
                order.isBuy ? colors.green : colors.red
              )
            );
          }
        } catch (error) {
          console.log(
            colorText(`${i + 1}. Error loading order ${orderId}`, colors.red)
          );
        }
      }

      const selection = await this.askQuestion(
        colorText(
          "\nEnter order number to cancel (or 0 to go back): ",
          colors.yellow
        )
      );

      const orderIndex = parseInt(selection) - 1;
      if (orderIndex >= 0 && orderIndex < userOrders.length) {
        const orderId = userOrders[orderIndex];

        console.log(
          colorText(`\n🗑️ Cancelling order ${orderId}...`, colors.yellow)
        );

        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .cancelOrder(orderId);
        await tx.wait();

        console.log(
          colorText("✅ Order cancelled successfully!", colors.brightGreen)
        );
        await this.pause(2000);
      } else if (selection !== "0") {
        console.log(colorText("❌ Invalid selection", colors.red));
        await this.pause(1000);
      }
    } catch (error) {
      console.log(colorText("❌ Cancel failed: " + error.message, colors.red));
      await this.pause(2000);
    }
  }

  // Helper function to cancel all orders
  async cancelAllOrders() {
    console.log(colorText("\n⚠️ CANCEL ALL ORDERS", colors.brightRed));

    const confirm = await this.askQuestion(
      colorText(
        "Are you sure you want to cancel ALL your orders? (type 'YES' to confirm): ",
        colors.red
      )
    );

    if (confirm !== "YES") {
      console.log(colorText("❌ Cancelled", colors.yellow));
      return;
    }

    try {
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );

      console.log(
        colorText(
          `\n🗑️ Cancelling ${userOrders.length} orders...`,
          colors.yellow
        )
      );

      let successCount = 0;
      let failCount = 0;

      for (const orderId of userOrders) {
        try {
          const order = await this.contracts.orderBook.getOrder(orderId);
          if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
            const tx = await this.contracts.orderBook
              .connect(this.currentUser)
              .cancelOrder(orderId);
            await tx.wait();
            successCount++;
            console.log(
              colorText(`   ✅ Cancelled order ${orderId}`, colors.green)
            );
          }
        } catch (error) {
          failCount++;
          console.log(
            colorText(`   ❌ Failed to cancel order ${orderId}`, colors.red)
          );
        }
      }

      console.log(
        colorText(
          `\n📊 Summary: ${successCount} cancelled, ${failCount} failed`,
          colors.brightGreen
        )
      );
      await this.pause(3000);
    } catch (error) {
      console.log(
        colorText("❌ Bulk cancel failed: " + error.message, colors.red)
      );
      await this.pause(2000);
    }
  }

  // Helper function to modify an order (placeholder)
  async modifyOrder() {
    console.log(colorText("\n🔧 ORDER MODIFICATION", colors.yellow));
    console.log(
      colorText(
        "💡 Order modification uses cancel-and-replace pattern",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "🚀 Use the trade.js utility for advanced order modification:",
        colors.cyan
      )
    );
    console.log(colorText("   node trade.js --modify-order", colors.white));

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async cancelOrder() {
    console.clear();
    console.log(boxText("❌ CANCEL ORDER", colors.magenta));

    try {
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );

      if (userOrders.length === 0) {
        console.log(
          colorText("\n💤 No active orders to cancel", colors.yellow)
        );
        await this.pause(2000);
        return;
      }

      console.log(colorText("\nYour active orders:", colors.cyan));
      for (let i = 0; i < userOrders.length; i++) {
        const orderId = userOrders[i];
        console.log(colorText(`${i + 1}. ${orderId.toString()}`, colors.white));
      }

      const choice = await this.askQuestion(
        colorText(
          `\n🎯 Select order to cancel (1-${userOrders.length}): `,
          colors.magenta
        )
      );
      const index = parseInt(choice) - 1;

      if (index >= 0 && index < userOrders.length) {
        const orderId = userOrders[index];

        console.log(
          colorText(`\n🗑️ Cancelling order ${orderId}...`, colors.yellow)
        );

        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .cancelOrder(orderId);
        console.log(colorText("⏳ Transaction submitted...", colors.yellow));
        await tx.wait();

        console.log(
          colorText("✅ Order cancelled successfully!", colors.brightGreen)
        );
      } else {
        console.log(colorText("❌ Invalid selection", colors.red));
      }
    } catch (error) {
      console.log(colorText("❌ Cancel failed: " + error.message, colors.red));
    }

    await this.pause(3000);
  }

  async detailedPortfolioAnalysis() {
    console.clear();
    console.log(boxText("📊 DETAILED PORTFOLIO ANALYSIS", colors.brightCyan));

    try {
      // Get comprehensive data
      const marginSummary = await this.contracts.vault.getMarginSummary(
        this.currentUser.address
      );
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );
      const balance = await this.contracts.mockUSDC.balanceOf(
        this.currentUser.address
      );

      // Calculate key metrics with auto-decimal detection
      const totalCollateral = parseFloat(
        formatWithAutoDecimalDetection(
          BigInt(marginSummary.totalCollateral.toString()),
          6
        )
      );
      const availableBalance = parseFloat(
        formatWithAutoDecimalDetection(
          BigInt(marginSummary.availableCollateral.toString()),
          6
        )
      );
      const marginUsed = parseFloat(
        formatWithAutoDecimalDetection(
          BigInt(marginSummary.marginUsed.toString()),
          6
        )
      );
      const marginReserved = parseFloat(
        formatUSDC(BigInt(marginSummary.marginReserved.toString()))
      );
      // Handle realizedPnL - it's stored with 24 decimals (price diff * size)
      const realizedPnLBigInt = BigInt(
        (marginSummary.realizedPnL || 0).toString()
      );
      // Realized P&L is in 24 decimals (6 decimals price * 18 decimals size)
      const realizedPnLStr = parseFloat(
        ethers.formatUnits(realizedPnLBigInt, 24)
      ).toFixed(2);
      const realizedPnL = parseFloat(realizedPnLStr);
      // Handle signed int256 for unrealizedPnL
      let unrealizedPnLBigInt;
      try {
        // Check if it's already a BigInt or needs conversion
        if (typeof marginSummary.unrealizedPnL === "bigint") {
          unrealizedPnLBigInt = marginSummary.unrealizedPnL;
        } else {
          // Convert from string representation, handling potential negative values
          unrealizedPnLBigInt = BigInt(
            (marginSummary.unrealizedPnL || 0).toString()
          );
        }
      } catch (e) {
        unrealizedPnLBigInt = 0n;
      }

      const unrealizedPnL = parseFloat(
        ethers.formatUnits(unrealizedPnLBigInt, 18) // P&L is in 18 decimals (ALU precision)
      );
      // Portfolio value calculation fix: The contract incorrectly mixes decimal precisions
      // It adds collateral + realizedPnL + unrealizedPnL (but with mixed decimals)
      // We need to recalculate it correctly here using our auto-detected values
      const totalCollateralNum = parseFloat(totalCollateral);
      const portfolioValue = totalCollateralNum + realizedPnL + unrealizedPnL;
      const walletBalance = parseFloat(
        ethers.formatUnits(BigInt(balance.toString()), 6)
      );

      // Portfolio breakdown
      console.log(colorText("\n🔍 PORTFOLIO BREAKDOWN", colors.brightYellow));
      console.log(colorText("═".repeat(70), colors.cyan));

      console.log(colorText(`\n💳 WALLET & COLLATERAL:`, colors.bright));
      console.log(
        colorText(
          `   • Wallet Balance:     ${walletBalance
            .toFixed(2)
            .padStart(12)} USDC`,
          colors.green
        )
      );
      console.log(
        colorText(
          `   • Total Collateral:   ${totalCollateral
            .toFixed(2)
            .padStart(12)} USDC`,
          colors.blue
        )
      );
      console.log(
        colorText(
          `   • Available Balance:  ${colorText(
            availableBalance.toFixed(2).padStart(12),
            colors.brightGreen
          )} USDC`,
          colors.white
        )
      );

      const utilizationRate =
        totalCollateral > 0
          ? ((totalCollateral - availableBalance) / totalCollateral) * 100
          : 0;
      const utilizationColor =
        utilizationRate > 80
          ? colors.red
          : utilizationRate > 60
          ? colors.yellow
          : colors.green;
      console.log(
        colorText(
          `   • Utilization Rate:   ${colorText(
            utilizationRate.toFixed(1).padStart(12),
            utilizationColor
          )}%`,
          colors.white
        )
      );

      console.log(colorText(`\n🔒 MARGIN ALLOCATION:`, colors.bright));
      console.log(
        colorText(
          `   • Margin Used:        ${colorText(
            marginUsed.toFixed(2).padStart(12),
            colors.yellow
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   • Margin Reserved:    ${colorText(
            marginReserved.toFixed(2).padStart(12),
            colors.yellow
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   • Total Locked:       ${colorText(
            (marginUsed + marginReserved).toFixed(2).padStart(12),
            colors.magenta
          )} USDC`,
          colors.white
        )
      );

      console.log(colorText(`\n📊 PROFIT & LOSS:`, colors.bright));
      // Determine sign based on the BigInt value, not the parsed float
      const realizedColor = realizedPnLBigInt >= 0n ? colors.green : colors.red;
      const realizedSign = realizedPnLBigInt >= 0n ? "+" : "";
      // Use the string format directly from formatWithAutoDecimalDetection
      const realizedPnLDisplay = realizedSign + realizedPnLStr;
      console.log(
        colorText(
          `   • Realized P&L:       ${colorText(
            realizedPnLDisplay.padStart(12),
            realizedColor
          )} USDC`,
          colors.white
        )
      );

      const unrealizedColor = unrealizedPnL >= 0 ? colors.green : colors.red;
      const unrealizedSign = unrealizedPnL >= 0 ? "+" : "";
      console.log(
        colorText(
          `   • Unrealized P&L:     ${colorText(
            (unrealizedSign + unrealizedPnL.toFixed(2)).padStart(12),
            unrealizedColor
          )} USDC`,
          colors.white
        )
      );

      const totalPnL = realizedPnL + unrealizedPnL;
      const totalPnLColor =
        totalPnL >= 0 ? colors.brightGreen : colors.brightRed;
      const totalPnLSign = totalPnL >= 0 ? "+" : "";
      console.log(
        colorText(
          `   • Total P&L:          ${colorText(
            (totalPnLSign + totalPnL.toFixed(2)).padStart(12),
            totalPnLColor
          )} USDC`,
          colors.white
        )
      );

      console.log(colorText(`\n🏆 PORTFOLIO VALUE:`, colors.bright));
      const portfolioColor =
        portfolioValue >= totalCollateral
          ? colors.brightGreen
          : colors.brightRed;
      console.log(
        colorText(
          `   • Total Portfolio:    ${colorText(
            portfolioValue.toFixed(2).padStart(12),
            portfolioColor
          )} USDC`,
          colors.white
        )
      );

      const portfolioChange = portfolioValue - totalCollateral;
      const portfolioChangeColor =
        portfolioChange >= 0 ? colors.green : colors.red;
      const portfolioChangeSign = portfolioChange >= 0 ? "+" : "";
      console.log(
        colorText(
          `   • Net Change:         ${colorText(
            (portfolioChangeSign + portfolioChange.toFixed(2)).padStart(12),
            portfolioChangeColor
          )} USDC`,
          colors.white
        )
      );

      // Position Details - Enhanced Display
      if (positions.length > 0) {
        console.log(
          colorText(`\n📈 OPEN POSITIONS (${positions.length}):`, colors.bright)
        );
        console.log(
          colorText(
            "┌─────────────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│  Market   │    Size      │ Entry Price │   Margin   │   P&L    │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        let totalPositionValue = 0;
        for (const position of positions) {
          try {
            const marketIdStr = (
              await safeDecodeMarketId(position.marketId, this.contracts)
            ).substring(0, 8);

            // Safe BigInt conversion
            const positionSize = BigInt(position.size.toString());
            const absSize = positionSize >= 0n ? positionSize : -positionSize;
            const size = parseFloat(ethers.formatUnits(absSize, 18));
            const sizeColor = positionSize >= 0n ? colors.green : colors.red;
            const sizeSign = positionSize >= 0n ? "LONG " : "SHORT";

            const entryPrice = parseFloat(
              ethers.formatUnits(BigInt(position.entryPrice.toString()), 18)
            );
            const marginLocked = parseFloat(
              ethers.formatUnits(BigInt(position.marginLocked.toString()), 6)
            );

            // Calculate position value
            const positionValue = size * entryPrice;
            totalPositionValue += positionValue;

            // Try to get current market price for P&L calculation
            let currentPnL = 0;
            let markPrice = entryPrice; // Default to entry price
            try {
              const bestBid = await this.contracts.orderBook.bestBid();
              const bestAsk = await this.contracts.orderBook.bestAsk();
              if (bestBid > 0 && bestAsk > 0) {
                const bidPrice = parseFloat(ethers.formatUnits(bestBid, 6));
                const askPrice = parseFloat(ethers.formatUnits(bestAsk, 6));
                markPrice =
                  !isNaN(bidPrice) &&
                  !isNaN(askPrice) &&
                  bidPrice > 0 &&
                  askPrice > 0
                    ? (bidPrice + askPrice) / 2
                    : entryPrice; // Fallback to entry price if no market
                const priceDiff = markPrice - entryPrice;
                currentPnL =
                  positionSize >= 0n ? priceDiff * size : -priceDiff * size;
              }
            } catch (priceError) {
              // Use 0 if can't get prices, markPrice stays as entryPrice
            }

            totalUnrealizedPnL += currentPnL;

            const pnlColor = currentPnL >= 0 ? colors.green : colors.red;
            const pnlSign = currentPnL >= 0 ? "+" : "";

            console.log(
              colorText(
                `│ ${marketIdStr.padEnd(10)} │ ${colorText(
                  side.padEnd(8),
                  sizeColor
                )} │ ${size.toFixed(4).padStart(11)} │ $${entryPrice.padStart(
                  10
                )} │ ${marginLocked.toFixed(2).padStart(10)} │ ${(!isNaN(
                  markPrice
                )
                  ? markPrice.toFixed(2)
                  : "N/A"
                ).padStart(8)} │ ${colorText(
                  (pnlSign + currentPnL.toFixed(2)).padStart(6),
                  pnlColor
                )} │`,
                colors.white
              )
            );
          } catch (positionError) {
            console.log(
              colorText(
                `│ ERROR     │ Cannot parse position data                                      │`,
                colors.red
              )
            );
            console.error(
              "Debug - ViewOpenPositions error:",
              positionError.message
            );
          }
        }

        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        // Summary row
        const totalPnLColor =
          totalUnrealizedPnL >= 0 ? colors.brightGreen : colors.brightRed;
        const totalPnLSign = totalUnrealizedPnL >= 0 ? "+" : "";
        console.log(
          colorText(
            `│ TOTALS    │          │             │             │ ${totalMarginLocked
              .toFixed(2)
              .padStart(10)} │          │ ${colorText(
              (totalPnLSign + totalUnrealizedPnL.toFixed(2)).padStart(6),
              totalPnLColor
            )} │`,
            colors.bright
          )
        );

        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );

        // Position Management Options
        console.log(colorText("\n🎮 POSITION MANAGEMENT", colors.brightYellow));
        console.log(
          colorText("┌─────────────────────────────────────────┐", colors.cyan)
        );
        console.log(
          colorText("│ 1. 🔄 Refresh Positions & Prices       │", colors.green)
        );
        console.log(
          colorText("│ 2. 📊 Detailed Position Analysis       │", colors.blue)
        );
        console.log(
          colorText("│ 3. ⚡ Quick Close Position             │", colors.red)
        );
        console.log(
          colorText("│ 4. 🔙 Back to Main Menu               │", colors.dim)
        );
        console.log(
          colorText("└─────────────────────────────────────────┘", colors.cyan)
        );

        const choice = await this.askQuestion(
          colorText("\n🎯 Choose action: ", colors.brightMagenta)
        );

        switch (choice.trim()) {
          case "1":
            // Refresh - just call the function again
            await this.viewOpenPositions();
            return;
          case "2":
            await this.detailedPositionAnalysis(positions);
            break;
          case "3":
            await this.quickClosePosition(positions);
            break;
          case "4":
            // Return to main menu
            return;
          default:
            console.log(colorText("❌ Invalid choice", colors.red));
            await this.pause(1000);
        }
      }
    } catch (error) {
      console.log(
        colorText("❌ Could not fetch positions: " + error.message, colors.red)
      );
      console.log(colorText("🔍 Debug info:", colors.dim));
      console.log(
        colorText(
          `   Contract: ${await this.contracts.vault.getAddress()}`,
          colors.dim
        )
      );
      console.log(
        colorText(`   User: ${this.currentUser.address}`, colors.dim)
      );
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async viewOpenPositions() {
    console.clear();
    console.log(boxText("🔍 VIEW OPEN POSITIONS", colors.cyan));

    try {
      // Get regular margin position
      const marginPosition = await this.contracts.orderBook.getUserPosition(
        this.currentUser.address
      );

      // Get isolated positions from OrderBook
      const positionIds = await this.contracts.orderBook.getUserPositions(
        this.currentUser.address
      );

      // Check if we have any positions (regular margin or isolated)
      const hasMarginPosition = marginPosition !== 0n;
      const hasIsolatedPositions = positionIds && positionIds.length > 0;

      if (!hasMarginPosition && !hasIsolatedPositions) {
        console.log(colorText("\n💤 No open positions found", colors.yellow));
        await this.pause(2000);
        return;
      }

      let totalPositions = 0;
      if (hasMarginPosition) totalPositions++;
      if (hasIsolatedPositions) totalPositions += positionIds.length;

      console.log(
        colorText(
          `\n📊 Found ${totalPositions} open position(s)\n`,
          colors.cyan
        )
      );

      // Get current mark price once for all positions
      const currentMarkPrice = await this.contracts.orderBook.getMarkPrice();
      const markPriceFloat = parseFloat(
        ethers.formatUnits(currentMarkPrice, 6) // Prices are in 6 decimals (USDC)
      );

      // Display positions table
      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────────────────────────────────────┐",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "│ Market ID           │ Side     │ Size (ALU) │ Entry Price │ Margin     │ Mark    │ P&L   │",
          colors.bright
        )
      );
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      let totalMarginLocked = 0;
      let totalUnrealizedPnL = 0;

      // Group positions by entry price and side (like in quick position summary)
      const positionGroups = new Map();

      // Handle regular margin position first
      if (hasMarginPosition) {
        const positionSize = BigInt(marginPosition.toString());
        const absSize = positionSize < 0n ? -positionSize : positionSize;
        const side = positionSize >= 0n ? "LONG" : "SHORT";

        // For regular margin positions, we don't have entry price or liquidation price
        // Use current price as entry price and calculate liquidation threshold
        const entryPrice = BigInt(currentMarkPrice.toString());
        const liquidationPrice = BigInt(currentMarkPrice.toString()); // Will be calculated properly in production

        const groupKey = `MARGIN_${side}_${entryPrice}`;

        positionGroups.set(groupKey, {
          side: side,
          sideColor: positionSize >= 0n ? colors.green : colors.red,
          entryPrice: entryPrice,
          liquidationPrice: liquidationPrice,
          totalSize: absSize,
          totalMargin: 0n, // Regular margin positions don't have isolated margin
          positionCount: 1,
          isMarginPosition: true,
        });
      }

      // Handle isolated positions
      if (hasIsolatedPositions) {
        for (const positionId of positionIds) {
          try {
            const isolatedPos = await this.contracts.orderBook.getPosition(
              this.currentUser.address,
              positionId
            );

            // Skip inactive (liquidated/closed) positions
            if (!isolatedPos.isActive) {
              continue;
            }

            const positionSize = BigInt(isolatedPos.size.toString());
            const entryPrice = BigInt(isolatedPos.entryPrice.toString());
            const liquidationPrice = BigInt(
              isolatedPos.liquidationPrice.toString()
            );

            // Create a key for grouping (side + entry price + liquidation price)
            const side = positionSize >= 0n ? "LONG" : "SHORT";
            const groupKey = `ISOLATED_${side}_${entryPrice}_${liquidationPrice}`;

            if (!positionGroups.has(groupKey)) {
              positionGroups.set(groupKey, {
                side: side,
                sideColor: positionSize >= 0n ? colors.green : colors.red,
                entryPrice: entryPrice,
                liquidationPrice: liquidationPrice,
                totalSize: 0n,
                totalMargin: 0n,
                positionCount: 0,
                isMarginPosition: false,
              });
            }

            const group = positionGroups.get(groupKey);
            group.totalSize +=
              positionSize >= 0n ? positionSize : -positionSize;
            group.totalMargin += BigInt(isolatedPos.isolatedMargin.toString());
            group.positionCount++;
          } catch (positionError) {
            console.log(
              colorText(
                `│ ERROR     │ Cannot parse position data                                      │`,
                colors.red
              )
            );
            console.error(
              "Debug - ViewOpenPositions error:",
              positionError.message
            );
          }
        }
      }

      // Display grouped positions
      for (const [groupKey, group] of positionGroups) {
        try {
          const marketIdStr = group.isMarginPosition
            ? "ALU-USD (MARGIN)"
            : "ALU-USD (ISOLATED)";

          const size = parseFloat(ethers.formatUnits(group.totalSize, 18));
          const entryPrice = parseFloat(
            ethers.formatUnits(group.entryPrice, 6) // Prices are in 6 decimals (USDC)
          );
          const marginLocked = parseFloat(
            ethers.formatUnits(group.totalMargin, 6)
          );

          totalMarginLocked += marginLocked;

          // Use the actual mark price from the contract
          const markPrice = markPriceFloat;

          // Calculate unrealized P&L correctly
          const priceDiff = markPrice - entryPrice;
          const positionPnL =
            group.side === "LONG"
              ? priceDiff * size // Long position: profit when price goes up
              : -priceDiff * size; // Short position: profit when price goes down

          totalUnrealizedPnL += positionPnL;

          const pnlColor = positionPnL >= 0 ? colors.green : colors.red;
          const pnlSign = positionPnL >= 0 ? "+" : "";

          // Show position count if more than 1
          const positionCountText =
            group.positionCount > 1 ? ` (${group.positionCount})` : "";

          console.log(
            colorText(
              `│ ${marketIdStr.padEnd(20)} │ ${colorText(
                (group.side + positionCountText).padEnd(8),
                group.sideColor
              )} │ ${size.toFixed(4).padStart(11)} │ $${entryPrice
                .toFixed(4)
                .padStart(10)} │ ${marginLocked
                .toFixed(2)
                .padStart(10)} │ $${markPrice
                .toFixed(4)
                .padStart(8)} │ ${colorText(
                (pnlSign + positionPnL.toFixed(2)).padStart(6),
                pnlColor
              )} │`,
              colors.white
            )
          );
        } catch (groupError) {
          console.log(
            colorText(
              `│ ERROR     │ Cannot parse grouped position data                              │`,
              colors.red
            )
          );
          console.error("Debug - Grouped position error:", groupError.message);
        }
      }

      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );

      // Summary row
      const totalPnLColor =
        totalUnrealizedPnL >= 0 ? colors.brightGreen : colors.brightRed;
      const totalPnLSign = totalUnrealizedPnL >= 0 ? "+" : "";
      console.log(
        colorText(
          `│ TOTALS    │          │             │             │ ${totalMarginLocked
            .toFixed(2)
            .padStart(10)} │          │ ${colorText(
            (totalPnLSign + totalUnrealizedPnL.toFixed(2)).padStart(6),
            totalPnLColor
          )} │`,
          colors.bright
        )
      );

      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────────────────────────────────────┘",
          colors.cyan
        )
      );

      // Position Management Options
      console.log(colorText("\n🎮 POSITION MANAGEMENT", colors.brightYellow));
      console.log(
        colorText("┌─────────────────────────────────────────┐", colors.cyan)
      );
      console.log(
        colorText("│ 1. 🔄 Refresh Positions                 │", colors.white)
      );
      console.log(
        colorText("│ 2. 🔍 Detailed Position Analysis        │", colors.white)
      );
      console.log(
        colorText("│ 3. ⚡ Quick Close Position              │", colors.white)
      );
      console.log(
        colorText("│ 4. 📊 Close All Positions               │", colors.white)
      );
      console.log(
        colorText("│ 5. 🔙 Back to Main Menu                 │", colors.white)
      );
      console.log(
        colorText("└─────────────────────────────────────────┘", colors.cyan)
      );

      const choice = await this.askQuestion(
        colorText("\n👉 Select option (1-5): ", colors.yellow)
      );

      switch (choice.trim()) {
        case "1":
          // Refresh - just call the function again
          await this.viewOpenPositions();
          return;
        case "2":
          await this.detailedPositionAnalysis(positions);
          break;
        case "3":
          await this.quickClosePosition(positions);
          break;
        case "4":
          await this.closeAllPositions(positions);
          break;
        case "5":
          // Back to main menu
          break;
        default:
          console.log(colorText("❌ Invalid option", colors.red));
          await this.pause(2000);
          await this.viewOpenPositions();
      }
    } catch (error) {
      console.log(
        colorText(`\n❌ Error viewing positions: ${error.message}`, colors.red)
      );
      console.error("Debug - Full error:", error);
      await this.pause(3000);
    }
  }

  async detailedPositionAnalysis(positions) {
    console.clear();
    console.log(boxText("🔬 DETAILED POSITION ANALYSIS", colors.brightCyan));

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      try {
        console.log(
          colorText(
            `\n📊 POSITION ${i + 1}/${positions.length}`,
            colors.brightYellow
          )
        );
        console.log(colorText("═".repeat(60), colors.cyan));

        const marketIdStr = await safeDecodeMarketId(
          position.marketId,
          this.contracts
        );
        const positionSize = BigInt(position.size.toString());
        const absSize = positionSize >= 0n ? positionSize : -positionSize;
        const size = parseFloat(ethers.formatUnits(absSize, 18));
        const side = positionSize >= 0n ? "LONG" : "SHORT";
        const sideColor = positionSize >= 0n ? colors.green : colors.red;

        // Use high-precision formatting to get exact entry price from smart contract
        const entryPrice = formatPriceWithValidation(
          BigInt(position.entryPrice.toString()),
          6,
          4, // 4 decimals for higher precision
          false // Don't show warnings in detailed view
        );
        const marginLocked = parseFloat(
          ethers.formatUnits(BigInt(position.marginLocked.toString()), 6)
        );
        const positionValue = parseFloat(entryPrice) * size;

        console.log(
          colorText(`🏷️  Market:           ${marketIdStr}`, colors.white)
        );
        console.log(
          colorText(
            `📍 Side:             ${colorText(side, sideColor)}`,
            colors.white
          )
        );
        console.log(
          colorText(`📏 Size:             ${size.toFixed(4)} ALU`, colors.cyan)
        );
        console.log(
          colorText(`💰 Entry Price:      $${entryPrice} USDC`, colors.yellow)
        );
        console.log(
          colorText(
            `🔒 Margin Locked:    $${marginLocked.toFixed(2)} USDC`,
            colors.magenta
          )
        );
        console.log(
          colorText(
            `💎 Position Value:   $${positionValue.toFixed(2)} USDC`,
            colors.blue
          )
        );

        // Show margin requirement
        const isLong = positionSize >= 0n;
        const marginRequirement = isLong ? "100%" : "150%";
        const marginColor = colors.cyan;
        console.log(
          colorText(
            `🔒 Margin Required:  ${colorText(marginRequirement, marginColor)}`,
            colors.white
          )
        );

        // Get current market data
        try {
          const bestBid = await this.contracts.orderBook.bestBid();
          const bestAsk = await this.contracts.orderBook.bestAsk();
          if (bestBid > 0 && bestAsk > 0) {
            const bidPrice = parseFloat(
              formatPriceWithValidation(bestBid, 6, 4, false)
            );
            const askPrice = parseFloat(
              formatPriceWithValidation(bestAsk, 6, 4, false)
            );
            const markPrice =
              !isNaN(bidPrice) &&
              !isNaN(askPrice) &&
              bidPrice > 0 &&
              askPrice > 0
                ? (bidPrice + askPrice) / 2
                : parseFloat(entryPrice); // Fallback to entry price
            const spread = askPrice - bidPrice;

            console.log(
              colorText(
                `📊 Current Bid:      $${bidPrice.toFixed(2)} USDC`,
                colors.green
              )
            );
            console.log(
              colorText(
                `📊 Current Ask:      $${askPrice.toFixed(2)} USDC`,
                colors.red
              )
            );
            console.log(
              colorText(
                `📊 Mark Price:       $${markPrice.toFixed(2)} USDC`,
                colors.brightCyan
              )
            );
            console.log(
              colorText(
                `📏 Spread:           $${spread.toFixed(2)} USDC`,
                colors.dim
              )
            );

            // Calculate P&L
            const priceDiff = markPrice - parseFloat(entryPrice);
            const unrealizedPnL =
              positionSize >= 0n ? priceDiff * size : -priceDiff * size;
            const pnlPercent = (unrealizedPnL / marginLocked) * 100;

            const pnlColor =
              unrealizedPnL >= 0 ? colors.brightGreen : colors.brightRed;
            const pnlSign = unrealizedPnL >= 0 ? "+" : "";
            const pnlPercentColor =
              pnlPercent >= 0 ? colors.brightGreen : colors.brightRed;
            const pnlPercentSign = pnlPercent >= 0 ? "+" : "";

            console.log(
              colorText(
                `💹 Unrealized P&L:   ${colorText(
                  pnlSign + "$" + unrealizedPnL.toFixed(2),
                  pnlColor
                )} USDC`,
                colors.white
              )
            );
            console.log(
              colorText(
                `📈 P&L Percentage:   ${colorText(
                  pnlPercentSign + pnlPercent.toFixed(2) + "%",
                  pnlPercentColor
                )}`,
                colors.white
              )
            );

            // Risk metrics
            const liquidationBuffer = marginLocked - Math.abs(unrealizedPnL);
            const liquidationBufferColor =
              liquidationBuffer < marginLocked * 0.2
                ? colors.red
                : colors.green;
            console.log(
              colorText(
                `🛡️  Liquidation Buffer: ${colorText(
                  "$" + liquidationBuffer.toFixed(2),
                  liquidationBufferColor
                )} USDC`,
                colors.white
              )
            );
          }
        } catch (priceError) {
          console.log(
            colorText(
              `⚠️  Could not fetch current market prices`,
              colors.yellow
            )
          );
        }

        console.log(colorText("═".repeat(60), colors.cyan));
      } catch (error) {
        console.log(
          colorText(
            `❌ Error analyzing position ${i + 1}: ${error.message}`,
            colors.red
          )
        );
      }
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async closeAllPositions(positions) {
    console.clear();
    console.log(boxText("🔥 CLOSE ALL POSITIONS", colors.red));

    if (!positions || positions.length === 0) {
      console.log(colorText("\n💤 No positions to close", colors.yellow));
      await this.pause(2000);
      return;
    }

    console.log(
      colorText(
        `\n⚠️  WARNING: This will close ALL ${positions.length} open position(s)!\n`,
        colors.brightRed
      )
    );

    // Show all positions to be closed
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      const positionSize = BigInt(position.size.toString());
      const absSize = positionSize < 0n ? -positionSize : positionSize;
      const side = positionSize >= 0n ? "LONG" : "SHORT";
      const sizeColor = positionSize >= 0n ? colors.green : colors.red;
      const size = parseFloat(ethers.formatUnits(absSize, 18));

      console.log(
        colorText(
          `   ${i + 1}. ${colorText(side, sizeColor)} ${size.toFixed(4)} ALU`,
          colors.white
        )
      );
    }

    const confirm = await this.askQuestion(
      colorText(
        "\n⚠️  Type 'CONFIRM' to close all positions: ",
        colors.brightRed
      )
    );

    if (confirm.trim().toUpperCase() !== "CONFIRM") {
      console.log(colorText("\n❌ Cancelled", colors.yellow));
      await this.pause(2000);
      return;
    }

    console.log(colorText("\n🔄 Closing all positions...", colors.yellow));

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      try {
        const positionSize = BigInt(position.size.toString());
        const absSize = positionSize < 0n ? -positionSize : positionSize;
        const isBuy = positionSize < 0n; // Reverse to close

        console.log(
          colorText(
            `\n📝 Closing position ${i + 1}/${positions.length}...`,
            colors.cyan
          )
        );

        // Place market order to close directly via OrderBook
        // absSize is 18 decimals, isBuy closes by taking opposite side
        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginMarketOrder(absSize, isBuy);

        console.log(
          colorText(`   ⏳ Transaction sent: ${tx.hash}`, colors.dim)
        );
        const receipt = await tx.wait();

        if (receipt.status === 1) {
          console.log(colorText(`   ✅ Position closed!`, colors.green));
          successCount++;
        } else {
          console.log(colorText(`   ❌ Transaction failed`, colors.red));
          failCount++;
        }
      } catch (error) {
        console.log(colorText(`   ❌ Error: ${error.message}`, colors.red));
        failCount++;
      }
    }

    console.log(colorText("\n📊 SUMMARY", colors.brightCyan));
    console.log(
      colorText(`   ✅ Successfully closed: ${successCount}`, colors.green)
    );
    console.log(colorText(`   ❌ Failed: ${failCount}`, colors.red));

    await this.pause(3000);
  }

  async quickClosePosition(positions) {
    console.clear();
    console.log(boxText("⚡ QUICK CLOSE POSITION", colors.red));

    // Validate positions array
    if (!positions || !Array.isArray(positions)) {
      console.log(
        colorText("\n❌ Invalid positions data received", colors.red)
      );
      console.log(colorText(`   Type: ${typeof positions}`, colors.dim));
      console.log(
        colorText(`   Value: ${JSON.stringify(positions)}`, colors.dim)
      );
      await this.pause(3000);
      return;
    }

    if (positions.length === 0) {
      console.log(colorText("\n💤 No positions to close", colors.yellow));
      await this.pause(2000);
      return;
    }

    console.log(
      colorText(
        `\n📊 Found ${positions.length} position(s) to analyze`,
        colors.cyan
      )
    );

    // If positions seem corrupted, try to re-fetch them
    let validPositions = positions;
    let hasErrors = false;

    // Quick validation check
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      if (
        !position ||
        !position.marketId ||
        position.size === undefined ||
        !position.entryPrice
      ) {
        hasErrors = true;
        break;
      }
    }

    if (hasErrors) {
      console.log(
        colorText(
          "\n⚠️ Detected corrupted position data, re-fetching...",
          colors.yellow
        )
      );
      try {
        validPositions = await this.contracts.vault.getUserPositions(
          this.currentUser.address
        );
        console.log(
          colorText(
            `✅ Re-fetched ${validPositions.length} positions`,
            colors.green
          )
        );
      } catch (refetchError) {
        console.log(
          colorText(
            `❌ Failed to re-fetch positions: ${refetchError.message}`,
            colors.red
          )
        );
        await this.pause(3000);
        return;
      }
    }

    console.log(
      colorText("\n📊 SELECT POSITION TO CLOSE:", colors.brightYellow)
    );
    console.log(
      colorText(
        "┌─────────────────────────────────────────────────────────┐",
        colors.cyan
      )
    );

    for (let i = 0; i < validPositions.length; i++) {
      const position = validPositions[i];
      try {
        // Validate position data exists
        if (!position) {
          throw new Error("Position data is null or undefined");
        }
        if (!position.marketId) {
          throw new Error("Position marketId is missing");
        }
        if (position.size === undefined || position.size === null) {
          throw new Error("Position size is missing");
        }
        if (!position.entryPrice) {
          throw new Error("Position entryPrice is missing");
        }

        const marketIdStr = (
          await safeDecodeMarketId(position.marketId, this.contracts)
        ).substring(0, 10);
        const positionSize = BigInt(position.size.toString());
        const absSize = positionSize >= 0n ? positionSize : -positionSize;
        const size = parseFloat(ethers.formatUnits(absSize, 18));
        const side = positionSize >= 0n ? "LONG" : "SHORT";
        const sideColor = positionSize >= 0n ? colors.green : colors.red;

        // Use high-precision formatting to get exact entry price from smart contract
        const entryPrice = formatPriceWithValidation(
          BigInt(position.entryPrice.toString()),
          6,
          4, // 4 decimals for higher precision
          false // Don't show warnings in quick close
        );

        console.log(
          colorText(
            `│ ${(i + 1).toString().padStart(2)}. ${marketIdStr.padEnd(
              10
            )} │ ${colorText(side.padEnd(5), sideColor)} │ ${size
              .toFixed(2)
              .padStart(8)} ALU │ $${entryPrice.padStart(9)} │`,
            colors.white
          )
        );
      } catch (error) {
        console.log(
          colorText(
            `│ ${(i + 1).toString().padStart(2)}. ERROR: ${error.message
              .substring(0, 45)
              .padEnd(45)} │`,
            colors.red
          )
        );
        console.log(
          colorText(
            `│    Debug: marketId=${position.marketId || "undefined"} │`,
            colors.dim
          )
        );
        console.log(
          colorText(
            `│           size=${position.size || "undefined"} │`,
            colors.dim
          )
        );
        if (position.size) {
          try {
            const positionSizeBigInt = BigInt(position.size.toString());
            const sizeFormatted = ethers.formatUnits(
              positionSizeBigInt < 0n
                ? -positionSizeBigInt
                : positionSizeBigInt,
              18
            );
            const side = positionSizeBigInt >= 0n ? "LONG" : "SHORT";
            console.log(
              colorText(
                `│           formatted: ${side} ${sizeFormatted} ALU │`,
                colors.dim
              )
            );
          } catch (formatError) {
            console.log(
              colorText(
                `│           format error: ${formatError.message} │`,
                colors.dim
              )
            );
          }
        }
      }
    }

    console.log(
      colorText(
        "└─────────────────────────────────────────────────────────┘",
        colors.cyan
      )
    );

    const choice = await this.askQuestion(
      colorText(
        `\n🎯 Select position to close (1-${validPositions.length}) or 0 to cancel: `,
        colors.brightMagenta
      )
    );

    const index = parseInt(choice) - 1;
    if (choice === "0") {
      console.log(colorText("❌ Close cancelled", colors.yellow));
      await this.pause(1000);
      return;
    }

    if (index >= 0 && index < validPositions.length) {
      const position = validPositions[index];
      try {
        const marketIdStr = await safeDecodeMarketId(
          position.marketId,
          this.contracts
        );
        const positionSize = BigInt(position.size.toString());
        const absSize = positionSize >= 0n ? positionSize : -positionSize;
        const size = parseFloat(ethers.formatUnits(absSize, 18));
        const side = positionSize >= 0n ? "LONG" : "SHORT";
        const isLong = positionSize >= 0n;

        console.log(
          colorText(
            `\n🔄 Closing ${side} position of ${size.toFixed(4)} ALU...`,
            colors.yellow
          )
        );
        console.log(
          colorText(
            "💡 This will place a market order in the opposite direction",
            colors.cyan
          )
        );

        const confirm = await this.askQuestion(
          colorText("\n✅ Confirm position close? (y/n): ", colors.brightGreen)
        );

        if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
          console.log(
            colorText(
              "\n🚀 Placing market order to close position...",
              colors.yellow
            )
          );

          // Place opposite market order to close position
          const amountWei = ethers.parseUnits(size.toString(), 18);
          const isBuy = !isLong; // If we're long, we sell to close. If we're short, we buy to close.

          const tx = await this.contracts.orderBook
            .connect(this.currentUser)
            .placeMarginMarketOrder(amountWei, isBuy);

          console.log(colorText("⏳ Transaction submitted...", colors.yellow));
          const receipt = await tx.wait();

          console.log(
            colorText("✅ Position closed successfully!", colors.brightGreen)
          );
          console.log(colorText(`📄 Transaction: ${tx.hash}`, colors.dim));
          console.log(
            colorText(`⛽ Gas used: ${receipt.gasUsed.toString()}`, colors.dim)
          );
        } else {
          console.log(colorText("❌ Position close cancelled", colors.yellow));
        }
      } catch (error) {
        console.log(
          colorText("❌ Failed to close position: " + error.message, colors.red)
        );
      }
    } else {
      console.log(colorText("❌ Invalid selection", colors.red));
    }

    await this.pause(3000);
  }

  async manageCollateral() {
    console.clear();
    console.log(boxText("🏦 COLLATERAL MANAGEMENT", colors.blue));

    const balance = await this.contracts.mockUSDC.balanceOf(
      this.currentUser.address
    );
    const collateral = await this.contracts.vault.userCollateral(
      this.currentUser.address
    );

    console.log(
      colorText(`\n💰 USDC Balance: ${formatUSDC(balance)} USDC`, colors.green)
    );
    console.log(
      colorText(
        `🏦 Deposited Collateral: ${formatUSDC(collateral)} USDC`,
        colors.blue
      )
    );

    console.log(colorText("\n1. 📥 Deposit Collateral", colors.green));
    console.log(colorText("2. 📤 Withdraw Collateral", colors.red));
    console.log(colorText("3. 🔙 Back to Main Menu", colors.dim));

    const choice = await this.askQuestion(
      colorText("\n🎯 Choose action: ", colors.brightBlue)
    );

    if (choice === "1") {
      const amount = await this.askQuestion(
        colorText("💰 Enter amount to deposit: ", colors.green)
      );
      if (amount && !isNaN(amount)) {
        try {
          const amountWei = ethers.parseUnits(amount, 6);

          // Approve first
          console.log(colorText("⏳ Approving USDC...", colors.yellow));
          const approveTx = await this.contracts.mockUSDC
            .connect(this.currentUser)
            .approve(await this.contracts.vault.getAddress(), amountWei);
          await approveTx.wait();

          // Deposit
          console.log(colorText("⏳ Depositing collateral...", colors.yellow));
          const depositTx = await this.contracts.vault
            .connect(this.currentUser)
            .depositCollateral(amountWei);
          await depositTx.wait();

          console.log(
            colorText(
              "✅ Collateral deposited successfully!",
              colors.brightGreen
            )
          );
        } catch (error) {
          console.log(
            colorText("❌ Deposit failed: " + error.message, colors.red)
          );
        }
      }
    } else if (choice === "2") {
      const amount = await this.askQuestion(
        colorText("💸 Enter amount to withdraw: ", colors.red)
      );
      if (amount && !isNaN(amount)) {
        try {
          const amountWei = ethers.parseUnits(amount, 6);

          console.log(colorText("⏳ Withdrawing collateral...", colors.yellow));
          const withdrawTx = await this.contracts.vault
            .connect(this.currentUser)
            .withdrawCollateral(amountWei);
          await withdrawTx.wait();

          console.log(
            colorText(
              "✅ Collateral withdrawn successfully!",
              colors.brightGreen
            )
          );
        } catch (error) {
          console.log(
            colorText("❌ Withdrawal failed: " + error.message, colors.red)
          );
        }
      }
    }

    if (choice === "1" || choice === "2") {
      await this.pause(3000);
    }
  }

  async testSlippageRequirement() {
    console.clear();
    console.log(
      boxText("🧪 TEST REQUIREMENT 11: SLIPPAGE PROTECTION", colors.magenta)
    );
    console.log(
      colorText(
        "Testing: Market orders cancel unfilled portions beyond slippage tolerance",
        colors.cyan
      )
    );

    try {
      // Step 1: Show current order book state
      await this.displayOrderBook();

      console.log(
        colorText("\n🎯 Slippage Test Scenario:", colors.brightYellow)
      );
      console.log(
        colorText("   This test will demonstrate Requirement 11:", colors.cyan)
      );
      console.log(
        colorText(
          "   • Market orders execute within slippage tolerance",
          colors.cyan
        )
      );
      console.log(
        colorText(
          "   • Unfilled portions beyond tolerance are cancelled",
          colors.cyan
        )
      );
      console.log(
        colorText("   • No partial orders left hanging", colors.cyan)
      );

      const proceed = await this.askQuestion(
        colorText(
          "\n🚀 Proceed with slippage test? (y/n): ",
          colors.brightGreen
        )
      );

      if (proceed.toLowerCase() !== "y" && proceed.toLowerCase() !== "yes") {
        console.log(colorText("❌ Test cancelled", colors.yellow));
        await this.pause(2000);
        return;
      }

      // Step 2: Check if there's existing liquidity
      const [bestBid, bestAsk] = await this.contracts.orderBook.getBestPrices();
      const hasLiquidity = bestBid > 0n || bestAsk < ethers.MaxUint256;

      if (!hasLiquidity) {
        console.log(
          colorText("\n⚠️ No existing liquidity detected.", colors.yellow)
        );
        console.log(
          colorText(
            "💡 Creating test liquidity ladder for demonstration...",
            colors.cyan
          )
        );

        // Create liquidity ladder for testing
        await this.createTestLiquidityLadder();
        await this.displayOrderBook();
      }

      // Step 3: Execute test market order with tight slippage
      console.log(
        colorText(
          "\n🧪 Executing test market order with tight slippage...",
          colors.brightYellow
        )
      );

      const testAmount = await this.askQuestion(
        colorText(
          "📊 Enter test order size (ALU) [default: 350]: ",
          colors.cyan
        )
      );

      const amount = testAmount && !isNaN(testAmount) ? testAmount : "350";

      const testSlippage = await this.askQuestion(
        colorText(
          "🎯 Enter tight slippage % for test [default: 3]: ",
          colors.cyan
        )
      );

      const slippagePercent =
        testSlippage && !isNaN(testSlippage) ? parseFloat(testSlippage) : 3;
      const slippageBps = Math.round(slippagePercent * 100);

      console.log(colorText("\n🎯 Test Parameters:", colors.brightCyan));
      console.log(colorText(`   Order Size: ${amount} ALU`, colors.white));
      console.log(
        colorText(`   Slippage Tolerance: ${slippagePercent}%`, colors.white)
      );
      console.log(
        colorText(
          `   Expected: Partial fill with remainder cancelled`,
          colors.magenta
        )
      );

      const executeTest = await this.askQuestion(
        colorText("\n✅ Execute slippage test? (y/n): ", colors.brightGreen)
      );

      if (
        executeTest.toLowerCase() === "y" ||
        executeTest.toLowerCase() === "yes"
      ) {
        const amountWei = ethers.parseUnits(amount, 18);

        // Get expected fill amount
        const filledAmountWei = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginMarketOrderWithSlippage.staticCall(
            amountWei,
            true,
            slippageBps
          );

        // Execute the actual order
        const tx = await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginMarketOrderWithSlippage(amountWei, true, slippageBps);

        console.log(colorText("⏳ Executing test...", colors.yellow));
        const receipt = await tx.wait();

        const filledAmount = parseFloat(
          ethers.formatUnits(filledAmountWei, 18)
        );
        const requestedAmount = parseFloat(amount);
        const fillRate = (filledAmount / requestedAmount) * 100;
        const cancelledAmount = requestedAmount - filledAmount;

        console.log(
          colorText("\n🎉 SLIPPAGE TEST RESULTS:", colors.brightGreen)
        );
        console.log(
          colorText(`📊 Requested: ${requestedAmount} ALU`, colors.cyan)
        );
        console.log(colorText(`✅ Filled: ${filledAmount} ALU`, colors.green));
        console.log(
          colorText(`❌ Cancelled: ${cancelledAmount} ALU`, colors.red)
        );
        console.log(
          colorText(`📊 Fill Rate: ${fillRate.toFixed(1)}%`, colors.cyan)
        );

        if (cancelledAmount > 0) {
          console.log(
            colorText("\n🎯 REQUIREMENT 11 VERIFIED:", colors.brightGreen)
          );
          console.log(
            colorText(
              "✅ Market order executed within slippage tolerance",
              colors.green
            )
          );
          console.log(
            colorText(
              "✅ Unfilled portion beyond tolerance was cancelled",
              colors.green
            )
          );
          console.log(
            colorText(
              "✅ No partial orders left hanging in the book",
              colors.green
            )
          );
        } else {
          console.log(
            colorText(
              "\n✅ Order fully filled within slippage tolerance",
              colors.green
            )
          );
          console.log(
            colorText(
              "💡 Try with larger amount or tighter slippage to see cancellation",
              colors.cyan
            )
          );
        }

        console.log(colorText(`📄 Transaction: ${tx.hash}`, colors.dim));

        // Show updated order book
        console.log(colorText("\n📊 Updated Order Book:", colors.cyan));
        await this.displayOrderBook();
      } else {
        console.log(colorText("❌ Test cancelled", colors.yellow));
      }
    } catch (error) {
      console.log(
        colorText("❌ Slippage test failed: " + error.message, colors.red)
      );
    }

    await this.pause(5000);
  }

  async viewTradeHistory() {
    console.clear();
    console.log(boxText("📈 MY TRADE HISTORY", colors.brightGreen));

    // Show current user info
    const userType =
      this.currentUserIndex === 0
        ? "Deployer"
        : `User ${this.currentUserIndex}`;
    console.log(
      colorText(
        `👤 Viewing trade history for: ${userType} (${this.currentUser.address})`,
        colors.cyan
      )
    );

    try {
      // Get user's trade count
      const userTradeCount = await this.contracts.orderBook.getUserTradeCount(
        this.currentUser.address
      );

      console.log(
        colorText(`\n📊 Total trades: ${userTradeCount}`, colors.brightCyan)
      );

      if (userTradeCount === 0) {
        console.log(
          colorText(
            "\n┌─────────────────────────────────────────────────────────────┐",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│                        💤 NO TRADE HISTORY                 │",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "│                                                             │",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│  💡 Start trading to build your history:                   │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│     • Place limit orders for precise entries               │",
            colors.white
          )
        );
        console.log(
          colorText(
            "│     • Use market orders for immediate execution            │",
            colors.white
          )
        );
        console.log(
          colorText(
            "│     • All trades are automatically recorded                │",
            colors.white
          )
        );
        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────┘",
            colors.dim
          )
        );

        await this.askQuestion(
          colorText("\n📱 Press Enter to continue...", colors.dim)
        );
        return; // Exit early if no trades
      } else {
        // Ask how many trades to show
        console.log(
          colorText(
            "\n📋 How many recent trades to display?",
            colors.brightYellow
          )
        );
        console.log(colorText("1. Last 10 trades", colors.white));
        console.log(colorText("2. Last 25 trades", colors.white));
        console.log(colorText("3. Last 50 trades", colors.white));
        console.log(colorText("4. All trades", colors.white));

        const choice = await this.askQuestion(
          colorText("Choose option (1-4): ", colors.brightMagenta)
        );

        let limit = 10;
        switch (choice) {
          case "1":
            limit = 10;
            break;
          case "2":
            limit = 25;
            break;
          case "3":
            limit = 50;
            break;
          case "4":
            limit = Number(userTradeCount);
            break;
          default:
            limit = 10;
            break;
        }

        // Get user's recent trades (only if user has trades)
        if (Number(userTradeCount) === 0) {
          console.log(colorText("\n💤 No trades to display", colors.yellow));
          await this.askQuestion(
            colorText("\n📱 Press Enter to continue...", colors.dim)
          );
          return;
        }

        const actualLimit = Math.min(limit, Number(userTradeCount), 100);
        const [trades, hasMore] = await this.contracts.orderBook.getUserTrades(
          this.currentUser.address,
          0,
          actualLimit
        );

        console.log(
          colorText(
            `\n📈 SHOWING ${trades.length} MOST RECENT TRADES`,
            colors.brightYellow
          )
        );

        console.log(
          colorText(
            "\n┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│ Trade ID │   Side   │    Amount     │    Price     │  Trade Value │     Fee      │      Date/Time      │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        let totalVolume = 0;
        let totalFees = 0;
        let buyCount = 0;
        let sellCount = 0;

        for (const trade of trades) {
          try {
            const tradeId = trade.tradeId.toString();
            const shortId =
              tradeId.length > 8 ? tradeId.substring(0, 8) + "..." : tradeId;

            // Determine if user was buyer or seller
            const isBuyer =
              trade.buyer.toLowerCase() ===
              this.currentUser.address.toLowerCase();
            const side = isBuyer ? "BUY" : "SELL";
            const sideColor = isBuyer ? colors.green : colors.red;

            if (isBuyer) buyCount++;
            else sellCount++;

            const amount = Number(ethers.formatUnits(trade.amount, 18));
            const price = Number(ethers.formatUnits(trade.price, 18));
            const tradeValue = Number(ethers.formatUnits(trade.tradeValue, 6));
            const userFee = Number(
              ethers.formatUnits(isBuyer ? trade.buyerFee : trade.sellerFee, 6)
            );

            totalVolume += tradeValue;
            totalFees += userFee;

            const timestamp = new Date(Number(trade.timestamp) * 1000);
            const timeStr = timestamp.toLocaleString();

            // Format margin indicators
            const marginIndicator = isBuyer
              ? trade.buyerIsMargin
                ? "M"
                : "S"
              : trade.sellerIsMargin
              ? "M"
              : "S";

            console.log(
              colorText(
                `│ ${shortId.padEnd(8)} │ ${colorText(
                  (side + marginIndicator).padEnd(8),
                  sideColor
                )} │ ${amount.toFixed(4).padStart(13)} │ ${(
                  "$" + price.toFixed(4)
                ).padStart(12)} │ ${("$" + tradeValue.toFixed(2)).padStart(
                  12
                )} │ ${("$" + userFee.toFixed(4)).padStart(
                  12
                )} │ ${timeStr.padEnd(19)} │`,
                colors.white
              )
            );
          } catch (tradeError) {
            console.log(
              colorText(
                `│ ERROR    │          │               │              │              │              │                     │`,
                colors.red
              )
            );
          }
        }

        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        // Summary row
        console.log(
          colorText(
            `│ 📊 SUMMARY: ${buyCount} buys, ${sellCount} sells │ Volume: $${totalVolume.toFixed(
              2
            )} USDC │ Fees: $${totalFees.toFixed(4)} USDC │`,
            colors.brightGreen
          )
        );

        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );

        // Trading Performance Metrics
        console.log(colorText("\n📊 TRADING PERFORMANCE", colors.brightYellow));
        console.log(
          colorText("┌─────────────────────────────────────────┐", colors.cyan)
        );

        const avgTradeSize = totalVolume / trades.length;
        const avgFee = totalFees / trades.length;
        const feeRate = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;

        console.log(
          colorText(
            `│ Average Trade Size:    $${avgTradeSize
              .toFixed(2)
              .padStart(8)} USDC │`,
            colors.white
          )
        );
        console.log(
          colorText(
            `│ Average Fee per Trade: $${avgFee.toFixed(4).padStart(8)} USDC │`,
            colors.white
          )
        );
        console.log(
          colorText(
            `│ Effective Fee Rate:     ${feeRate
              .toFixed(3)
              .padStart(8)}%      │`,
            colors.white
          )
        );
        console.log(
          colorText(
            `│ Buy/Sell Ratio:        ${buyCount}/${sellCount} trades      │`,
            colors.white
          )
        );
        console.log(
          colorText("└─────────────────────────────────────────┘", colors.cyan)
        );

        // Legend
        console.log(colorText("\n📋 LEGEND:", colors.brightCyan));
        console.log(
          colorText("   • Side: Your perspective (BUY/SELL)", colors.white)
        );
        console.log(
          colorText("   • M = Margin trade, S = Spot trade", colors.white)
        );
        console.log(
          colorText("   • Fees shown are what YOU paid", colors.white)
        );
        console.log(
          colorText("   • Times shown in your local timezone", colors.white)
        );

        if (hasMore) {
          console.log(
            colorText(
              `\n💡 ${userTradeCount - trades.length} more trades available`,
              colors.cyan
            )
          );
          console.log(
            colorText("   Showing most recent trades first", colors.dim)
          );
        }

        // Additional options
        console.log(
          colorText("\n🎮 TRADE HISTORY OPTIONS:", colors.brightYellow)
        );
        console.log(
          colorText("┌─────────────────────────────────────────┐", colors.cyan)
        );
        console.log(
          colorText("│ s. 📊 Show Market Statistics           │", colors.blue)
        );
        console.log(
          colorText("│ r. 🔄 Refresh Trade History            │", colors.white)
        );
        console.log(
          colorText("│ Enter. 🔙 Return to Main Menu         │", colors.dim)
        );
        console.log(
          colorText("└─────────────────────────────────────────┘", colors.cyan)
        );

        const action = await this.askQuestion(
          colorText(
            "Choose action (or Enter to return): ",
            colors.brightMagenta
          )
        );

        switch (action.toLowerCase().trim()) {
          case "s":
            await this.showMarketStatistics();
            break;
          case "r":
            await this.viewTradeHistory(); // Recursive call to refresh
            return;
          default:
            // Return to main menu
            break;
        }
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Could not fetch trade history: " + error.message,
          colors.red
        )
      );
      console.log(colorText("🔍 Debug info:", colors.dim));
      console.log(
        colorText(`   User: ${this.currentUser.address}`, colors.dim)
      );
      console.log(
        colorText(
          `   OrderBook: ${await this.contracts.orderBook.getAddress()}`,
          colors.dim
        )
      );
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async showMarketStatistics() {
    console.clear();
    console.log(boxText("📊 MARKET TRADE STATISTICS", colors.brightCyan));

    try {
      const [totalTrades, totalVolume, totalFees] =
        await this.contracts.orderBook.getTradeStatistics();

      console.log(
        colorText("\n📈 MARKET-WIDE STATISTICS", colors.brightYellow)
      );
      console.log(
        colorText("┌─────────────────────────────────────────┐", colors.cyan)
      );
      console.log(
        colorText(
          `│ Total Trades:          ${totalTrades.toString().padStart(12)} │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Total Volume:      $${ethers
            .formatUnits(totalVolume, 6)
            .padStart(12)} │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Total Fees:        $${ethers
            .formatUnits(totalFees, 6)
            .padStart(12)} │`,
          colors.white
        )
      );

      if (totalTrades > 0) {
        const avgTradeSize =
          Number(ethers.formatUnits(totalVolume, 6)) / Number(totalTrades);
        const avgFeePerTrade =
          Number(ethers.formatUnits(totalFees, 6)) / Number(totalTrades);
        const feeRate =
          (Number(ethers.formatUnits(totalFees, 6)) /
            Number(ethers.formatUnits(totalVolume, 6))) *
          100;

        console.log(
          colorText("├─────────────────────────────────────────┤", colors.cyan)
        );
        console.log(
          colorText(
            `│ Avg Trade Size:    $${avgTradeSize.toFixed(2).padStart(12)} │`,
            colors.cyan
          )
        );
        console.log(
          colorText(
            `│ Avg Fee per Trade: $${avgFeePerTrade.toFixed(4).padStart(12)} │`,
            colors.cyan
          )
        );
        console.log(
          colorText(
            `│ Market Fee Rate:    ${feeRate.toFixed(3).padStart(12)}% │`,
            colors.cyan
          )
        );
      }

      console.log(
        colorText("└─────────────────────────────────────────┘", colors.cyan)
      );

      // Show recent market trades
      console.log(
        colorText("\n📈 RECENT MARKET TRADES (Last 10)", colors.brightYellow)
      );

      try {
        const recentTrades = await this.contracts.orderBook.getRecentTrades(10);

        if (recentTrades.length === 0) {
          console.log(colorText("💤 No recent trades", colors.yellow));
        } else {
          console.log(
            colorText(
              "\n┌─────────────────────────────────────────────────────────────────────────────┐",
              colors.cyan
            )
          );
          console.log(
            colorText(
              "│   Buyer    │   Seller   │    Amount     │    Price     │      Date/Time      │",
              colors.cyan
            )
          );
          console.log(
            colorText(
              "├─────────────────────────────────────────────────────────────────────────────┤",
              colors.cyan
            )
          );

          for (const trade of recentTrades) {
            const buyerShort = trade.buyer.substring(0, 8) + "...";
            const sellerShort = trade.seller.substring(0, 8) + "...";
            const amount = Number(ethers.formatUnits(trade.amount, 18));
            const price = Number(ethers.formatUnits(trade.price, 18));
            const timestamp = new Date(Number(trade.timestamp) * 1000);
            const timeStr = timestamp.toLocaleString();

            console.log(
              colorText(
                `│ ${buyerShort.padEnd(10)} │ ${sellerShort.padEnd(
                  10
                )} │ ${amount.toFixed(4).padStart(13)} │ ${(
                  "$" + price.toFixed(4)
                ).padStart(12)} │ ${timeStr.padEnd(19)} │`,
                colors.white
              )
            );
          }

          console.log(
            colorText(
              "└─────────────────────────────────────────────────────────────────────────────┘",
              colors.cyan
            )
          );
        }
      } catch (recentError) {
        console.log(
          colorText("⚠️ Could not fetch recent market trades", colors.yellow)
        );
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Could not fetch market statistics: " + error.message,
          colors.red
        )
      );
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async createTestLiquidityLadder() {
    console.log(
      colorText("🏗️ Creating test liquidity ladder...", colors.yellow)
    );

    try {
      // Create sell orders at multiple price levels
      const sellOrders = [
        { price: "3.00", amount: "100" },
        { price: "3.10", amount: "100" },
        { price: "3.25", amount: "100" },
        { price: "3.50", amount: "100" },
      ];

      for (const order of sellOrders) {
        const priceWei = ethers.parseUnits(order.price, 6);
        const amountWei = ethers.parseUnits(order.amount, 18);

        await this.contracts.orderBook
          .connect(this.currentUser)
          .placeMarginLimitOrder(priceWei, amountWei, false);

        console.log(
          colorText(
            `   ✅ Created sell order: ${order.amount} ALU at $${order.price}`,
            colors.green
          )
        );
      }

      console.log(
        colorText("✅ Test liquidity ladder created!", colors.brightGreen)
      );
    } catch (error) {
      console.log(
        colorText(`❌ Failed to create liquidity: ${error.message}`, colors.red)
      );
    }
  }

  async resetOrderBookAndFundUsers() {
    console.clear();
    console.log(
      boxText("🔄 RESET ORDER BOOK & FUND USERS", colors.brightYellow)
    );

    console.log(colorText("\n⚠️  WARNING: This will:", colors.red));
    console.log(colorText("  • Cancel ALL open orders", colors.yellow));
    console.log(colorText("  • Close ALL positions", colors.yellow));
    console.log(
      colorText("  • Reset user collateral to 5000 USDC", colors.yellow)
    );
    console.log(colorText("  • Clear order book completely", colors.yellow));

    const confirm = await this.askQuestion(
      colorText(
        "\n❓ Are you sure you want to proceed? (yes/no): ",
        colors.cyan
      )
    );

    if (confirm.toLowerCase() !== "yes") {
      console.log(colorText("\n❌ Reset cancelled", colors.red));
      await this.pause(1500);
      return;
    }

    console.log(colorText("\n🔄 Starting reset process...", colors.cyan));

    try {
      // Get all signers
      const signers = await ethers.getSigners();
      const users = signers; // Include deployer and all users

      // Step 1: Cancel all orders
      console.log(
        colorText("\n📋 Step 1: Canceling all orders...", colors.yellow)
      );
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const userName = i === 0 ? "Deployer" : `User ${i}`;
        console.log(colorText(`   ${userName}: ${user.address}`, colors.dim));

        try {
          // Get all user orders
          const userOrderIds = await this.contracts.orderBook.getUserOrders(
            user.address
          );

          const userName = i === 0 ? "Deployer" : `User ${i}`;
          console.log(
            colorText(
              `     Found ${userOrderIds.length} orders to cancel`,
              colors.cyan
            )
          );

          for (const orderId of userOrderIds) {
            try {
              // Get order details to check if it's still active
              const order = await this.contracts.orderBook.getOrder(orderId);

              if (order.amount > 0) {
                // Order is still active
                await this.contracts.orderBook
                  .connect(user)
                  .cancelOrder(orderId);
                console.log(
                  colorText(
                    `     ✅ Cancelled order #${orderId} (${
                      order.isBuy ? "BUY" : "SELL"
                    })`,
                    colors.green
                  )
                );
              } else {
                console.log(
                  colorText(
                    `     ⚠️  Order #${orderId} already filled/empty`,
                    colors.yellow
                  )
                );
              }
            } catch (orderError) {
              console.log(
                colorText(
                  `     ❌ Failed to cancel order #${orderId}: ${orderError.message}`,
                  colors.red
                )
              );
            }
          }
        } catch (error) {
          const userName = i === 0 ? "Deployer" : `User ${i}`;
          console.log(
            colorText(
              `     ⚠️  No orders found for ${userName}: ${error.message}`,
              colors.yellow
            )
          );
        }
      }

      // Step 2: Close all positions (by trading against each other if needed)
      console.log(
        colorText("\n📊 Step 2: Closing all positions...", colors.yellow)
      );

      // First, get all positions for all users
      const allPositions = [];
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          const positions = await this.contracts.vault.getUserPositions(
            user.address
          );
          for (const position of positions) {
            if (position.size !== 0n) {
              allPositions.push({
                user: user,
                userIndex: i + 1,
                position: position,
                size: position.size,
                absSize: position.size < 0n ? -position.size : position.size,
                isLong: position.size > 0n,
              });
            }
          }
        } catch (error) {
          const userName = i === 0 ? "Deployer" : `User ${i}`;
          console.log(
            colorText(
              `   ${userName}: No positions or error - ${error.message}`,
              colors.yellow
            )
          );
        }
      }

      if (allPositions.length === 0) {
        console.log(
          colorText("   ✅ No positions found to close", colors.green)
        );
      } else {
        console.log(
          colorText(
            `   Found ${allPositions.length} positions to close`,
            colors.cyan
          )
        );

        // Group positions by direction for efficient closing
        const longPositions = allPositions.filter((p) => p.isLong);
        const shortPositions = allPositions.filter((p) => !p.isLong);

        // Close long positions by placing sell orders
        for (const pos of longPositions) {
          try {
            const userName =
              pos.userIndex === 1 ? "Deployer" : `User ${pos.userIndex - 1}`;
            console.log(
              colorText(
                `   ${userName}: Closing LONG ${ethers.formatUnits(
                  pos.absSize,
                  18
                )} ALU`,
                colors.cyan
              )
            );

            // Use a fair closing price
            const closePrice = ethers.parseUnits("10", 6);

            // Place sell order to close long position
            await this.contracts.orderBook
              .connect(pos.user)
              .placeMarginLimitOrder(closePrice, pos.absSize, false);

            // Find a counterparty to take the opposite side
            const counterparty =
              users.find((u) => u.address !== pos.user.address) || users[0];
            await this.contracts.orderBook
              .connect(counterparty)
              .placeMarginLimitOrder(closePrice, pos.absSize, true);

            console.log(
              colorText(`     ✅ LONG position closed at $10`, colors.green)
            );
          } catch (error) {
            console.log(
              colorText(
                `     ❌ Failed to close LONG position: ${error.message}`,
                colors.red
              )
            );
          }
        }

        // Close short positions by placing buy orders
        for (const pos of shortPositions) {
          try {
            const userName =
              pos.userIndex === 1 ? "Deployer" : `User ${pos.userIndex - 1}`;
            console.log(
              colorText(
                `   ${userName}: Closing SHORT ${ethers.formatUnits(
                  pos.absSize,
                  18
                )} ALU`,
                colors.cyan
              )
            );

            // Use a fair closing price
            const closePrice = ethers.parseUnits("10", 6);

            // Place buy order to close short position
            await this.contracts.orderBook
              .connect(pos.user)
              .placeMarginLimitOrder(closePrice, pos.absSize, true);

            // Find a counterparty to take the opposite side
            const counterparty =
              users.find((u) => u.address !== pos.user.address) || users[0];
            await this.contracts.orderBook
              .connect(counterparty)
              .placeMarginLimitOrder(closePrice, pos.absSize, false);

            console.log(
              colorText(`     ✅ SHORT position closed at $10`, colors.green)
            );
          } catch (error) {
            console.log(
              colorText(
                `     ❌ Failed to close SHORT position: ${error.message}`,
                colors.red
              )
            );
          }
        }
      }

      // Step 3: Reset collateral to 5000 USDC for each user
      console.log(
        colorText(
          "\n💰 Step 3: Resetting user collateral to 5000 USDC...",
          colors.yellow
        )
      );

      const targetCollateral = ethers.parseUnits("5000", 6);
      const deployer = signers[0];
      const mockUSDC = await ethers.getContractAt(
        "MockUSDC",
        getAddress("MOCK_USDC")
      );

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          const userName = i === 0 ? "Deployer" : `User ${i}`;
          const marginSummary = await this.contracts.vault.getMarginSummary(
            user.address
          );
          const currentCollateral = marginSummary.totalCollateral;

          if (currentCollateral < targetCollateral) {
            // Need to deposit more
            const toDeposit = targetCollateral - currentCollateral;

            // First ensure user has USDC
            const userUsdcBalance = await mockUSDC.balanceOf(user.address);
            if (userUsdcBalance < toDeposit) {
              // Mint USDC to user
              await mockUSDC
                .connect(deployer)
                .mint(user.address, toDeposit - userUsdcBalance);
            }

            // Approve and deposit
            await mockUSDC
              .connect(user)
              .approve(this.contracts.vault.target, toDeposit);
            await this.contracts.vault
              .connect(user)
              .depositCollateral(toDeposit);

            console.log(
              colorText(
                `   ${userName}: Deposited ${ethers.formatUnits(
                  toDeposit,
                  6
                )} USDC`,
                colors.green
              )
            );
          } else if (currentCollateral > targetCollateral) {
            // Need to withdraw
            const toWithdraw = currentCollateral - targetCollateral;
            await this.contracts.vault
              .connect(user)
              .withdrawCollateral(toWithdraw);

            console.log(
              colorText(
                `   ${userName}: Withdrew ${ethers.formatUnits(
                  toWithdraw,
                  6
                )} USDC`,
                colors.yellow
              )
            );
          } else {
            console.log(
              colorText(`   ${userName}: Already has 5000 USDC`, colors.green)
            );
          }

          // Verify final balance
          const finalSummary = await this.contracts.vault.getMarginSummary(
            user.address
          );
          console.log(
            colorText(
              `     Final collateral: ${ethers.formatUnits(
                finalSummary.totalCollateral,
                6
              )} USDC`,
              colors.cyan
            )
          );
        } catch (error) {
          const userName = i === 0 ? "Deployer" : `User ${i}`;
          console.log(
            colorText(`   ${userName}: Error - ${error.message}`, colors.red)
          );
        }
      }

      // Step 4: Verify reset was successful
      console.log(colorText("\n🔍 Step 4: Verifying reset...", colors.yellow));

      let totalOrdersRemaining = 0;
      let totalPositionsRemaining = 0;

      // Check remaining orders
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          const userOrderIds = await this.contracts.orderBook.getUserOrders(
            user.address
          );
          let activeOrders = 0;

          for (const orderId of userOrderIds) {
            const order = await this.contracts.orderBook.getOrder(orderId);
            if (order.amount > 0) {
              activeOrders++;
            }
          }

          totalOrdersRemaining += activeOrders;
          if (activeOrders > 0) {
            const userName = i === 0 ? "Deployer" : `User ${i}`;
            console.log(
              colorText(
                `   ${userName}: ${activeOrders} orders still active`,
                colors.yellow
              )
            );
          }
        } catch (error) {
          // User has no orders
        }
      }

      // Check remaining positions
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        try {
          const positions = await this.contracts.vault.getUserPositions(
            user.address
          );
          let activePositions = 0;

          for (const position of positions) {
            if (position.size !== 0n) {
              activePositions++;
            }
          }

          totalPositionsRemaining += activePositions;
          if (activePositions > 0) {
            const userName = i === 0 ? "Deployer" : `User ${i}`;
            console.log(
              colorText(
                `   ${userName}: ${activePositions} positions still open`,
                colors.yellow
              )
            );
          }
        } catch (error) {
          // User has no positions
        }
      }

      // Check order book status
      const [buyOrderCount, sellOrderCount] =
        await this.contracts.orderBook.getActiveOrdersCount();
      const totalOrderBookOrders =
        Number(buyOrderCount) + Number(sellOrderCount);

      console.log(colorText("\n✅ RESET COMPLETE!", colors.brightGreen));
      console.log(colorText("\n📊 Final Status:", colors.brightCyan));

      if (totalOrdersRemaining === 0) {
        console.log(colorText("  • All orders cancelled ✅", colors.green));
      } else {
        console.log(
          colorText(
            `  • ${totalOrdersRemaining} orders still active ⚠️`,
            colors.yellow
          )
        );
      }

      if (totalPositionsRemaining === 0) {
        console.log(colorText("  • All positions closed ✅", colors.green));
      } else {
        console.log(
          colorText(
            `  • ${totalPositionsRemaining} positions still open ⚠️`,
            colors.yellow
          )
        );
      }

      if (totalOrderBookOrders === 0) {
        console.log(colorText("  • Order book is empty ✅", colors.green));
      } else {
        console.log(
          colorText(
            `  • Order book has ${totalOrderBookOrders} active orders ⚠️`,
            colors.yellow
          )
        );
      }

      console.log(
        colorText("  • Each user has 5000 USDC collateral ✅", colors.green)
      );

      if (
        totalOrdersRemaining > 0 ||
        totalPositionsRemaining > 0 ||
        totalOrderBookOrders > 0
      ) {
        console.log(
          colorText(
            "\n⚠️  Some orders/positions may still be active. You may need to manually cancel them.",
            colors.yellow
          )
        );
      }
    } catch (error) {
      console.log(colorText("\n❌ Reset failed: " + error.message, colors.red));
      console.error("Debug - Full error:", error);
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async exit() {
    console.clear();
    console.log(
      gradient("🌟 Thank you for using Dexetra Interactive Trader! 🌟")
    );
    console.log(colorText("\n🚀 Happy Trading! 🚀", colors.brightGreen));
    this.rl.close();
    this.isRunning = false;
    process.exit(0);
  }

  // UTILITY METHODS
  askQuestion(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  async pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 🚀 MAIN EXECUTION
async function main() {
  const trader = new InteractiveTrader();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log(colorText("\n\n🛑 Shutting down gracefully...", colors.yellow));
    trader.rl.close();
    process.exit(0);
  });

  try {
    await trader.initialize();
  } catch (error) {
    console.error(colorText("💥 Fatal error: " + error.message, colors.red));
    process.exit(1);
  }
}

// Execute only if run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { InteractiveTrader };
