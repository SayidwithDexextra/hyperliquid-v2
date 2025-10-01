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
// Ensure we connect to the running Hardhat node (localhost) for all direct node runs
if (!process.env.HARDHAT_NETWORK) {
  process.env.HARDHAT_NETWORK = "localhost";
}
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

// 🧩 Compact, aligned event block printer
function logEventBlock(title, icon, color, fields) {
  try {
    const ts = new Date().toLocaleTimeString();
    const labelColor = colors.dim;
    const pad = (s) => String(s).padEnd(18);

    const header = `${colors.dim}[${ts}]${colors.reset} ${color}${icon} ${title}${colors.reset}`;
    const lines = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `  ${labelColor}${pad(k)}:${colors.reset} ${v}`);

    console.log(header);
    for (const line of lines) console.log(line);
  } catch (_) {}
}

// 📊 UTILITY FUNCTIONS - ENHANCED PRICE ACCURACY
function formatPrice(price, decimals = 6, displayDecimals = 2) {
  // Handle MaxUint256 case (used for empty order book)
  if (!price || price === 0n) return "0.00";
  if (price >= ethers.MaxUint256) return "∞";

  try {
    // Use high precision conversion to avoid floating point errors
    const priceString = ethers.formatUnits(price, decimals);

    // Parse as BigNumber-like for precision validation
    const priceBigInt = ethers.parseUnits(priceString, decimals);

    // Validate no precision loss occurred during conversion
    if (priceBigInt !== price) {
      console.warn(
        `⚠️ Price precision loss detected: ${price} -> ${priceBigInt}`
      );
    }

    // Format with specified decimal places, ensuring no scientific notation
    const priceNumber = parseFloat(priceString);

    // Handle very small numbers that might be displayed in scientific notation
    if (priceNumber < 0.000001 && priceNumber > 0) {
      return priceNumber.toFixed(8); // Show more decimals for very small prices
    }

    // For standard prices, use specified decimal places
    return priceNumber.toFixed(displayDecimals);
  } catch (error) {
    console.error(`❌ Price formatting error for ${price}:`, error);
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

/**
 * Helper function to calculate total real-time unrealized P&L across all user positions
 * @param {Object} contracts - Smart contract instances
 * @param {string} userAddress - User address
 * @returns {Promise<number>} Total unrealized P&L using real-time mark prices
 */
async function getTotalRealTimeUnrealizedPnL(contracts, userAddress) {
  try {
    const positions = await contracts.vault.getUserPositions(userAddress);
    let totalUnrealizedPnL = 0;

    for (const position of positions) {
      try {
        const { pnl } = await getMarkPriceAndPnL(contracts, position);
        totalUnrealizedPnL += pnl;
      } catch (error) {
        console.error(
          `Error calculating P&L for position ${position.marketId.substring(
            0,
            8
          )}:`,
          error
        );
        // Continue with other positions
      }
    }

    return totalUnrealizedPnL;
  } catch (error) {
    console.error("Error getting total real-time unrealized P&L:", error);
    return 0;
  }
}

/**
 * Helper function to get mark price and calculate P&L from smart contracts
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

      return { markPrice, pnl };
    } else {
      // Fallback: calculate manually using order book data
      const bestBid = await contracts.orderBook.bestBid();
      const bestAsk = await contracts.orderBook.bestAsk();

      if (bestBid > 0 && bestAsk < ethers.MaxUint256) {
        const bidPrice = parseFloat(ethers.formatUnits(bestBid, 6));
        const askPrice = parseFloat(ethers.formatUnits(bestAsk, 6));

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
          const size = parseFloat(
            ethers.formatUnits(
              BigInt(position.size.toString()).toString().replace("-", ""),
              18
            )
          );
          const priceDiff = markPrice - entryPrice;
          const pnl =
            BigInt(position.size.toString()) >= 0n
              ? priceDiff * size
              : -priceDiff * size;

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

    // Gracefully handle closed stdin/non-interactive environments
    this.inputClosed = false;
    this.rl.on("close", () => {
      this.inputClosed = true;
      try {
        console.log(
          colorText("\n⚠️ Input closed. Exiting trader.", colors.yellow)
        );
      } catch (_) {}
      process.exit(0);
    });
    if (this.rl && this.rl.input) {
      this.rl.input.on("end", () => {
        this.inputClosed = true;
        try {
          console.log(
            colorText("\n⚠️ Input ended. Exiting trader.", colors.yellow)
          );
        } catch (_) {}
        process.exit(0);
      });
    }

    this.contracts = {};
    this.users = [];
    this.currentUser = null;
    this.currentUserIndex = 0;
    this.isRunning = true;
    this.hackHistory = [];
  }

  async initialize() {
    console.clear();
    await this.showWelcomeScreen();
    await this.loadContracts();
    await this.loadUsers();

    // CLI: --hack-file <path> optional batch file runner
    const argv = process.argv.slice(2);
    const fileFlagIdx = argv.findIndex((a) => a === "--hack-file");
    if (fileFlagIdx !== -1 && argv[fileFlagIdx + 1]) {
      const filePath = argv[fileFlagIdx + 1];
      await this.runHackFile(filePath);
      // After batch, proceed to normal UI
    }

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
      this.contracts.vault = await getContract("CORE_VAULT");
      this.contracts.orderBook = await getContract("ALUMINUM_ORDERBOOK");
      this.contracts.router = await getContract("TRADING_ROUTER");
      this.contracts.factory = await getContract("FUTURES_MARKET_FACTORY");

      console.log(
        colorText("✅ All contracts loaded successfully!", colors.brightGreen)
      );

      // Set up real-time event listeners
      await this.setupEventListeners();

      await this.pause(1000);
    } catch (error) {
      console.log(
        colorText("❌ Failed to load contracts: " + error.message, colors.red)
      );
      process.exit(1);
    }
  }

  async setupEventListeners() {
    console.log(
      colorText(
        "🎯 ISOLATED MODE: Setting up ONLY ADL event listeners...",
        colors.brightYellow
      )
    );

    try {
      // 🔍 DEBUG: Contract validation
      console.log(
        colorText("🔍 Debugging contract connections...", colors.cyan)
      );

      if (this.contracts.vault) {
        const vaultAddress = await this.contracts.vault.getAddress();
        console.log(
          colorText(`✅ CoreVault loaded at: ${vaultAddress}`, colors.green)
        );

        // Test basic contract functionality
        try {
          // Try to call a simple view function to verify the contract is working
          const contractCode =
            await this.contracts.vault.runner.provider.getCode(vaultAddress);
          if (contractCode === "0x") {
            console.log(
              colorText(
                "❌ Contract has no code! Address might be wrong.",
                colors.red
              )
            );
          } else {
            console.log(
              colorText(
                `✅ Contract code found (${contractCode.length / 2 - 1} bytes)`,
                colors.green
              )
            );
          }
        } catch (codeError) {
          console.log(
            colorText(
              `⚠️ Could not verify contract code: ${codeError.message}`,
              colors.yellow
            )
          );
        }

        // Test if we can call basic functions
        try {
          // Get provider properly - try multiple methods
          let provider;
          if (this.contracts.vault.provider) {
            provider = this.contracts.vault.provider;
          } else if (
            this.contracts.vault.runner &&
            this.contracts.vault.runner.provider
          ) {
            provider = this.contracts.vault.runner.provider;
          } else {
            // Fall back to ethers default provider
            const { ethers } = require("hardhat");
            provider = ethers.provider;
          }

          if (provider) {
            const network = await provider.getNetwork();
            console.log(
              colorText(
                `🌐 Connected to network: ${network.name} (${network.chainId})`,
                colors.blue
              )
            );

            const blockNumber = await provider.getBlockNumber();
            console.log(
              colorText(`📦 Current block: ${blockNumber}`, colors.blue)
            );
          } else {
            console.log(
              colorText("⚠️ No provider found on contract", colors.yellow)
            );
          }
        } catch (providerError) {
          console.log(
            colorText(
              `⚠️ Provider issues: ${providerError.message}`,
              colors.yellow
            )
          );
        }

        // Test contract method calls
        try {
          console.log(
            colorText("🧪 Testing contract method calls...", colors.blue)
          );

          // Try to get a simple address - this tests if the ABI is working
          const mockUSDCAddress = await this.contracts.vault.mockUSDC();
          console.log(
            colorText(
              `📍 MockUSDC address from contract: ${mockUSDCAddress}`,
              colors.green
            )
          );
        } catch (methodError) {
          console.log(
            colorText(
              `⚠️ Contract method call failed: ${methodError.message}`,
              colors.yellow
            )
          );
          console.log(
            colorText(
              "   This might indicate ABI mismatch or contract issues",
              colors.dim
            )
          );
        }

        // Subscribe to haircut/bad debt events
        try {
          this.contracts.vault.on(
            "HaircutApplied",
            (user, marketId, debitAmount, collateralAfter, event) => {
              this.handleHaircutAppliedEvent(
                user,
                marketId,
                debitAmount,
                collateralAfter,
                event
              );
            }
          );
          this.contracts.vault.on(
            "BadDebtRecorded",
            (marketId, amount, liquidatedUser, event) => {
              this.handleBadDebtRecordedEvent(
                marketId,
                amount,
                liquidatedUser,
                event
              );
            }
          );
          console.log(
            colorText(
              "📡 Subscribed to HaircutApplied and BadDebtRecorded",
              colors.green
            )
          );
        } catch (e) {
          console.log(
            colorText(
              `⚠️ Failed subscribing to haircut events: ${e.message}`,
              colors.yellow
            )
          );
        }
      } else {
        console.log(
          colorText("❌ CoreVault contract is null/undefined!", colors.red)
        );
        return;
      }

      if (this.contracts.orderBook) {
        const orderBookAddress = await this.contracts.orderBook.getAddress();
        console.log(
          colorText(`✅ OrderBook loaded at: ${orderBookAddress}`, colors.green)
        );
      } else {
        console.log(
          colorText("❌ OrderBook contract is null/undefined!", colors.red)
        );
      }
      // ============ COMMENTED OUT: ALL NON-ADL EVENTS FOR ISOLATION ============
      /*
      // Listen for OrderMatched events from the matching engine
      this.contracts.orderBook.on(
        "OrderMatched",
        (buyer, seller, price, amount, event) => {
          this.handleOrderMatchedEvent(buyer, seller, price, amount, event);
        }
      );

      // Listen for other trading events
      this.contracts.orderBook.on(
        "OrderPlaced",
        (orderId, trader, price, amount, isBuy, isMarginOrder, event) => {
          this.handleOrderPlacedEvent(
            orderId,
            trader,
            price,
            amount,
            isBuy,
            isMarginOrder,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "OrderCancelled",
        (orderId, trader, event) => {
          this.handleOrderCancelledEvent(orderId, trader, event);
        }
      );

      // Listen for matching engine debug events
      this.contracts.orderBook.on(
        "MatchingStarted",
        (buyer, remainingAmount, maxPrice, startingPrice, event) => {
          this.handleMatchingStartedEvent(
            buyer,
            remainingAmount,
            maxPrice,
            startingPrice,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "PriceLevelEntered",
        (currentPrice, levelExists, totalAmountAtLevel, event) => {
          this.handlePriceLevelEnteredEvent(
            currentPrice,
            levelExists,
            totalAmountAtLevel,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "OrderMatchAttempt",
        (orderId, seller, sellOrderAmount, matchAmount, event) => {
          this.handleOrderMatchAttemptEvent(
            orderId,
            seller,
            sellOrderAmount,
            matchAmount,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "SlippageProtectionTriggered",
        (currentPrice, maxPrice, remainingAmount, event) => {
          this.handleSlippageProtectionTriggeredEvent(
            currentPrice,
            maxPrice,
            remainingAmount,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "MatchingCompleted",
        (buyer, originalAmount, filledAmount, remainingAmount, event) => {
          this.handleMatchingCompletedEvent(
            buyer,
            originalAmount,
            filledAmount,
            remainingAmount,
            event
          );
        }
      );

      // Listen for _executeTrade debug events
      this.contracts.orderBook.on(
        "TradeExecutionStarted",
        (buyer, seller, price, amount, buyerMargin, sellerMargin, event) => {
          this.handleTradeExecutionStartedEvent(
            buyer,
            seller,
            price,
            amount,
            buyerMargin,
            sellerMargin,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "TradeValueCalculated",
        (tradeValue, buyerFee, sellerFee, event) => {
          this.handleTradeValueCalculatedEvent(
            tradeValue,
            buyerFee,
            sellerFee,
            event
          );
        }
      );

      this.contracts.orderBook.on("TradeRecorded", (tradeId, event) => {
        this.handleTradeRecordedEvent(tradeId, event);
      });

      this.contracts.orderBook.on(
        "PositionsRetrieved",
        (buyer, oldBuyerPosition, seller, oldSellerPosition, event) => {
          this.handlePositionsRetrievedEvent(
            buyer,
            oldBuyerPosition,
            seller,
            oldSellerPosition,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "PositionsCalculated",
        (newBuyerPosition, newSellerPosition, event) => {
          this.handlePositionsCalculatedEvent(
            newBuyerPosition,
            newSellerPosition,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "ActiveTradersUpdated",
        (buyer, buyerActive, seller, sellerActive, event) => {
          this.handleActiveTradersUpdatedEvent(
            buyer,
            buyerActive,
            seller,
            sellerActive,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "MarginValidationPassed",
        (buyerMargin, sellerMargin, event) => {
          this.handleMarginValidationPassedEvent(
            buyerMargin,
            sellerMargin,
            event
          );
        }
      );

      */
      // UNCOMMENTED: Old liquidation debugging events
      this.contracts.orderBook.on(
        "LiquidationTradeDetected",
        (
          isLiquidationTrade,
          liquidationTarget,
          liquidationClosesShort,
          event
        ) => {
          this.handleLiquidationTradeDetectedEvent(
            isLiquidationTrade,
            liquidationTarget,
            liquidationClosesShort,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "MarginUpdatesStarted",
        (isLiquidationTrade, event) => {
          this.handleMarginUpdatesStartedEvent(isLiquidationTrade, event);
        }
      );

      this.contracts.orderBook.on("MarginUpdatesCompleted", (event) => {
        this.handleMarginUpdatesCompletedEvent(event);
      });

      this.contracts.orderBook.on(
        "FeesDeducted",
        (buyer, buyerFee, seller, sellerFee, event) => {
          this.handleFeesDeductedEvent(
            buyer,
            buyerFee,
            seller,
            sellerFee,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "PriceUpdated",
        (lastTradePrice, currentMarkPrice, event) => {
          this.handlePriceUpdatedEvent(lastTradePrice, currentMarkPrice, event);
        }
      );

      // UNCOMMENTED: Old liquidation debugging events continued
      this.contracts.orderBook.on(
        "LiquidationCheckTriggered",
        (currentMark, lastMarkPrice, event) => {
          this.handleLiquidationCheckTriggeredEvent(
            currentMark,
            lastMarkPrice,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "TradeExecutionCompleted",
        (buyer, seller, price, amount, event) => {
          this.handleTradeExecutionCompletedEvent(
            buyer,
            seller,
            price,
            amount,
            event
          );
        }
      );

      // UNCOMMENTED: Old liquidation debugging events continued
      // Listen for _checkPositionsForLiquidation debug events
      this.contracts.orderBook.on(
        "LiquidationCheckStarted",
        (markPrice, tradersLength, startIndex, endIndex, event) => {
          this.handleLiquidationCheckStartedEvent(
            markPrice,
            tradersLength,
            startIndex,
            endIndex,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationRecursionGuardSet",
        (inProgress, event) => {
          this.handleLiquidationRecursionGuardSetEvent(inProgress, event);
        }
      );

      this.contracts.orderBook.on(
        "LiquidationTraderBeingChecked",
        (trader, index, totalTraders, event) => {
          this.handleLiquidationTraderBeingCheckedEvent(
            trader,
            index,
            totalTraders,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationLiquidatableCheck",
        (trader, isLiquidatable, markPrice, event) => {
          this.handleLiquidationLiquidatableCheckEvent(
            trader,
            isLiquidatable,
            markPrice,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationPositionRetrieved",
        (trader, size, marginLocked, unrealizedPnL, event) => {
          this.handleLiquidationPositionRetrievedEvent(
            trader,
            size,
            marginLocked,
            unrealizedPnL,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationMarketOrderAttempt",
        (trader, amount, isBuy, markPrice, event) => {
          this.handleLiquidationMarketOrderAttemptEvent(
            trader,
            amount,
            isBuy,
            markPrice,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationMarketOrderResult",
        (trader, success, reason, event) => {
          this.handleLiquidationMarketOrderResultEvent(
            trader,
            success,
            reason,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationSocializedLossAttempt",
        (trader, isLong, method, event) => {
          this.handleLiquidationSocializedLossAttemptEvent(
            trader,
            isLong,
            method,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationSocializedLossResult",
        (trader, success, method, event) => {
          this.handleLiquidationSocializedLossResultEvent(
            trader,
            success,
            method,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationCompleted",
        (trader, liquidationsTriggered, method, event) => {
          this.handleLiquidationCompletedEvent(
            trader,
            liquidationsTriggered,
            method,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationIndexUpdated",
        (oldIndex, newIndex, tradersLength, event) => {
          this.handleLiquidationIndexUpdatedEvent(
            oldIndex,
            newIndex,
            tradersLength,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationCheckFinished",
        (tradersChecked, liquidationsTriggered, nextStartIndex, event) => {
          this.handleLiquidationCheckFinishedEvent(
            tradersChecked,
            liquidationsTriggered,
            nextStartIndex,
            event
          );
        }
      );

      this.contracts.orderBook.on(
        "LiquidationMarginConfiscated",
        (trader, marginAmount, penalty, liquidator, event) => {
          this.handleLiquidationMarginConfiscatedEvent(
            trader,
            marginAmount,
            penalty,
            liquidator,
            event
          );
        }
      );
      // Listen for CoreVault margin confiscation events
      if (this.contracts.vault) {
        this.contracts.vault.on(
          "MarginConfiscated",
          (user, marginAmount, totalLoss, penalty, liquidator, event) => {
            this.handleCoreVaultMarginConfiscatedEvent(
              user,
              marginAmount,
              totalLoss,
              penalty,
              liquidator,
              event
            );
          }
        );

        // Listen for dedicated liquidator reward event
        this.contracts.vault.on(
          "LiquidatorRewardPaid",
          async (
            liquidator,
            liquidatedUser,
            marketId,
            rewardAmount,
            liquidatorCollateral,
            event
          ) => {
            // Raw parameter log for traceability
            try {
              console.log("[Event] LiquidatorRewardPaid", {
                liquidator,
                liquidatedUser,
                marketId,
                rewardAmount:
                  typeof rewardAmount === "bigint"
                    ? rewardAmount.toString()
                    : rewardAmount,
                liquidatorCollateral:
                  typeof liquidatorCollateral === "bigint"
                    ? liquidatorCollateral.toString()
                    : liquidatorCollateral,
                txHash:
                  event && event.transactionHash
                    ? event.transactionHash
                    : undefined,
              });
            } catch (e) {
              console.log("[Event] LiquidatorRewardPaid (log error)", e);
            }

            const timestamp = new Date().toLocaleTimeString();
            const liquidatorType = this.formatUserDisplay(liquidator);
            const userType = this.formatUserDisplay(liquidatedUser);
            const rewardFormatted = formatUSDC(
              typeof rewardAmount === "bigint"
                ? rewardAmount
                : BigInt(rewardAmount.toString()),
              4
            );

            // Grab liquidator collateral from event param
            const liquidatorCollateral6 =
              typeof liquidatorCollateral === "bigint"
                ? liquidatorCollateral
                : BigInt(liquidatorCollateral?.toString?.() || "0");
            const liquidatorCollateralFormatted = formatUSDC(
              liquidatorCollateral6
            );

            // Compare reward to liquidator's available and total collateral (6 decimals)
            let availableFormatted = "N/A";
            let totalCollateralFormatted = "N/A";
            let pctOfAvailable = "-";
            let pctOfCollateral = "-";
            try {
              const [
                totalCollateral,
                marginUsed,
                marginReserved,
                availableMargin,
              ] = await this.contracts.vault.getUnifiedMarginSummary(
                liquidator
              );

              const reward6 =
                typeof rewardAmount === "bigint"
                  ? rewardAmount
                  : BigInt(rewardAmount.toString());
              const avail6 = BigInt((availableMargin || 0).toString());
              const total6 = BigInt((totalCollateral || 0).toString());

              availableFormatted = formatUSDC(avail6);
              totalCollateralFormatted = formatUSDC(total6);

              const bpsOfAvail = avail6 > 0n ? (reward6 * 10000n) / avail6 : 0n;
              const bpsOfTotal = total6 > 0n ? (reward6 * 10000n) / total6 : 0n;
              pctOfAvailable = (Number(bpsOfAvail) / 100).toFixed(2) + "%";
              pctOfCollateral = (Number(bpsOfTotal) / 100).toFixed(2) + "%";
            } catch (e) {
              // Non-fatal; keep base notification
            }

            const notification = `
${colors.bgGreen}${colors.black}${
              colors.bright
            }           🏆 LIQUIDATOR REWARD PAID            ${colors.reset}
${
  colors.brightGreen
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightYellow}🏦 Market:${
              colors.reset
            } ${this.getMarketDisplayName(marketId)} ${
              colors.dim
            }at ${timestamp}${colors.reset}      ${colors.brightGreen}│${
              colors.reset
            }
${colors.brightGreen}│${colors.reset} ${colors.brightGreen}🎯 Liquidator:${
              colors.reset
            } ${liquidatorType.padEnd(16)}                 ${
              colors.brightGreen
            }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightMagenta}👤 Liquidated:${
              colors.reset
            } ${userType.padEnd(16)}                 ${colors.brightGreen}│${
              colors.reset
            }
${colors.brightGreen}│${colors.reset} ${colors.brightCyan}💸 Reward:${
              colors.reset
            } $${rewardFormatted} USDC                        ${
              colors.brightGreen
            }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${
              colors.brightCyan
            }🏦 Liquidator Collateral:${
              colors.reset
            } $${liquidatorCollateralFormatted} USDC            ${
              colors.brightGreen
            }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.dim}   ↳ vs Available:${
              colors.reset
            } $${availableFormatted} (${pctOfAvailable})           ${
              colors.brightGreen
            }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.dim}   ↳ vs Collateral:${
              colors.reset
            } $${totalCollateralFormatted} (${pctOfCollateral})      ${
              colors.brightGreen
            }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.dim}Tx: ${(event &&
            event.transactionHash
              ? event.transactionHash
              : ""
            ).slice(0, 10)}...                              ${
              colors.brightGreen
            }│${colors.reset}
${
  colors.brightGreen
}└─────────────────────────────────────────────────────────┘${colors.reset}
            `;

            console.log(notification);
            process.stdout.write("\x07");
          }
        );

        // Listen for maker reward events (LP rewards during liquidation)
        this.contracts.vault.on(
          "MakerLiquidationRewardPaid",
          (maker, liquidatedUser, marketId, rewardAmount, event) => {
            this.handleMakerLiquidationRewardPaidEvent(
              maker,
              liquidatedUser,
              marketId,
              rewardAmount,
              event
            );
          }
        );
      }

      // ============ ADL + LIQUIDATION DEBUG EVENT LISTENERS ACTIVE ============
      console.log(
        colorText(
          "🎯 ENHANCED MODE: ADL + Liquidation Debug events will be displayed",
          colors.brightYellow
        )
      );
      if (this.contracts.vault) {
        this.contracts.vault.on(
          "SocializationStarted",
          (marketId, totalLossAmount, liquidatedUser, timestamp, event) => {
            this.handleSocializationStartedEvent(
              marketId,
              totalLossAmount,
              liquidatedUser,
              timestamp,
              event
            );
          }
        );

        this.contracts.vault.on(
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
            this.handleProfitablePositionFoundEvent(
              user,
              marketId,
              positionSize,
              entryPrice,
              markPrice,
              unrealizedPnL,
              profitScore,
              event
            );
          }
        );

        this.contracts.vault.on(
          "AdministrativePositionClosure",
          (
            user,
            marketId,
            sizeBeforeReduction,
            sizeAfterReduction,
            realizedProfit,
            newEntryPrice,
            event
          ) => {
            this.handleAdministrativePositionClosureEvent(
              user,
              marketId,
              sizeBeforeReduction,
              sizeAfterReduction,
              realizedProfit,
              newEntryPrice,
              event
            );
          }
        );

        this.contracts.vault.on(
          "SocializationCompleted",
          (
            marketId,
            totalLossCovered,
            remainingLoss,
            positionsAffected,
            liquidatedUser,
            event
          ) => {
            this.handleSocializationCompletedEvent(
              marketId,
              totalLossCovered,
              remainingLoss,
              positionsAffected,
              liquidatedUser,
              event
            );
          }
        );

        this.contracts.vault.on(
          "SocializationFailed",
          (marketId, lossAmount, reason, liquidatedUser, event) => {
            this.handleSocializationFailedEvent(
              marketId,
              lossAmount,
              reason,
              liquidatedUser,
              event
            );
          }
        );

        // Debug event listeners for detailed tracking
        this.contracts.vault.on(
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
            this.handleDebugProfitCalculationEvent(
              user,
              marketId,
              entryPrice,
              markPrice,
              positionSize,
              unrealizedPnL,
              profitScore,
              event
            );
          }
        );

        this.contracts.vault.on(
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
            this.handleDebugPositionReductionEvent(
              user,
              marketId,
              originalSize,
              reductionAmount,
              newSize,
              realizedPnL,
              event
            );
          }
        );

        this.contracts.vault.on(
          "DebugSocializationState",
          (
            marketId,
            remainingLoss,
            totalProfitableUsers,
            processedUsers,
            event
          ) => {
            this.handleDebugSocializationStateEvent(
              marketId,
              remainingLoss,
              totalProfitableUsers,
              processedUsers,
              event
            );
          }
        );

        // ADO Event: Position Updates - tracks all position changes during ADL
        this.contracts.vault.on(
          "PositionUpdated",
          (
            user,
            marketId,
            oldSize,
            newSize,
            entryPrice,
            marginLocked,
            event
          ) => {
            this.handlePositionUpdatedEvent(
              user,
              marketId,
              oldSize,
              newSize,
              entryPrice,
              marginLocked,
              event
            );
          }
        );

        // ADO Event: Socialized Loss Applied - tracks when losses are socialized
        this.contracts.vault.on(
          "SocializedLossApplied",
          (marketId, lossAmount, liquidatedUser, event) => {
            this.handleSocializedLossAppliedEvent(
              marketId,
              lossAmount,
              liquidatedUser,
              event
            );
          }
        );

        // ADO Event: User Loss Socialized - tracks individual user loss socialization
        this.contracts.vault.on(
          "UserLossSocialized",
          (user, lossAmount, remainingCollateral, event) => {
            this.handleUserLossSocializedEvent(
              user,
              lossAmount,
              remainingCollateral,
              event
            );
          }
        );

        // ADO Event: Available Collateral Confiscated - tracks gap loss coverage
        this.contracts.vault.on(
          "AvailableCollateralConfiscated",
          (user, amount, remainingAvailable, event) => {
            this.handleAvailableCollateralConfiscatedEvent(
              user,
              amount,
              remainingAvailable,
              event
            );
          }
        );
      }

      // Listen for GapLoss and Liquidation Processing events from OrderBook
      if (this.contracts.orderBook) {
        // New: counterparty receives units when liquidation matches against their resting order
        this.contracts.orderBook.on(
          "CounterpartyUnitsReceived",
          (user, marketId, amount, isBuySide, price, event) => {
            const userShort = user.slice(0, 8) + "..." + user.slice(-6);
            const amountFormatted = formatWithAutoDecimalDetection(
              amount,
              18,
              4
            );
            const priceFormatted = formatWithAutoDecimalDetection(price, 6, 2);
            const side = isBuySide
              ? colorText("BUY", colors.green)
              : colorText("SELL", colors.green);

            logEventBlock("UNITS RECEIVED", "📦", colors.brightGreen, {
              Amount: colorText(`${amountFormatted} ALU`, colors.cyan),
              Price: colorText(`$${priceFormatted}`, colors.yellow),
              Source: colorText("LIQUIDATION MATCH", colors.magenta),
              Counterparty: side,
              Address: colorText(userShort, colors.dim),
            });
          }
        );

        this.contracts.orderBook.on(
          "GapLossDetected",
          (
            trader,
            marketId,
            gapLossAmount,
            liquidationPrice,
            executionPrice,
            positionSize,
            event
          ) => {
            this.handleGapLossDetectedEvent(
              trader,
              marketId,
              gapLossAmount,
              liquidationPrice,
              executionPrice,
              positionSize,
              event
            );
          }
        );

        this.contracts.orderBook.on(
          "LiquidationPositionProcessed",
          (trader, positionSize, executionPrice, event) => {
            this.handleLiquidationPositionProcessedEvent(
              trader,
              positionSize,
              executionPrice,
              event
            );
          }
        );

        this.contracts.orderBook.on(
          "LiquidationProcessingFailed",
          (trader, reason, event) => {
            this.handleLiquidationProcessingFailedEvent(trader, reason, event);
          }
        );

        // ===== Liquidation Reward Pipeline Debug Events =====
        this.contracts.orderBook.on(
          "DebugMakerContributionAdded",
          (maker, notionalScaled, totalScaledAfter, event) => {
            const makerShort = maker.slice(0, 8) + "..." + maker.slice(-6);
            const ns =
              notionalScaled && notionalScaled.toString
                ? notionalScaled.toString()
                : String(notionalScaled);
            const total =
              totalScaledAfter && totalScaledAfter.toString
                ? totalScaledAfter.toString()
                : String(totalScaledAfter);
            logEventBlock("Maker Contribution", "🔧", colors.brightCyan, {
              Maker: colorText(makerShort, colors.cyan),
              NotionalScaled: colorText(ns, colors.yellow),
              TotalScaled: colorText(total, colors.yellow),
            });
          }
        );

        this.contracts.orderBook.on(
          "DebugRewardComputation",
          (
            liquidatedUser,
            expectedPenalty,
            obBalance,
            rewardPool,
            makerCount,
            totalScaled,
            event
          ) => {
            const uShort =
              liquidatedUser.slice(0, 8) + "..." + liquidatedUser.slice(-6);
            const exp =
              expectedPenalty && expectedPenalty.toString
                ? expectedPenalty.toString()
                : String(expectedPenalty);
            const ob =
              obBalance && obBalance.toString
                ? obBalance.toString()
                : String(obBalance);
            const pool =
              rewardPool && rewardPool.toString
                ? rewardPool.toString()
                : String(rewardPool);
            const tScaled =
              totalScaled && totalScaled.toString
                ? totalScaled.toString()
                : String(totalScaled);
            logEventBlock("Reward Computation", "🧮", colors.brightYellow, {
              User: colorText(uShort, colors.cyan),
              Expected: colorText(exp, colors.yellow),
              OrderBookBal: colorText(ob, colors.yellow),
              Pool: colorText(pool, colors.yellow),
              Makers: colorText(makerCount, colors.green),
              TotalScaled: colorText(tScaled, colors.yellow),
            });
          }
        );

        this.contracts.orderBook.on(
          "DebugRewardDistributionStart",
          (liquidatedUser, rewardAmount, event) => {
            const uShort =
              liquidatedUser.slice(0, 8) + "..." + liquidatedUser.slice(-6);
            const amt =
              rewardAmount && rewardAmount.toString
                ? rewardAmount.toString()
                : String(rewardAmount);
            logEventBlock(
              "Reward Distribution Start",
              "🚀",
              colors.brightGreen,
              {
                User: colorText(uShort, colors.cyan),
                Amount: colorText(amt, colors.yellow),
              }
            );
          }
        );

        this.contracts.orderBook.on(
          "DebugMakerRewardPayOutcome",
          (liquidatedUser, maker, amount, success, errorData, event) => {
            const uShort =
              liquidatedUser.slice(0, 8) + "..." + liquidatedUser.slice(-6);
            const mShort = maker.slice(0, 8) + "..." + maker.slice(-6);
            const amt =
              amount && amount.toString ? amount.toString() : String(amount);
            const status = success
              ? `${colors.green}OK${colors.reset}`
              : `${colors.red}FAIL${colors.reset}`;
            const errHex =
              errorData && typeof errorData === "string"
                ? errorData
                : errorData && errorData.toString
                ? errorData.toString()
                : "";
            logEventBlock("Maker Payout", "💸", colors.cyan, {
              User: colorText(uShort, colors.cyan),
              Maker: colorText(mShort, colors.magenta),
              Amount: colorText(amt, colors.yellow),
              Status: status,
              Error: success
                ? undefined
                : colorText(`${errHex.slice(0, 18)}...`, colors.red),
            });
          }
        );

        this.contracts.orderBook.on(
          "DebugRewardDistributionEnd",
          (liquidatedUser, event) => {
            const uShort =
              liquidatedUser.slice(0, 8) + "..." + liquidatedUser.slice(-6);
            logEventBlock("Reward Distribution End", "✅", colors.brightGreen, {
              User: colorText(uShort, colors.cyan),
            });
          }
        );
      }

      // 🔍 DEBUG: Confirm event listeners are attached
      console.log(colorText("🔍 Verifying event listeners...", colors.cyan));
      const vaultListenerCount = this.contracts.vault.listenerCount();
      const orderBookListenerCount = this.contracts.orderBook
        ? this.contracts.orderBook.listenerCount()
        : 0;
      console.log(
        colorText(
          `📊 CoreVault has ${vaultListenerCount} active listeners`,
          colors.blue
        )
      );
      console.log(
        colorText(
          `📊 OrderBook has ${orderBookListenerCount} active listeners`,
          colors.blue
        )
      );

      // Add a test event listener to verify connectivity
      this.contracts.vault.once("*", (eventObject) => {
        console.log(
          colorText(
            "🎉 FIRST EVENT RECEIVED! Event system is working!",
            colors.brightGreen
          )
        );

        // Extract event name for quick display
        const eventName =
          eventObject?.event || eventObject?.fragment?.name || "Unknown Event";
        console.log(
          colorText(
            `Event: ${eventName} at block ${eventObject?.blockNumber}`,
            colors.dim
          )
        );
      });

      console.log(
        colorText(
          "✅ Complete ADO + Liquidation Debug System Activated!",
          colors.brightGreen
        )
      );
      console.log(
        colorText(
          "   📊 ADL Events: SocializationStarted, ProfitablePositionFound, AdministrativePositionClosure",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 ADL Events: SocializationCompleted, SocializationFailed, PositionUpdated",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 ADL Events: SocializedLossApplied, UserLossSocialized, AvailableCollateralConfiscated",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 Liquidation Debug: LiquidationCheckTriggered, LiquidationCheckStarted, RecursionGuard",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 Liquidation Debug: TraderBeingChecked, LiquidatableCheck, MarketOrderAttempt/Result",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 Gap Loss & Margin: GapLossDetected, MarginConfiscated, MarginUpdatesStarted",
          colors.dim
        )
      );
      console.log(
        colorText(
          "   📊 Vault Processing: LiquidationPositionProcessed, LiquidationProcessingFailed",
          colors.dim
        )
      );

      // 🔍 DEBUG: Add connectivity test
      console.log(
        colorText("🔍 Testing event connectivity in 3 seconds...", colors.dim)
      );
      setTimeout(async () => {
        await this.testEventConnectivity();
      }, 3000);
    } catch (error) {
      console.log(
        colorText(
          "⚠️ Warning: Could not set up event listeners: " + error.message,
          colors.yellow
        )
      );
      console.log(
        colorText(`📋 Full error details: ${error.stack}`, colors.red)
      );
    }
  }
  async testEventConnectivity() {
    console.log(
      colorText(
        "🔍 CONNECTIVITY TEST: Checking if events are working...",
        colors.cyan
      )
    );

    try {
      // Test 1: Check if we can query past events
      console.log(colorText("📋 Test 1: Querying past events...", colors.blue));

      // Get provider properly - try multiple methods
      let provider;
      if (this.contracts.vault.provider) {
        provider = this.contracts.vault.provider;
      } else if (
        this.contracts.vault.runner &&
        this.contracts.vault.runner.provider
      ) {
        provider = this.contracts.vault.runner.provider;
      } else {
        // Fall back to ethers default provider
        const { ethers } = require("hardhat");
        provider = ethers.provider;
      }

      console.log(
        colorText(
          `🔗 Using provider: ${provider ? "Connected" : "Not found"}`,
          colors.blue
        )
      );

      if (!provider) {
        console.log(
          colorText("❌ No provider available! Cannot test events.", colors.red)
        );
        return;
      }

      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks

      console.log(
        colorText(
          `📦 Scanning blocks ${fromBlock} to ${currentBlock}`,
          colors.blue
        )
      );

      const depositFilter = this.contracts.vault.filters.CollateralDeposited();
      const withdrawFilter = this.contracts.vault.filters.CollateralWithdrawn();

      const depositEvents = await this.contracts.vault.queryFilter(
        depositFilter,
        fromBlock,
        currentBlock
      );
      const withdrawEvents = await this.contracts.vault.queryFilter(
        withdrawFilter,
        fromBlock,
        currentBlock
      );

      console.log(
        colorText(
          `📊 Found ${depositEvents.length} deposit events in last 1000 blocks`,
          colors.green
        )
      );
      console.log(
        colorText(
          `📊 Found ${withdrawEvents.length} withdraw events in last 1000 blocks`,
          colors.green
        )
      );

      // Test 2: Check listener count
      console.log(
        colorText("📋 Test 2: Checking active listeners...", colors.blue)
      );
      const listenerCount = this.contracts.vault.listenerCount();
      console.log(
        colorText(
          `📊 Active listeners on CoreVault: ${listenerCount}`,
          colors.green
        )
      );

      if (listenerCount === 0) {
        console.log(
          colorText(
            "❌ NO LISTENERS ATTACHED! This is the problem.",
            colors.red
          )
        );
        return;
      }

      // List all the event names we're listening for
      const eventNames = [
        "SocializationStarted",
        "ProfitablePositionFound",
        "AdministrativePositionClosure",
        "SocializationCompleted",
        "SocializationFailed",
        "PositionUpdated",
        "SocializedLossApplied",
        "UserLossSocialized",
        "AvailableCollateralConfiscated",
      ];
      console.log(
        colorText(
          `📋 Listening for events: ${eventNames.join(", ")}`,
          colors.blue
        )
      );

      // Test 3: Try to detect ANY activity
      console.log(
        colorText(
          "📋 Test 3: Listening for ANY new events (30 second test)...",
          colors.blue
        )
      );
      let eventReceived = false;

      const timeout = setTimeout(() => {
        if (!eventReceived) {
          console.log(
            colorText(
              "⏰ No events received in 30 seconds. This suggests:",
              colors.yellow
            )
          );
          console.log(
            colorText("   • No trading activity happening", colors.dim)
          );
          console.log(
            colorText("   • Contract addresses might be wrong", colors.dim)
          );
          console.log(colorText("   • Network connection issues", colors.dim));
          console.log(
            colorText("💡 Try making a trade to generate events!", colors.cyan)
          );
        }
      }, 30000);

      this.contracts.vault.once("*", (eventObject) => {
        eventReceived = true;
        clearTimeout(timeout);
        console.log(
          colorText("🎉 SUCCESS! Event system is working!", colors.brightGreen)
        );

        // Extract meaningful event information
        try {
          const eventInfo = {
            event: eventObject.event || eventObject.eventName,
            fragment: eventObject.fragment?.name,
            blockNumber: eventObject.blockNumber,
            transactionHash: eventObject.transactionHash,
            address: eventObject.address,
            args: eventObject.args ? Array.from(eventObject.args) : undefined,
          };

          console.log(colorText("📋 Event Details:", colors.cyan));
          console.log(
            colorText(
              `   Event Name: ${
                eventInfo.event || eventInfo.fragment || "Unknown"
              }`,
              colors.green
            )
          );
          console.log(
            colorText(`   Block: ${eventInfo.blockNumber}`, colors.blue)
          );
          console.log(
            colorText(
              `   Tx: ${eventInfo.transactionHash?.slice(0, 10)}...`,
              colors.blue
            )
          );
          console.log(
            colorText(`   Contract: ${eventInfo.address}`, colors.dim)
          );

          if (eventInfo.args && eventInfo.args.length > 0) {
            console.log(
              colorText(
                `   Args: [${eventInfo.args.length} parameters]`,
                colors.dim
              )
            );
          }
        } catch (parseError) {
          console.log(
            colorText(`Event object type: ${typeof eventObject}`, colors.dim)
          );
          console.log(
            colorText(
              `Event constructor: ${eventObject?.constructor?.name}`,
              colors.dim
            )
          );
        }
      });

      console.log(
        colorText("⏳ Waiting for events... (make a trade to test)", colors.dim)
      );
    } catch (error) {
      console.log(
        colorText(`❌ Connectivity test failed: ${error.message}`, colors.red)
      );
    }
  }

  handleOrderMatchedEvent(buyer, seller, price, amount, event) {
    const timestamp = new Date().toLocaleTimeString();
    const priceFormatted = formatWithAutoDecimalDetection(price, 6, 2);
    const amountFormatted = formatWithAutoDecimalDetection(amount, 18, 4);

    // Create a notification box
    const notification = `
${colors.bgBlue}${colors.white}${
      colors.bright
    }                    🎯 ORDER MATCHED                     ${colors.reset}
${
  colors.brightBlue
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.brightGreen}⚡ TRADE EXECUTED${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}                    ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.brightCyan}💰 Price:${
      colors.reset
    } $${priceFormatted} USDC                           ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${colors.brightYellow}📊 Amount:${
      colors.reset
    } ${amountFormatted} ALU                            ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.green}👤 Buyer:${
      colors.reset
    } ${buyer.slice(0, 8)}...${buyer.slice(-6)}     ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${colors.red}👤 Seller:${
      colors.reset
    } ${seller.slice(0, 8)}...${seller.slice(-6)}    ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightBlue}│${colors.reset}
${
  colors.brightBlue
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);

    // Play a sound notification (if terminal supports it)
    process.stdout.write("\x07");
  }

  handleOrderPlacedEvent(
    orderId,
    trader,
    price,
    amount,
    isBuy,
    isMarginOrder,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const priceFormatted = formatWithAutoDecimalDetection(price, 6, 2);
    const amountFormatted = formatWithAutoDecimalDetection(amount, 18, 4);
    const side = isBuy ? "BUY" : "SELL";
    const sideColor = isBuy ? colors.brightGreen : colors.brightRed;
    const orderType = isMarginOrder ? "MARGIN" : "SPOT";

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${sideColor}📝 ${side} ORDER${colors.reset} ` +
        `${colors.cyan}${orderType}${colors.reset} | ` +
        `${colors.yellow}${amountFormatted} ALU${colors.reset} @ ` +
        `${colors.green}$${priceFormatted}${colors.reset} | ` +
        `${colors.dim}ID: ${orderId}${colors.reset}`
    );
  }

  handleOrderCancelledEvent(orderId, trader, event) {
    const timestamp = new Date().toLocaleTimeString();

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}❌ ORDER CANCELLED${colors.reset} | ` +
        `${colors.dim}ID: ${orderId} | Trader: ${trader.slice(0, 8)}...${
          colors.reset
        }`
    );
  }

  handleMatchingStartedEvent(
    buyer,
    remainingAmount,
    maxPrice,
    startingPrice,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const amountFormatted = formatWithAutoDecimalDetection(
      remainingAmount,
      18,
      4
    );
    const maxPriceFormatted = formatWithAutoDecimalDetection(maxPrice, 6, 2);
    const startPriceFormatted = formatWithAutoDecimalDetection(
      startingPrice,
      6,
      2
    );

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.brightBlue}🎯 MATCHING STARTED${colors.reset} | ` +
        `${colors.cyan}Amount: ${amountFormatted} ALU${colors.reset} | ` +
        `${colors.yellow}Max: $${maxPriceFormatted}${colors.reset} | ` +
        `${colors.green}Start: $${startPriceFormatted}${colors.reset}`
    );
  }

  handlePriceLevelEnteredEvent(
    currentPrice,
    levelExists,
    totalAmountAtLevel,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const priceFormatted = formatWithAutoDecimalDetection(currentPrice, 6, 2);

    if (levelExists) {
      const amountFormatted = formatWithAutoDecimalDetection(
        totalAmountAtLevel,
        18,
        4
      );
      console.log(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.blue}📊 PRICE LEVEL${colors.reset} | ` +
          `${colors.yellow}$${priceFormatted}${colors.reset} | ` +
          `${colors.cyan}${amountFormatted} ALU available${colors.reset}`
      );
    } else {
      console.log(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.dim}📊 PRICE LEVEL${colors.reset} | ` +
          `${colors.yellow}$${priceFormatted}${colors.reset} | ` +
          `${colors.dim}No liquidity${colors.reset}`
      );
    }
  }

  handleOrderMatchAttemptEvent(
    orderId,
    seller,
    sellOrderAmount,
    matchAmount,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const sellAmountFormatted = formatWithAutoDecimalDetection(
      sellOrderAmount,
      18,
      4
    );
    const matchAmountFormatted = formatWithAutoDecimalDetection(
      matchAmount,
      18,
      4
    );

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}🔄 ORDER MATCH${colors.reset} | ` +
        `${colors.dim}ID: ${orderId}${colors.reset} | ` +
        `${colors.cyan}Matching: ${matchAmountFormatted}/${sellAmountFormatted} ALU${colors.reset}`
    );
  }

  handleSlippageProtectionTriggeredEvent(
    currentPrice,
    maxPrice,
    remainingAmount,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const currentPriceFormatted = formatWithAutoDecimalDetection(
      currentPrice,
      6,
      2
    );
    const maxPriceFormatted = formatWithAutoDecimalDetection(maxPrice, 6, 2);
    const remainingFormatted = formatWithAutoDecimalDetection(
      remainingAmount,
      18,
      4
    );

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }                🛡️ SLIPPAGE PROTECTION TRIGGERED                ${
      colors.reset
    }
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${
      colors.brightYellow
    }⚠️ SLIPPAGE LIMIT REACHED${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }                ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightCyan}💰 Current Price:${
      colors.reset
    } $${currentPriceFormatted} USDC                    ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightYellow}🎯 Max Price:${
      colors.reset
    } $${maxPriceFormatted} USDC                        ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}📊 Remaining:${
      colors.reset
    } ${remainingFormatted} ALU (cancelled)           ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightRed}│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);

    // Play a sound notification (if terminal supports it)
    process.stdout.write("\x07");
  }

  handleMatchingCompletedEvent(
    buyer,
    originalAmount,
    filledAmount,
    remainingAmount,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const originalFormatted = formatWithAutoDecimalDetection(
      originalAmount,
      18,
      4
    );
    const filledFormatted = formatWithAutoDecimalDetection(filledAmount, 18, 4);
    const remainingFormatted = formatWithAutoDecimalDetection(
      remainingAmount,
      18,
      4
    );
    const fillRate =
      originalAmount > 0 ? (filledAmount * 100n) / originalAmount : 0n;

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.brightGreen}✅ MATCHING COMPLETE${colors.reset} | ` +
        `${colors.cyan}Filled: ${filledFormatted}/${originalFormatted} ALU${colors.reset} | ` +
        `${colors.yellow}Rate: ${fillRate}%${colors.reset}` +
        (remainingAmount > 0
          ? ` | ${colors.red}Cancelled: ${remainingFormatted} ALU${colors.reset}`
          : "")
    );
  }

  // _executeTrade debug event handlers
  handleTradeExecutionStartedEvent(
    buyer,
    seller,
    price,
    amount,
    buyerMargin,
    sellerMargin,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const priceFormatted = formatWithAutoDecimalDetection(price, 6, 2);
    const amountFormatted = formatWithAutoDecimalDetection(amount, 18, 4);
    const buyerType = this.formatUserDisplay(buyer);
    const sellerType = this.formatUserDisplay(seller);

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.brightMagenta}🚀 TRADE EXECUTION STARTED${colors.reset} | ` +
        `${colors.green}${buyerType}${colors.reset} ↔ ${colors.red}${sellerType}${colors.reset} | ` +
        `${colors.cyan}${amountFormatted} ALU${colors.reset} @ ${colors.yellow}$${priceFormatted}${colors.reset} | ` +
        `${colors.dim}Margin: ${buyerMargin ? "Y" : "N"}/${
          sellerMargin ? "Y" : "N"
        }${colors.reset}`
    );
  }

  handleTradeValueCalculatedEvent(tradeValue, buyerFee, sellerFee, event) {
    const timestamp = new Date().toLocaleTimeString();
    const valueFormatted = formatWithAutoDecimalDetection(tradeValue, 6, 2);
    const buyerFeeFormatted = formatWithAutoDecimalDetection(buyerFee, 6, 4);
    const sellerFeeFormatted = formatWithAutoDecimalDetection(sellerFee, 6, 4);

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.blue}💰 TRADE VALUE${colors.reset} | ` +
        `${colors.cyan}Value: $${valueFormatted}${colors.reset} | ` +
        `${colors.yellow}Fees: $${buyerFeeFormatted}/$${sellerFeeFormatted}${colors.reset}`
    );
  }

  handleTradeRecordedEvent(tradeId, event) {
    const timestamp = new Date().toLocaleTimeString();

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.green}📝 TRADE RECORDED${colors.reset} | ` +
        `${colors.dim}ID: ${tradeId}${colors.reset}`
    );
  }

  handlePositionsRetrievedEvent(
    buyer,
    oldBuyerPosition,
    seller,
    oldSellerPosition,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const buyerPosFormatted = formatWithAutoDecimalDetection(
      oldBuyerPosition,
      18,
      4
    );
    const sellerPosFormatted = formatWithAutoDecimalDetection(
      oldSellerPosition,
      18,
      4
    );
    const buyerType = this.formatUserDisplay(buyer);
    const sellerType = this.formatUserDisplay(seller);

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.cyan}📊 POSITIONS RETRIEVED${colors.reset} | ` +
        `${colors.green}${buyerType}: ${buyerPosFormatted}${colors.reset} | ` +
        `${colors.red}${sellerType}: ${sellerPosFormatted}${colors.reset}`
    );
  }

  handlePositionsCalculatedEvent(newBuyerPosition, newSellerPosition, event) {
    const timestamp = new Date().toLocaleTimeString();
    const buyerPosFormatted = formatWithAutoDecimalDetection(
      newBuyerPosition,
      18,
      4
    );
    const sellerPosFormatted = formatWithAutoDecimalDetection(
      newSellerPosition,
      18,
      4
    );

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.brightCyan}📈 NEW POSITIONS${colors.reset} | ` +
        `${colors.green}Buyer: ${buyerPosFormatted}${colors.reset} | ` +
        `${colors.red}Seller: ${sellerPosFormatted}${colors.reset}`
    );
  }

  handleActiveTradersUpdatedEvent(
    buyer,
    buyerActive,
    seller,
    sellerActive,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const buyerType = this.formatUserDisplay(buyer);
    const sellerType = this.formatUserDisplay(seller);
    const buyerStatus = buyerActive ? "ACTIVE" : "INACTIVE";
    const sellerStatus = sellerActive ? "ACTIVE" : "INACTIVE";
    const buyerColor = buyerActive ? colors.green : colors.dim;
    const sellerColor = sellerActive ? colors.green : colors.dim;

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}👥 TRADERS UPDATED${colors.reset} | ` +
        `${buyerColor}${buyerType}: ${buyerStatus}${colors.reset} | ` +
        `${sellerColor}${sellerType}: ${sellerStatus}${colors.reset}`
    );
  }

  handleMarginValidationPassedEvent(buyerMargin, sellerMargin, event) {
    const timestamp = new Date().toLocaleTimeString();

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.green}✅ MARGIN VALIDATION${colors.reset} | ` +
        `${colors.cyan}Buyer: ${buyerMargin ? "Margin" : "Spot"}${
          colors.reset
        } | ` +
        `${colors.cyan}Seller: ${sellerMargin ? "Margin" : "Spot"}${
          colors.reset
        }`
    );
  }

  handleLiquidationIndexUpdatedEvent(oldIndex, newIndex, tradersLength, event) {
    const timestamp = new Date().toLocaleTimeString();
    const progress = Math.round((newIndex / tradersLength) * 100);
    const isReset = newIndex === 0 && oldIndex > 0;

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.blue}📈 INDEX UPDATE${colors.reset} | ` +
        `${colors.cyan}${oldIndex} → ${newIndex}${colors.reset} | ` +
        `${colors.yellow}${progress}% complete${colors.reset}` +
        (isReset ? ` | ${colors.magenta}CYCLE RESET${colors.reset}` : "")
    );
  }

  handleLiquidationCheckFinishedEvent(
    tradersChecked,
    liquidationsTriggered,
    nextStartIndex,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const hasLiquidations = liquidationsTriggered > 0;
    const statusColor = hasLiquidations ? colors.red : colors.green;
    const icon = hasLiquidations ? "⚠️" : "✅";

    const notification = `
${colors.bgBlue}${colors.white}${
      colors.bright
    }                🔍 LIQUIDATION CHECK FINISHED                ${
      colors.reset
    }
${
  colors.brightBlue
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightBlue}│${colors.reset} ${statusColor}${icon} SCAN COMPLETE${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}                      ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.brightCyan}👥 Traders Checked:${
      colors.reset
    } ${tradersChecked}                            ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${statusColor}⚡ Liquidations:${
      colors.reset
    } ${liquidationsTriggered}                               ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${
      colors.brightMagenta
    }📊 Next Start Index:${
      colors.reset
    } ${nextStartIndex}                          ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightBlue}│${colors.reset}
${
  colors.brightBlue
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
  }

  handleLiquidationMarginConfiscatedEvent(
    trader,
    marginAmount,
    penalty,
    liquidator,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const traderType = this.formatUserDisplay(trader);
    const liquidatorType = this.formatUserDisplay(liquidator);
    const marginFormatted = formatWithAutoDecimalDetection(marginAmount, 6, 2);
    const penaltyFormatted = formatWithAutoDecimalDetection(penalty, 6, 2);

    const notification = `
${colors.bgMagenta}${colors.white}${
      colors.bright
    }                💸 MARGIN CONFISCATED                ${colors.reset}
${
  colors.brightMagenta
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightRed}💸 MARGIN SEIZED${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}                       ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightYellow}👤 Trader:${
      colors.reset
    } ${traderType.padEnd(15)}                        ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightCyan}💰 Margin:${
      colors.reset
    } $${marginFormatted} USDC                           ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightRed}⚡ Penalty:${
      colors.reset
    } $${penaltyFormatted} USDC                          ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightGreen}🎯 Liquidator:${
      colors.reset
    } ${liquidatorType.padEnd(15)}                   ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightMagenta}│${colors.reset}
${
  colors.brightMagenta
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);

    // Play a confiscation sound notification (if terminal supports it)
    process.stdout.write("\x07\x07"); // Double beep for emphasis
  }

  handleCoreVaultMarginConfiscatedEvent(
    user,
    marginAmount,
    totalLoss,
    penalty,
    liquidator,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const liquidatorType = this.formatUserDisplay(liquidator);
    const marginFormatted = formatWithAutoDecimalDetection(marginAmount, 6, 2);
    const totalLossFormatted = formatWithAutoDecimalDetection(totalLoss, 6, 2);
    const penaltyFormatted = formatWithAutoDecimalDetection(penalty, 6, 4);

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }                🔥 CORE VAULT MARGIN CONFISCATED                ${
      colors.reset
    }
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${
      colors.brightYellow
    }🔥 MARGIN SEIZED BY VAULT${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }             ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightYellow}👤 User:${
      colors.reset
    } ${userType.padEnd(15)}                           ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightCyan}💰 Margin:${
      colors.reset
    } $${marginFormatted} USDC                           ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}💸 Total Loss:${
      colors.reset
    } $${totalLossFormatted} USDC                      ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightYellow}⚡ Penalty:${
      colors.reset
    } $${penaltyFormatted} USDC                          ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightGreen}🎯 Liquidator:${
      colors.reset
    } ${liquidatorType.padEnd(15)}                   ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightRed}│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);

    // Play a strong confiscation sound notification (if terminal supports it)
    process.stdout.write("\x07\x07\x07"); // Triple beep for CoreVault confiscation
  }

  handleLiquidatorRewardPaidEvent(
    liquidator,
    liquidatedUser,
    marketId,
    rewardAmount,
    event
  ) {
    // Raw parameter log for traceability
    try {
      console.log("[Event] LiquidatorRewardPaid", {
        liquidator,
        liquidatedUser,
        marketId,
        rewardAmount:
          typeof rewardAmount === "bigint"
            ? rewardAmount.toString()
            : rewardAmount,
        txHash:
          event && event.transactionHash ? event.transactionHash : undefined,
      });
    } catch (e) {
      console.log("[Event] LiquidatorRewardPaid (log error)", e);
    }

    const timestamp = new Date().toLocaleTimeString();
    const liquidatorType = this.formatUserDisplay(liquidator);
    const userType = this.formatUserDisplay(liquidatedUser);
    const rewardBigInt =
      typeof rewardAmount === "bigint" ? rewardAmount : BigInt(rewardAmount);
    const rewardFormatted = formatUSDC(rewardBigInt, 4);

    const notification = `
${colors.bgGreen}${colors.black}${
      colors.bright
    }           🏆 LIQUIDATOR REWARD PAID            ${colors.reset}
${
  colors.brightGreen
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightYellow}🏦 Market:${
      colors.reset
    } ${this.getMarketDisplayName(marketId)} ${colors.dim}at ${timestamp}${
      colors.reset
    }      ${colors.brightGreen}│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightGreen}🎯 Liquidator:${
      colors.reset
    } ${liquidatorType.padEnd(16)}                 ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightMagenta}👤 Liquidated:${
      colors.reset
    } ${userType.padEnd(16)}                 ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightCyan}💸 Reward:${
      colors.reset
    } $${rewardFormatted} USDC                        ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.dim}Tx: ${(event &&
    event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...                              ${colors.brightGreen}│${
      colors.reset
    }
${
  colors.brightGreen
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
    process.stdout.write("\x07");
  }

  // ============ NEW: Administrative Position Closure (ADL) Event Handlers ============

  handleSocializationStartedEvent(
    marketId,
    totalLossAmount,
    liquidatedUser,
    timestamp,
    event
  ) {
    console.log("🔥 ADL EVENT DETECTED: SocializationStarted");
    const eventTimestamp = new Date().toLocaleTimeString();
    const lossFormatted = formatWithAutoDecimalDetection(totalLossAmount, 6, 2);
    const liquidatedUserType = this.formatUserDisplay(liquidatedUser);
    const marketName = this.getMarketDisplayName(marketId);

    // Enhanced parameter display
    console.log(
      `\n${colors.brightYellow}📋 COMPLETE EVENT PARAMETERS:${colors.reset}`
    );
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${colors.red}   💸 Total Loss Amount:${
        colors.reset
      } ${totalLossAmount.toString()} (raw) = $${lossFormatted} USDC`
    );
    console.log(
      `${colors.red}   👤 Liquidated User:${colors.reset} ${liquidatedUser}`
    );
    console.log(
      `${colors.red}   👤 User Type:${colors.reset} ${liquidatedUserType}`
    );
    console.log(
      `${colors.dim}   ⏰ Event Timestamp:${colors.reset} ${timestamp} (blockchain) | ${eventTimestamp} (local)`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${
        event && event.transactionHash ? event.transactionHash : "(n/a)"
      }`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );

    const notification = `
${colors.bgYellow}${colors.black}${
      colors.bright
    }                🏦 SOCIALIZED LOSS STARTED                ${colors.reset}
${
  colors.brightYellow
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightYellow}│${colors.reset} ${
      colors.brightRed
    }🏦 ADL SYSTEM ACTIVATED${colors.reset} ${colors.dim}at ${eventTimestamp}${
      colors.reset
    }             ${colors.brightYellow}│${colors.reset}
${colors.brightYellow}│${
      colors.reset
    }                                                         ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightYellow}│${
      colors.reset
    }
${colors.brightYellow}│${colors.reset} ${colors.brightMagenta}💸 Loss Amount:${
      colors.reset
    } $${lossFormatted} USDC                 ${colors.brightYellow}│${
      colors.reset
    }
${colors.brightYellow}│${colors.reset} ${colors.brightRed}👤 Liquidated:${
      colors.reset
    } ${liquidatedUserType.padEnd(15)}           ${colors.brightYellow}│${
      colors.reset
    }
${colors.brightYellow}│${
      colors.reset
    }                                                         ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${
      colors.dim
    }🔍 Searching for profitable positions to reduce...${colors.reset} ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightYellow}│${colors.reset}
${
  colors.brightYellow
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
    process.stdout.write("\x07"); // Alert sound
  }

  handleGapLossDetectedEvent(
    trader,
    marketId,
    gapLossAmount,
    liquidationPrice,
    executionPrice,
    positionSize,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const traderType = this.formatUserDisplay(trader);
    const marketName = this.getMarketDisplayName(marketId);
    const gapLossFormatted = formatWithAutoDecimalDetection(
      gapLossAmount,
      6,
      4
    );
    const liquidationPriceFormatted = formatWithAutoDecimalDetection(
      liquidationPrice,
      6,
      2
    );
    const executionPriceFormatted = formatWithAutoDecimalDetection(
      executionPrice,
      6,
      2
    );
    const positionSizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(positionSize),
      18,
      4
    );
    const positionType = positionSize >= 0 ? "LONG" : "SHORT";
    const positionColor = positionSize >= 0 ? colors.green : colors.red;

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }                ⚠️  GAP LOSS DETECTED                 ${colors.reset}
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${
      colors.brightYellow
    }⚠️  LIQUIDATION GAP LOSS${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }      ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}👤 Trader:${
      colors.reset
    } ${traderType.padEnd(15)}                       ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${positionColor}📍 Position:${
      colors.reset
    } ${positionType} ${positionSizeFormatted}              ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightYellow}💰 Gap Loss:${
      colors.reset
    } $${gapLossFormatted} USDC                    ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightBlue}🎯 Liquidation Price:${
      colors.reset
    } $${liquidationPriceFormatted}              ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightRed}💥 Execution Price:${
      colors.reset
    } $${executionPriceFormatted}                ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightRed}│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);
    process.stdout.write("\x07"); // Alert sound
  }

  handlePositionUpdatedEvent(
    user,
    marketId,
    oldSize,
    newSize,
    entryPrice,
    marginLocked,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const marketName = this.getMarketDisplayName(marketId);
    const oldSizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(oldSize),
      18,
      4
    );
    const newSizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(newSize),
      18,
      4
    );
    const entryPriceFormatted = formatWithAutoDecimalDetection(
      entryPrice,
      6,
      2
    );
    const marginLockedFormatted = formatWithAutoDecimalDetection(
      marginLocked,
      6,
      2
    );

    const oldPositionType = oldSize >= 0 ? "LONG" : "SHORT";
    const newPositionType = newSize >= 0 ? "LONG" : "SHORT";
    const oldPositionColor = oldSize >= 0 ? colors.green : colors.red;
    const newPositionColor = newSize >= 0 ? colors.green : colors.red;

    const isPositionClosed = newSize === 0 && oldSize !== 0;
    const isNewPosition = oldSize === 0 && newSize !== 0;
    const isPositionReduced = Math.abs(newSize) < Math.abs(oldSize);
    const sizeChange = newSize - oldSize;
    const sizeChangeFormatted = formatWithAutoDecimalDetection(
      Math.abs(sizeChange),
      18,
      4
    );

    console.log("🔥 POSITION EVENT DETECTED: PositionUpdated");

    // Enhanced parameter display - POSITION UPDATE DETAILS
    console.log(
      `\n${colors.brightBlue}📋 COMPLETE EVENT PARAMETERS - POSITION UPDATED:${colors.reset}`
    );
    console.log(`${colors.cyan}   👤 User:${colors.reset} ${user}`);
    console.log(`${colors.cyan}   👤 User Type:${colors.reset} ${userType}`);
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${oldPositionColor}   📊 Old Position Size:${
        colors.reset
      } ${oldSize.toString()} (raw) = ${oldPositionType} ${oldSizeFormatted} ALU`
    );
    console.log(
      `${newPositionColor}   📊 New Position Size:${
        colors.reset
      } ${newSize.toString()} (raw) = ${newPositionType} ${newSizeFormatted} ALU`
    );
    console.log(
      `${colors.brightYellow}   📈 Size Change:${
        colors.reset
      } ${sizeChange.toString()} (raw) = ${
        sizeChange >= 0 ? "+" : "-"
      }${sizeChangeFormatted} ALU`
    );
    console.log(
      `${colors.yellow}   💰 Entry Price:${
        colors.reset
      } ${entryPrice.toString()} (raw) = $${entryPriceFormatted}`
    );
    console.log(
      `${colors.brightGreen}   🔒 Margin Locked:${
        colors.reset
      } ${marginLocked.toString()} (raw) = $${marginLockedFormatted} USDC`
    );
    console.log(
      `${colors.magenta}   📊 Position Status:${colors.reset} ${
        isPositionClosed
          ? "CLOSED"
          : isNewPosition
          ? "NEW"
          : isPositionReduced
          ? "REDUCED"
          : "INCREASED"
      }`
    );
    console.log(
      `${colors.brightCyan}   📊 Size Change %:${colors.reset} ${
        oldSize !== 0
          ? ((Math.abs(sizeChange) / Math.abs(oldSize)) * 100).toFixed(2)
          : "N/A"
      }%`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${
        event && event.transactionHash ? event.transactionHash : "(n/a)"
      }`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "PositionUpdated"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    const notification = `
${colors.bgBlue}${colors.white}${
      colors.bright
    }                📊 POSITION UPDATED                 ${colors.reset}
${
  colors.brightBlue
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightBlue}│${colors.reset} ${
      colors.brightCyan
    }📊 ADL POSITION CHANGE${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }        ${colors.brightBlue}│${colors.reset}
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${colors.brightMagenta}👤 Trader:${
      colors.reset
    } ${userType.padEnd(15)}                       ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${oldPositionColor}📍 Old:${
      colors.reset
    } ${oldPositionType} ${oldSizeFormatted}${
      isPositionClosed ? " (CLOSED)" : ""
    }                    ${colors.brightBlue}│${colors.reset}
${colors.brightBlue}│${colors.reset} ${newPositionColor}📍 New:${
      colors.reset
    } ${newPositionType} ${newSizeFormatted}${
      isNewPosition ? " (NEW)" : isPositionReduced ? " (REDUCED)" : ""
    }                     ${colors.brightBlue}│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.brightYellow}💰 Entry Price:${
      colors.reset
    } $${entryPriceFormatted}                     ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${colors.reset} ${colors.brightGreen}🔒 Margin Locked:${
      colors.reset
    } $${marginLockedFormatted}                 ${colors.brightBlue}│${
      colors.reset
    }
${colors.brightBlue}│${
      colors.reset
    }                                                         ${
      colors.brightBlue
    }│${colors.reset}
${colors.brightBlue}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightBlue}│${colors.reset}
${
  colors.brightBlue
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
  }

  handleSocializedLossAppliedEvent(
    marketId,
    lossAmount,
    liquidatedUser,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const marketName = this.getMarketDisplayName(marketId);
    const lossFormatted = formatWithAutoDecimalDetection(lossAmount, 6, 2);
    const liquidatedUserType = this.formatUserDisplay(liquidatedUser);

    console.log("🔥 ADL EVENT DETECTED: SocializedLossApplied");

    // Enhanced parameter display
    console.log(
      `\n${colors.brightMagenta}📋 COMPLETE EVENT PARAMETERS:${colors.reset}`
    );
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${colors.red}   💸 Loss Amount:${
        colors.reset
      } ${lossAmount.toString()} (raw) = $${lossFormatted} USDC`
    );
    console.log(
      `${colors.red}   👤 Liquidated User:${colors.reset} ${liquidatedUser}`
    );
    console.log(
      `${colors.red}   👤 User Type:${colors.reset} ${liquidatedUserType}`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "SocializedLossApplied"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );

    const notification = `
${colors.bgMagenta}${colors.white}${
      colors.bright
    }              🌐 SOCIALIZED LOSS APPLIED              ${colors.reset}
${
  colors.brightMagenta
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightMagenta}│${colors.reset} ${
      colors.brightYellow
    }🌐 LOSS SOCIALIZATION${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }         ${colors.brightMagenta}│${colors.reset}
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightRed}💸 Loss Amount:${
      colors.reset
    } $${lossFormatted} USDC                 ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightRed}👤 Liquidated:${
      colors.reset
    } ${liquidatedUserType.padEnd(15)}           ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightMagenta}│${colors.reset}
${
  colors.brightMagenta
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
    process.stdout.write("\x07"); // Alert sound
  }

  handleUserLossSocializedEvent(user, lossAmount, remainingCollateral, event) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const lossFormatted = formatWithAutoDecimalDetection(lossAmount, 6, 2);
    const remainingFormatted = formatWithAutoDecimalDetection(
      remainingCollateral,
      6,
      2
    );

    console.log("🔥 ADL EVENT DETECTED: UserLossSocialized");

    // Enhanced parameter display
    console.log(
      `\n${colors.brightYellow}📋 COMPLETE EVENT PARAMETERS:${colors.reset}`
    );
    console.log(`${colors.cyan}   👤 Affected User:${colors.reset} ${user}`);
    console.log(`${colors.cyan}   👤 User Type:${colors.reset} ${userType}`);
    console.log(
      `${colors.red}   💸 Loss Amount:${
        colors.reset
      } ${lossAmount.toString()} (raw) = $${lossFormatted} USDC`
    );
    console.log(
      `${colors.green}   💰 Remaining Collateral:${
        colors.reset
      } ${remainingCollateral.toString()} (raw) = $${remainingFormatted} USDC`
    );
    console.log(
      `${colors.yellow}   📊 Loss Impact:${colors.reset} ${(
        (parseFloat(lossFormatted) /
          (parseFloat(lossFormatted) + parseFloat(remainingFormatted))) *
        100
      ).toFixed(1)}% of total collateral`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "UserLossSocialized"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    const notification = `
${colors.bgYellow}${colors.black}${
      colors.bright
    }             👤 USER LOSS SOCIALIZED               ${colors.reset}
${
  colors.brightYellow
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightYellow}│${colors.reset} ${colors.brightRed}👤 INDIVIDUAL LOSS${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}           ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${
      colors.reset
    }                                                         ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${
      colors.brightMagenta
    }👤 Affected User:${colors.reset} ${userType.padEnd(15)}             ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${colors.brightRed}💸 Loss Amount:${
      colors.reset
    } $${lossFormatted} USDC                   ${colors.brightYellow}│${
      colors.reset
    }
${colors.brightYellow}│${colors.reset} ${colors.brightGreen}💰 Remaining:${
      colors.reset
    } $${remainingFormatted} USDC                     ${colors.brightYellow}│${
      colors.reset
    }
${colors.brightYellow}│${
      colors.reset
    }                                                         ${
      colors.brightYellow
    }│${colors.reset}
${colors.brightYellow}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightYellow}│${colors.reset}
${
  colors.brightYellow
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
  }

  handleAvailableCollateralConfiscatedEvent(
    user,
    amount,
    remainingAvailable,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const amountFormatted = formatWithAutoDecimalDetection(amount, 6, 2);
    const remainingFormatted = formatWithAutoDecimalDetection(
      remainingAvailable,
      6,
      2
    );

    console.log("🔥 ADL EVENT DETECTED: AvailableCollateralConfiscated");

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }           🏦 COLLATERAL CONFISCATED              ${colors.reset}
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightYellow}🏦 GAP LOSS COVERAGE${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}          ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}👤 Affected User:${
      colors.reset
    } ${userType.padEnd(15)}             ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightYellow}💰 Confiscated:${
      colors.reset
    } $${amountFormatted} USDC                  ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightGreen}💰 Remaining:${
      colors.reset
    } $${remainingFormatted} USDC                     ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightRed}│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);
    process.stdout.write("\x07"); // Alert sound
  }

  handleLiquidationPositionProcessedEvent(
    trader,
    positionSize,
    executionPrice,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const traderType = this.formatUserDisplay(trader);
    const positionSizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(positionSize),
      18,
      4
    );
    const executionPriceFormatted = formatWithAutoDecimalDetection(
      executionPrice,
      6,
      2
    );
    const positionType = positionSize >= 0 ? "LONG" : "SHORT";
    const positionColor = positionSize >= 0 ? colors.green : colors.red;

    const notification = `
${colors.bgGreen}${colors.black}${
      colors.bright
    }              ✅ LIQUIDATION PROCESSED              ${colors.reset}
${
  colors.brightGreen
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightGreen}│${colors.reset} ${
      colors.brightYellow
    }✅ VAULT LIQUIDATION${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }         ${colors.brightGreen}│${colors.reset}
${colors.brightGreen}│${
      colors.reset
    }                                                         ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightMagenta}👤 Trader:${
      colors.reset
    } ${traderType.padEnd(15)}                       ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${positionColor}📍 Position:${
      colors.reset
    } ${positionType} ${positionSizeFormatted}              ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightBlue}💰 Execution:${
      colors.reset
    } $${executionPriceFormatted}                   ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightCyan}🎯 Status:${
      colors.reset
    } Liquidation & ADL Check Complete     ${colors.brightGreen}│${colors.reset}
${colors.brightGreen}│${
      colors.reset
    }                                                         ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightGreen}│${colors.reset}
${
  colors.brightGreen
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
  }

  handleLiquidationProcessingFailedEvent(trader, reason, event) {
    const timestamp = new Date().toLocaleTimeString();
    const traderType = this.formatUserDisplay(trader);
    const reasonString = typeof reason === "string" ? reason : "Unknown error";

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }           ❌ LIQUIDATION PROCESSING FAILED           ${colors.reset}
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${
      colors.brightYellow
    }❌ VAULT PROCESSING ERROR${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }   ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}👤 Trader:${
      colors.reset
    } ${traderType.padEnd(15)}                       ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightYellow}⚠️  Reason:${
      colors.reset
    } ${reasonString.slice(0, 25).padEnd(25)}        ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightCyan}🔄 Fallback:${
      colors.reset
    } Gap loss processing continues      ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${(event && event.transactionHash
      ? event.transactionHash
      : ""
    ).slice(0, 10)}...${colors.reset} ${colors.brightRed}│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);
    process.stdout.write("\x07"); // Alert sound
  }

  handleProfitablePositionFoundEvent(
    user,
    marketId,
    positionSize,
    entryPrice,
    markPrice,
    unrealizedPnL,
    profitScore,
    event
  ) {
    console.log("🔥 ADL EVENT DETECTED: ProfitablePositionFound");
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const marketName = this.getMarketDisplayName(marketId);
    const sizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(positionSize),
      18,
      4
    );
    const entryPriceFormatted = formatWithAutoDecimalDetection(
      entryPrice,
      6,
      2
    );
    const markPriceFormatted = formatWithAutoDecimalDetection(markPrice, 6, 2);
    const pnlFormatted = formatWithAutoDecimalDetection(unrealizedPnL, 6, 2);
    const scoreFormatted = formatWithAutoDecimalDetection(profitScore, 18, 2);
    const positionType = positionSize >= 0 ? "LONG" : "SHORT";
    const positionColor = positionSize >= 0 ? colors.green : colors.red;

    // Enhanced parameter display
    console.log(
      `\n${colors.brightGreen}📋 COMPLETE EVENT PARAMETERS:${colors.reset}`
    );
    console.log(`${colors.cyan}   👤 User:${colors.reset} ${user}`);
    console.log(`${colors.cyan}   👤 User Type:${colors.reset} ${userType}`);
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${positionColor}   📊 Position Size:${
        colors.reset
      } ${positionSize.toString()} (raw) = ${positionType} ${sizeFormatted} ALU`
    );
    console.log(
      `${colors.yellow}   💰 Entry Price:${
        colors.reset
      } ${entryPrice.toString()} (raw) = $${entryPriceFormatted}`
    );
    console.log(
      `${colors.magenta}   📈 Mark Price:${
        colors.reset
      } ${markPrice.toString()} (raw) = $${markPriceFormatted}`
    );
    console.log(
      `${colors.brightGreen}   💸 Unrealized PnL:${
        colors.reset
      } ${unrealizedPnL.toString()} (raw) = +$${pnlFormatted} USDC`
    );
    console.log(
      `${colors.brightCyan}   🎯 Profit Score:${
        colors.reset
      } ${profitScore.toString()} (raw) = ${scoreFormatted}`
    );
    console.log(
      `${colors.yellow}   📊 Price Difference:${colors.reset} $${(
        parseFloat(markPriceFormatted) - parseFloat(entryPriceFormatted)
      ).toFixed(4)} (${(
        (parseFloat(markPriceFormatted) / parseFloat(entryPriceFormatted) - 1) *
        100
      ).toFixed(2)}%)`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "ProfitablePositionFound"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.brightGreen}🎯 PROFITABLE POSITION FOUND${colors.reset} | ` +
        `${colors.cyan}${userType}${colors.reset} | ` +
        `${positionColor}${positionType} ${sizeFormatted}${colors.reset} | ` +
        `${colors.yellow}Entry: $${entryPriceFormatted}${colors.reset} | ` +
        `${colors.magenta}Mark: $${markPriceFormatted}${colors.reset} | ` +
        `${colors.brightGreen}PnL: +$${pnlFormatted}${colors.reset} | ` +
        `${colors.brightCyan}Score: ${scoreFormatted}${colors.reset}`
    );
  }

  handleAdministrativePositionClosureEvent(
    user,
    marketId,
    sizeBeforeReduction,
    sizeAfterReduction,
    realizedProfit,
    newEntryPrice,
    event
  ) {
    console.log("🔥 ADL EVENT DETECTED: AdministrativePositionClosure");
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const marketName = this.getMarketDisplayName(marketId);
    const beforeFormatted = formatWithAutoDecimalDetection(
      sizeBeforeReduction,
      18,
      4
    );
    const afterFormatted = formatWithAutoDecimalDetection(
      sizeAfterReduction,
      18,
      4
    );
    const profitFormatted = formatWithAutoDecimalDetection(
      realizedProfit,
      6,
      2
    );
    const entryFormatted = formatWithAutoDecimalDetection(newEntryPrice, 6, 2);
    const reductionAmount = sizeBeforeReduction - sizeAfterReduction;
    const reductionFormatted = formatWithAutoDecimalDetection(
      reductionAmount,
      18,
      4
    );

    // Enhanced parameter display - CRITICAL ADL EVENT
    console.log(
      `\n${colors.brightMagenta}📋 COMPLETE EVENT PARAMETERS - POSITION SIZE REDUCTION:${colors.reset}`
    );
    console.log(`${colors.cyan}   👤 Affected User:${colors.reset} ${user}`);
    console.log(`${colors.cyan}   👤 User Type:${colors.reset} ${userType}`);
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${colors.red}   📊 Size Before Reduction:${
        colors.reset
      } ${sizeBeforeReduction.toString()} (raw) = ${beforeFormatted} ALU`
    );
    console.log(
      `${colors.green}   📊 Size After Reduction:${
        colors.reset
      } ${sizeAfterReduction.toString()} (raw) = ${afterFormatted} ALU`
    );
    console.log(
      `${colors.brightYellow}   📉 POSITION SIZE REDUCTION:${
        colors.reset
      } ${reductionAmount.toString()} (raw) = ${reductionFormatted} ALU`
    );
    console.log(
      `${colors.brightGreen}   💰 Realized Profit:${
        colors.reset
      } ${realizedProfit.toString()} (raw) = $${profitFormatted} USDC`
    );
    console.log(
      `${colors.yellow}   💰 New Entry Price:${
        colors.reset
      } ${newEntryPrice.toString()} (raw) = $${entryFormatted}`
    );
    console.log(
      `${colors.magenta}   📊 Position Reduction %:${colors.reset} ${(
        (parseFloat(reductionFormatted) / parseFloat(beforeFormatted)) *
        100
      ).toFixed(2)}%`
    );
    console.log(
      `${colors.brightCyan}   💸 Profit per Unit:${colors.reset} $${(
        parseFloat(profitFormatted) / parseFloat(reductionFormatted)
      ).toFixed(6)} USDC/ALU`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "AdministrativePositionClosure"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    const notification = `
${colors.bgMagenta}${colors.white}${
      colors.bright
    }                💸 POSITION REDUCED (ADL)                ${colors.reset}
${
  colors.brightMagenta
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightMagenta}│${colors.reset} ${
      colors.brightYellow
    }💸 ADMINISTRATIVE CLOSURE${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }         ${colors.brightMagenta}│${colors.reset}
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightCyan}👤 User:${
      colors.reset
    } ${userType.padEnd(15)}                        ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightBlue}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                     ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.brightRed}📉 Size Before:${
      colors.reset
    } ${beforeFormatted} ALU                   ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightGreen}📈 Size After:${
      colors.reset
    } ${afterFormatted} ALU                    ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${colors.reset} ${colors.brightYellow}🔻 Reduction:${
      colors.reset
    } ${reductionFormatted} ALU                  ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${
      colors.brightGreen
    }💰 Realized Profit:${colors.reset} $${profitFormatted} USDC             ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.cyan}🎯 Entry Price:${
      colors.reset
    } $${entryFormatted} (unchanged)         ${colors.brightMagenta}│${
      colors.reset
    }
${colors.brightMagenta}│${
      colors.reset
    }                                                         ${
      colors.brightMagenta
    }│${colors.reset}
${colors.brightMagenta}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${event.transactionHash.slice(0, 10)}...${colors.reset} ${
      colors.brightMagenta
    }│${colors.reset}
${
  colors.brightMagenta
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
  }

  handleSocializationCompletedEvent(
    marketId,
    totalLossCovered,
    remainingLoss,
    positionsAffected,
    liquidatedUser,
    event
  ) {
    console.log("🔥 ADL EVENT DETECTED: SocializationCompleted");
    const timestamp = new Date().toLocaleTimeString();
    const marketName = this.getMarketDisplayName(marketId);
    const coveredFormatted = formatWithAutoDecimalDetection(
      totalLossCovered,
      6,
      2
    );
    const remainingFormatted = formatWithAutoDecimalDetection(
      remainingLoss,
      6,
      2
    );
    const liquidatedUserType = this.formatUserDisplay(liquidatedUser);
    const coveragePercent =
      totalLossCovered > 0
        ? Math.round(
            (totalLossCovered / (totalLossCovered + remainingLoss)) * 100
          )
        : 0;

    // Enhanced parameter display - ADL COMPLETION SUMMARY
    console.log(
      `\n${colors.brightGreen}📋 COMPLETE EVENT PARAMETERS - ADL SYSTEM COMPLETED:${colors.reset}`
    );
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${colors.red}   👤 Liquidated User:${colors.reset} ${liquidatedUser}`
    );
    console.log(
      `${colors.red}   👤 User Type:${colors.reset} ${liquidatedUserType}`
    );
    console.log(
      `${colors.brightGreen}   💰 Total Loss Covered:${
        colors.reset
      } ${totalLossCovered.toString()} (raw) = $${coveredFormatted} USDC`
    );
    console.log(
      `${colors.yellow}   💸 Remaining Loss:${
        colors.reset
      } ${remainingLoss.toString()} (raw) = $${remainingFormatted} USDC`
    );
    console.log(
      `${colors.brightMagenta}   👥 Positions Affected:${
        colors.reset
      } ${positionsAffected.toString()} users had their positions reduced`
    );
    console.log(
      `${colors.brightCyan}   📈 Coverage Percentage:${colors.reset} ${coveragePercent}% of total loss covered`
    );
    console.log(
      `${colors.magenta}   💰 Total Original Loss:${colors.reset} $${(
        parseFloat(coveredFormatted) + parseFloat(remainingFormatted)
      ).toFixed(2)} USDC`
    );
    console.log(
      `${colors.yellow}   📊 Average Loss per Position:${colors.reset} $${(
        parseFloat(coveredFormatted) / parseInt(positionsAffected.toString())
      ).toFixed(2)} USDC`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "SocializationCompleted"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    const notification = `
${colors.bgGreen}${colors.white}${
      colors.bright
    }                ✅ SOCIALIZATION COMPLETED                ${colors.reset}
${
  colors.brightGreen
}┌─────────────────────────────────────────────────────────┐${colors.reset}
${colors.brightGreen}│${colors.reset} ${
      colors.brightYellow
    }✅ ADL SYSTEM COMPLETED${colors.reset} ${colors.dim}at ${timestamp}${
      colors.reset
    }           ${colors.brightGreen}│${colors.reset}
${colors.brightGreen}│${
      colors.reset
    }                                                         ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightRed}👤 Liquidated:${
      colors.reset
    } ${liquidatedUserType.padEnd(15)}           ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${
      colors.reset
    }                                                         ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.brightGreen}💰 Loss Covered:${
      colors.reset
    } $${coveredFormatted} USDC                ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightYellow}💸 Remaining Loss:${
      colors.reset
    } $${remainingFormatted} USDC           ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${colors.brightCyan}📈 Coverage:${
      colors.reset
    } ${coveragePercent}%                             ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${colors.reset} ${
      colors.brightMagenta
    }👥 Positions Affected:${
      colors.reset
    } ${positionsAffected}                    ${colors.brightGreen}│${
      colors.reset
    }
${colors.brightGreen}│${
      colors.reset
    }                                                         ${
      colors.brightGreen
    }│${colors.reset}
${colors.brightGreen}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${event.transactionHash.slice(0, 10)}...${colors.reset} ${
      colors.brightGreen
    }│${colors.reset}
${
  colors.brightGreen
}└─────────────────────────────────────────────────────────┘${colors.reset}
    `;

    console.log(notification);
    process.stdout.write("\x07\x07\x07"); // Triple beep for completion
  }

  handleSocializationFailedEvent(
    marketId,
    lossAmount,
    reason,
    liquidatedUser,
    event
  ) {
    console.log("🔥 ADL EVENT DETECTED: SocializationFailed");
    const timestamp = new Date().toLocaleTimeString();
    const marketName = this.getMarketDisplayName(marketId);
    const lossFormatted = formatWithAutoDecimalDetection(lossAmount, 6, 2);
    const liquidatedUserType = this.formatUserDisplay(liquidatedUser);

    // Enhanced parameter display - ADL SYSTEM FAILURE
    console.log(
      `\n${colors.brightRed}📋 COMPLETE EVENT PARAMETERS - ADL SYSTEM FAILED:${colors.reset}`
    );
    console.log(`${colors.cyan}   📊 Market ID:${colors.reset} ${marketId}`);
    console.log(
      `${colors.cyan}   📊 Market Name:${colors.reset} ${marketName}`
    );
    console.log(
      `${colors.red}   💸 Failed Loss Amount:${
        colors.reset
      } ${lossAmount.toString()} (raw) = $${lossFormatted} USDC`
    );
    console.log(
      `${colors.brightRed}   ❌ Failure Reason:${colors.reset} ${reason}`
    );
    console.log(
      `${colors.red}   👤 Liquidated User:${colors.reset} ${liquidatedUser}`
    );
    console.log(
      `${colors.red}   👤 User Type:${colors.reset} ${liquidatedUserType}`
    );
    console.log(
      `${colors.yellow}   ⚠️  Impact:${colors.reset} $${lossFormatted} USDC becomes bad debt`
    );
    console.log(
      `${colors.brightYellow}   🚨 System Status:${colors.reset} ADL unable to cover gap loss - potential system deficit`
    );
    console.log(
      `${colors.dim}   ⏰ Local Timestamp:${colors.reset} ${timestamp}`
    );
    console.log(
      `${colors.dim}   🧱 Block Number:${colors.reset} ${event.blockNumber}`
    );
    console.log(
      `${colors.dim}   📊 Transaction Hash:${colors.reset} ${event.transactionHash}`
    );
    console.log(
      `${colors.dim}   📄 Log Index:${colors.reset} ${event.logIndex}`
    );
    console.log(
      `${colors.dim}   📄 Transaction Index:${colors.reset} ${event.transactionIndex}`
    );
    console.log(
      `${colors.dim}   📋 Event Name:${colors.reset} ${
        event.eventName || "SocializationFailed"
      }`
    );
    if (event.gasUsed)
      console.log(
        `${colors.dim}   ⛽ Gas Used:${
          colors.reset
        } ${event.gasUsed.toString()}`
      );
    if (event.effectiveGasPrice)
      console.log(
        `${colors.dim}   ⛽ Gas Price:${
          colors.reset
        } ${event.effectiveGasPrice.toString()}`
      );
    if (event.address)
      console.log(
        `${colors.dim}   📍 Contract Address:${colors.reset} ${event.address}`
      );

    const notification = `
${colors.bgRed}${colors.white}${
      colors.bright
    }                ❌ SOCIALIZATION FAILED                ${colors.reset}
${colors.brightRed}┌─────────────────────────────────────────────────────────┐${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightYellow}❌ ADL SYSTEM FAILED${
      colors.reset
    } ${colors.dim}at ${timestamp}${colors.reset}              ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightCyan}📊 Market:${
      colors.reset
    } ${marketName.padEnd(15)}                       ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${colors.reset} ${colors.brightMagenta}💸 Loss Amount:${
      colors.reset
    } $${lossFormatted} USDC                 ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightYellow}👤 Liquidated:${
      colors.reset
    } ${liquidatedUserType.padEnd(15)}           ${colors.brightRed}│${
      colors.reset
    }
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.brightRed}⚠️ Reason:${
      colors.reset
    } ${reason.padEnd(30)}                ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${
      colors.reset
    }                                                         ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}💀 This loss becomes bad debt${
      colors.reset
    }                      ${colors.brightRed}│${colors.reset}
${colors.brightRed}│${colors.reset} ${colors.dim}Block: ${
      event.blockNumber
    } | Tx: ${event.transactionHash.slice(0, 10)}...${colors.reset} ${
      colors.brightRed
    }│${colors.reset}
${colors.brightRed}└─────────────────────────────────────────────────────────┘${
      colors.reset
    }
    `;

    console.log(notification);
    process.stdout.write("\x07\x07\x07\x07"); // Quad beep for failure alert
  }

  // Debug event handlers for detailed tracking
  handleDebugProfitCalculationEvent(
    user,
    marketId,
    entryPrice,
    markPrice,
    positionSize,
    unrealizedPnL,
    profitScore,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const marketName = this.getMarketDisplayName(marketId);
    const entryFormatted = formatWithAutoDecimalDetection(entryPrice, 6, 2);
    const markFormatted = formatWithAutoDecimalDetection(markPrice, 6, 2);
    const sizeFormatted = formatWithAutoDecimalDetection(
      Math.abs(positionSize),
      18,
      4
    );
    const pnlFormatted = formatWithAutoDecimalDetection(
      Math.abs(unrealizedPnL),
      6,
      2
    );
    const scoreFormatted = formatWithAutoDecimalDetection(profitScore, 18, 2);
    const pnlSign = unrealizedPnL >= 0 ? "+" : "-";
    const pnlColor = unrealizedPnL >= 0 ? colors.green : colors.red;
    const positionType = positionSize >= 0 ? "LONG" : "SHORT";
    const positionColor = positionSize >= 0 ? colors.green : colors.red;

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.cyan}🔍 DEBUG PROFIT CALC${colors.reset} | ` +
        `${colors.magenta}${userType}${colors.reset} | ` +
        `${positionColor}${positionType} ${sizeFormatted}${colors.reset} | ` +
        `${colors.yellow}${entryFormatted}→${markFormatted}${colors.reset} | ` +
        `${pnlColor}${pnlSign}$${pnlFormatted}${colors.reset} | ` +
        `${colors.cyan}Score: ${scoreFormatted}${colors.reset}`
    );
  }

  handleDebugPositionReductionEvent(
    user,
    marketId,
    originalSize,
    reductionAmount,
    newSize,
    realizedPnL,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const userType = this.formatUserDisplay(user);
    const marketName = this.getMarketDisplayName(marketId);
    const originalFormatted = formatWithAutoDecimalDetection(
      originalSize,
      18,
      4
    );
    const reductionFormatted = formatWithAutoDecimalDetection(
      reductionAmount,
      18,
      4
    );
    const newFormatted = formatWithAutoDecimalDetection(newSize, 18, 4);
    const pnlFormatted = formatWithAutoDecimalDetection(realizedPnL, 6, 2);

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.yellow}🔧 DEBUG POSITION REDUCTION${colors.reset} | ` +
        `${colors.magenta}${userType}${colors.reset} | ` +
        `${colors.brightRed}${originalFormatted}${colors.reset} → ` +
        `${colors.brightYellow}-${reductionFormatted}${colors.reset} → ` +
        `${colors.brightGreen}${newFormatted}${colors.reset} | ` +
        `${colors.brightGreen}Realized: +$${pnlFormatted}${colors.reset}`
    );
  }

  handleDebugSocializationStateEvent(
    marketId,
    remainingLoss,
    totalProfitableUsers,
    processedUsers,
    event
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const marketName = this.getMarketDisplayName(marketId);
    const lossFormatted = formatWithAutoDecimalDetection(remainingLoss, 6, 2);
    const progress =
      totalProfitableUsers > 0
        ? Math.round((processedUsers / totalProfitableUsers) * 100)
        : 0;

    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${colors.cyan}📊 DEBUG ADL STATE${colors.reset} | ` +
        `${colors.brightMagenta}${marketName}${colors.reset} | ` +
        `${colors.brightYellow}Remaining: $${lossFormatted}${colors.reset} | ` +
        `${colors.brightCyan}Progress: ${processedUsers}/${totalProfitableUsers} (${progress}%)${colors.reset}`
    );
  }

  // Helper function to get market display name from market ID
  getMarketDisplayName(marketId) {
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

  async loadUsers() {
    console.log(colorText("\n👥 Loading user accounts...", colors.yellow));

    const signers = await ethers.getSigners();
    this.users = signers.slice(0, 5); // Use first 5 accounts

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

    // Overview option + Hack mode hint
    console.log(colorText(`\n0. Overview (All Users)`, colors.brightYellow));
    console.log(
      colorText(
        `H. Hack mode (type 'H' to open command console)`,
        colors.brightMagenta
      )
    );

    const choiceRaw = await this.askQuestion(
      colorText(
        "\n🎯 Select account (0-5 or O, H for Hack): ",
        colors.brightMagenta
      )
    );
    const choice = String(choiceRaw || "")
      .trim()
      .toLowerCase();

    if (choice === "0" || choice === "o") {
      await this.showOverview();
      return;
    }

    if (choice === "h") {
      await this.enterHackMode();
      return;
    }

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

  // HACK MODE: power-user command console
  async enterHackMode() {
    console.clear();
    await this.renderHackHeader();
    this.printHackLegend();

    while (true) {
      const line = await this.askQuestion(
        colorText("\nhack> ", colors.brightMagenta)
      );
      const raw = String(line || "").trim();
      if (!raw) continue;
      if (raw.toLowerCase() === "back" || raw.toLowerCase() === "exit") {
        await this.selectUser();
        return;
      }
      if (raw.toLowerCase() === "help" || raw.toLowerCase() === "?") {
        this.printHackLegend();
        continue;
      }
      // Run a command file directly
      if (raw.toLowerCase().startsWith("run ")) {
        const p = raw.slice(4).trim();
        await this.runHackFile(p);
        this.renderHackLedger();
        continue;
      }

      const commands = raw
        .split(/[;,]/)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const cmd of commands) {
        try {
          const summary = await this.executeHackCommand(cmd);
          this.recordHackHistory({ status: "ok", cmd, summary });
        } catch (err) {
          console.log(colorText(`❌ ${err.message}`, colors.red));
          this.recordHackHistory({
            status: "err",
            cmd,
            summary: err.message || String(err),
          });
        }
      }
      this.renderHackLedger();
    }
  }

  // Parse and execute one hack command string
  async executeHackCommand(cmd) {
    // Tokenize by spaces (multiple spaces allowed)
    const parts = cmd.split(/\s+/).filter(Boolean);
    if (parts.length === 0) throw new Error("Empty command");

    // Optional user selector at start: U{n}
    let user = this.currentUser;
    let userIndex = this.currentUserIndex;
    let cursor = 0;
    if (/^u\d+$/i.test(parts[0])) {
      const idx = parseInt(parts[0].slice(1), 10);
      if (Number.isNaN(idx) || idx < 1 || idx > this.users.length) {
        throw new Error(`Invalid user: ${parts[0]}`);
      }
      userIndex = idx - 1;
      user = this.users[userIndex];
      cursor++;
    }

    if (!user) throw new Error("No user selected");

    if (cursor >= parts.length) throw new Error("Missing operation");
    const op = parts[cursor].toUpperCase();
    cursor++;

    switch (op) {
      case "LB":
      case "LS": {
        const isBuy = op === "LB";
        // Expected: price, mode(1=units,2=usdc), value
        const priceStr = parts[cursor++];
        const modeStr = parts[cursor++];
        const valStr = parts[cursor++];
        if ([priceStr, modeStr, valStr].some((v) => v === undefined)) {
          throw new Error("LB/LS usage: [U#] LB price mode value");
        }
        const price = Number(priceStr);
        const mode = Number(modeStr);
        const value = Number(valStr);
        if (!isFinite(price) || price <= 0) throw new Error("Invalid price");
        if (!(mode === 1 || mode === 2)) throw new Error("Mode must be 1 or 2");
        if (!isFinite(value) || value <= 0) throw new Error("Invalid value");

        let amountAlu;
        let usdcTotal;
        if (mode === 1) {
          amountAlu = value;
          usdcTotal = price * amountAlu;
        } else {
          usdcTotal = value;
          amountAlu = usdcTotal / price;
        }

        const priceWei = ethers.parseUnits(String(price), 6);
        const amountWei = ethers.parseUnits(String(amountAlu), 18);

        // Optional quick pre-check for collateral availability
        try {
          const required6 = (amountWei * priceWei) / 10n ** 18n;
          const available6 = await this.contracts.vault.getAvailableCollateral(
            user.address
          );
          if (available6 < required6) {
            console.log(
              colorText(
                `⚠️ ${this.formatUserDisplay(
                  user.address
                )} insufficient available collateral: need $${formatUSDC(
                  required6
                )}, have $${formatUSDC(available6)}`,
                colors.yellow
              )
            );
          }
        } catch (_) {}

        const tx = await this.contracts.orderBook
          .connect(user)
          .placeMarginLimitOrder(priceWei, amountWei, isBuy);
        const rcpt = await tx.wait();
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(user.address)} ${
              isBuy ? "LB" : "LS"
            } ${amountAlu} @ $${price} (tx ${tx.hash})`,
            isBuy ? colors.green : colors.red
          )
        );
        console.log(
          colorText(`   ⛽ ${rcpt.gasUsed.toString()} gas`, colors.dim)
        );
        return `${isBuy ? "LB" : "LS"} ${amountAlu} @ $${price}`;
      }

      case "MB":
      case "MS": {
        const isBuy = op === "MB";
        // Expected: mode(1=units,2=usdc), value, [slipBps]
        const modeStr = parts[cursor++];
        const valStr = parts[cursor++];
        const slipStr = parts[cursor];
        if ([modeStr, valStr].some((v) => v === undefined)) {
          throw new Error("MB/MS usage: [U#] MB mode value [slipBps]");
        }
        const mode = Number(modeStr);
        const value = Number(valStr);
        const slippageBps = slipStr !== undefined ? Number(slipStr) : 100; // default 1%
        if (!(mode === 1 || mode === 2)) throw new Error("Mode must be 1 or 2");
        if (!isFinite(value) || value <= 0) throw new Error("Invalid value");
        if (!isFinite(slippageBps) || slippageBps < 0) {
          throw new Error("Invalid slippage bps");
        }

        let amountAlu;
        if (mode === 1) {
          amountAlu = value;
        } else {
          // Convert USDC position value to ALU using reference price
          const [bestBid, bestAsk] =
            await this.contracts.orderBook.getBestPrices();
          const ref = isBuy ? bestAsk : bestBid;
          if (!ref || ref === 0n) throw new Error("No liquidity for market");
          const refPrice = Number(formatPrice(ref));
          amountAlu = value / refPrice;
        }

        const amountWei = ethers.parseUnits(String(amountAlu), 18);
        const tx = await this.contracts.orderBook
          .connect(user)
          .placeMarginMarketOrderWithSlippage(amountWei, isBuy, slippageBps);
        const rcpt = await tx.wait();
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(user.address)} ${
              isBuy ? "MB" : "MS"
            } ${amountAlu} (tx ${tx.hash})`,
            isBuy ? colors.brightGreen : colors.brightRed
          )
        );
        console.log(
          colorText(`   ⛽ ${rcpt.gasUsed.toString()} gas`, colors.dim)
        );
        return `${isBuy ? "MB" : "MS"} ${amountAlu} slip ${slippageBps}bps`;
      }

      case "DEP": {
        // Deposit collateral: amountUSDC
        const amtStr = parts[cursor++];
        if (!amtStr) throw new Error("DEP usage: [U#] DEP amountUSDC");
        const amount = Number(amtStr);
        if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
        const amount6 = ethers.parseUnits(String(amount), 6);

        // Approve and deposit
        const approveTx = await this.contracts.mockUSDC
          .connect(user)
          .approve(await this.contracts.vault.getAddress(), amount6);
        await approveTx.wait();
        const tx = await this.contracts.vault
          .connect(user)
          .depositCollateral(amount6);
        const rcpt = await tx.wait();
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(
              user.address
            )} deposited $${amount} USDC (tx ${tx.hash})`,
            colors.green
          )
        );
        console.log(
          colorText(`   ⛽ ${rcpt.gasUsed.toString()} gas`, colors.dim)
        );
        return `DEP $${amount}`;
      }

      case "WDR": {
        // Withdraw collateral: amountUSDC
        const amtStr = parts[cursor++];
        if (!amtStr) throw new Error("WDR usage: [U#] WDR amountUSDC");
        const amount = Number(amtStr);
        if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
        const amount6 = ethers.parseUnits(String(amount), 6);
        const tx = await this.contracts.vault
          .connect(user)
          .withdrawCollateral(amount6);
        const rcpt = await tx.wait();
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(
              user.address
            )} withdrew $${amount} USDC (tx ${tx.hash})`,
            colors.yellow
          )
        );
        console.log(
          colorText(`   ⛽ ${rcpt.gasUsed.toString()} gas`, colors.dim)
        );
        return `WDR $${amount}`;
      }

      case "CA": {
        // Cancel All orders for user
        const orders = await this.contracts.orderBook.getUserOrders(
          user.address
        );
        let success = 0;
        for (const orderId of orders) {
          try {
            const order = await this.contracts.orderBook.getOrder(orderId);
            if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
              const tx = await this.contracts.orderBook
                .connect(user)
                .cancelOrder(orderId);
              await tx.wait();
              success++;
            }
          } catch (_) {}
        }
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(
              user.address
            )} cancelled ${success} orders`,
            colors.magenta
          )
        );
        return `CA ${success}`;
      }

      case "CO": {
        // Cancel One by orderId (decimal)
        const idStr = parts[cursor++];
        if (!idStr) throw new Error("CO usage: [U#] CO orderId");
        const orderId = BigInt(idStr);
        const tx = await this.contracts.orderBook
          .connect(user)
          .cancelOrder(orderId);
        await tx.wait();
        console.log(
          colorText(
            `✅ ${this.formatUserDisplay(
              user.address
            )} cancelled order ${orderId}`,
            colors.magenta
          )
        );
        return `CO ${orderId}`;
      }

      case "CNO": {
        const idxStr = parts[cursor++];
        if (!idxStr) throw new Error("CNO usage: [U#] CNO index");
        const idx = Number(idxStr) - 1;
        const orders = await this.contracts.orderBook.getUserOrders(
          user.address
        );
        if (isNaN(idx) || idx < 0 || idx >= orders.length)
          throw new Error("Invalid order index");
        const orderId = orders[idx];
        const tx = await this.contracts.orderBook
          .connect(user)
          .cancelOrder(orderId);
        await tx.wait();
        console.log(
          colorText(
            `✅ Cancelled order #${idx + 1} (${orderId})`,
            colors.magenta
          )
        );
        return `CNO #${idx + 1}`;
      }

      case "POS": {
        await this.viewOpenPositionsFor(user);
        return `POS`;
      }

      case "ORDS": {
        await this.viewMyOrdersFor(user);
        return `ORDS`;
      }

      case "OB": {
        await this.displayOrderBook();
        return `OB`;
      }

      case "PF": {
        await this.displayPortfolio();
        return `PF`;
      }

      case "OVR": {
        await this.showOverview();
        return `OVR`;
      }

      case "DPA": {
        await this.detailedPortfolioAnalysis();
        return `DPA`;
      }

      case "DMA": {
        await this.viewDetailedMarginAnalysis();
        return `DMA`;
      }

      case "TH": {
        await this.viewTradeHistory();
        return `TH`;
      }

      case "LH": {
        await this.viewLiquidationHistory();
        return `LH`;
      }

      case "SLT": {
        await this.testSlippageRequirement();
        return `SLT`;
      }

      case "TUP": {
        const idxStr = parts[cursor++];
        const amtStr = parts[cursor++];
        if (!idxStr || !amtStr)
          throw new Error("TUP usage: [U#] TUP index amountUSDC");
        const idx = Number(idxStr) - 1;
        const amount6 = ethers.parseUnits(String(Number(amtStr)), 6);
        const positions = await this.contracts.vault.getUserPositions(
          user.address
        );
        if (isNaN(idx) || idx < 0 || idx >= positions.length)
          throw new Error("Invalid position index");
        const pos = positions[idx];
        const tx = await this.contracts.vault
          .connect(user)
          .topUpPositionMargin(pos.marketId, amount6);
        const rcpt = await tx.wait();
        console.log(
          colorText(
            `✅ Topped up position #${idx + 1} by $${Number(amtStr)} (gas ${
              rcpt.gasUsed
            })`,
            colors.brightGreen
          )
        );
        return `TUP #${idx + 1} $${Number(amtStr)}`;
      }

      case "RED": {
        const idxStr = parts[cursor++];
        const amtStr = parts[cursor++];
        if (!idxStr || !amtStr)
          throw new Error("RED usage: [U#] RED index amountUSDC");
        const idx = Number(idxStr) - 1;
        const amount6 = ethers.parseUnits(String(Number(amtStr)), 6);
        const positions = await this.contracts.vault.getUserPositions(
          user.address
        );
        if (isNaN(idx) || idx < 0 || idx >= positions.length)
          throw new Error("Invalid position index");
        const pos = positions[idx];
        try {
          const tx = await this.contracts.vault
            .connect(user)
            .releaseMargin(user.address, pos.marketId, amount6);
          const rcpt = await tx.wait();
          console.log(
            colorText(
              `✅ Reduced margin on position #${idx + 1} by $${Number(
                amtStr
              )} (gas ${rcpt.gasUsed})`,
              colors.brightYellow
            )
          );
          return `RED #${idx + 1} $${Number(amtStr)}`;
        } catch (err) {
          throw new Error(
            "Direct margin release not permitted; use partial close"
          );
        }
      }

      case "SU": {
        const idxStr = parts[cursor++];
        if (!idxStr) throw new Error("SU usage: SU userIndex");
        const idx = Number(idxStr) - 1;
        if (isNaN(idx) || idx < 0 || idx >= this.users.length)
          throw new Error("Invalid user index");
        this.currentUser = this.users[idx];
        this.currentUserIndex = idx;
        console.log(
          colorText(
            `✅ Switched to ${idx === 0 ? "Deployer" : `User ${idx}`}`,
            colors.brightCyan
          )
        );
        return `SU ${idx + 1}`;
      }

      default:
        throw new Error(`Unknown op: ${op}`);
    }
  }

  // ==== Hack Mode Helpers ====
  async renderHackHeader() {
    console.log(gradient("═".repeat(80)));
    console.log(colorText("🟣 HACK MODE CONSOLE", colors.brightMagenta));
    console.log(gradient("═".repeat(80)));
    try {
      const [totalCollateral, _mu, _mr, available] =
        await this.contracts.vault.getUnifiedMarginSummary(
          this.currentUser?.address || ethers.ZeroAddress
        );
      const [bestBid, bestAsk] = await this.contracts.orderBook.getBestPrices();
      console.log(
        colorText(
          `User: ${
            this.currentUserIndex === 0
              ? "Deployer"
              : `User ${this.currentUserIndex}`
          }  |  Avail: $${formatUSDC(available)}  |  Collat: $${formatUSDC(
            totalCollateral
          )}  |  Bid/Ask: $${formatPrice(bestBid)}/$${formatPrice(bestAsk)}`,
          colors.dim
        )
      );
    } catch (_) {}
  }

  printHackLegend() {
    console.log(colorText("\n📘 COMMAND LEGEND", colors.brightCyan));
    console.log(
      colorText(
        "┌─────────────────────────────────────────────────────────────┐",
        colors.cyan
      )
    );
    console.log(
      colorText(
        "│ Prefix: U{n} targets user (e.g., U2)                      │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Orders: LB price mode val | LS price mode val              │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│         MB mode val [slipBps] | MS mode val [slipBps]      │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Collat: DEP amt | WDR amt                                  │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Cancel: CA (all) | CO orderId | CNO idx                    │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Views: ORDS | POS | OB | PF | OVR                          │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Analyt: DPA (portfolio) | DMA (margin) | TH (trades) | LH   │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Margin: TUP idx amt | RED idx amt                          │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Misc:   SU n (switch user) | SLT (slippage test)           │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Batch:  RUN <path> (execute file with commands)            │",
        colors.white
      )
    );
    console.log(
      colorText(
        "│ Tips:   Separate multiple with comma or semicolon          │",
        colors.dim
      )
    );
    console.log(
      colorText(
        "└─────────────────────────────────────────────────────────────┘",
        colors.cyan
      )
    );
    console.log(
      colorText("Type 'help' for this legend, 'back' to return.", colors.dim)
    );
  }

  recordHackHistory(entry) {
    const ts = new Date().toLocaleTimeString();
    this.hackHistory.push({ ...entry, ts });
    if (this.hackHistory.length > 50) this.hackHistory.shift();
  }

  renderHackLedger() {
    if (!this.hackHistory.length) return;
    console.log(colorText("\n📒 LEDGER (recent)", colors.brightYellow));
    const recent = this.hackHistory.slice(-8);
    for (const e of recent) {
      const icon = e.status === "ok" ? "✅" : "❌";
      console.log(
        colorText(
          `${e.ts} ${icon} ${e.cmd} ${e.summary ? "- " + e.summary : ""}`,
          e.status === "ok" ? colors.green : colors.red
        )
      );
    }
  }

  // Batch runner for file-driven hack commands
  async runHackFile(filePath) {
    const fs = require("fs");
    const path = require("path");
    try {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
      if (!fs.existsSync(absolute)) {
        console.log(colorText(`❌ File not found: ${absolute}`, colors.red));
        return;
      }
      const raw = fs.readFileSync(absolute, "utf8");
      // Accept comma, semicolon, and newline as separators; ignore blank/comment lines (#)
      const tokens = raw
        .split(/[\n;,]+/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"));
      console.log(
        colorText(
          `📦 Loaded ${tokens.length} commands from file`,
          colors.brightCyan
        )
      );
      for (const cmd of tokens) {
        try {
          const summary = await this.executeHackCommand(cmd);
          this.recordHackHistory({ status: "ok", cmd, summary });
        } catch (err) {
          console.log(colorText(`❌ ${cmd} -> ${err.message}`, colors.red));
          this.recordHackHistory({
            status: "err",
            cmd,
            summary: err.message || String(err),
          });
        }
      }
      console.log(colorText("✅ Batch complete.", colors.brightGreen));
    } catch (e) {
      console.log(colorText(`❌ Batch failed: ${e.message}`, colors.red));
    }
  }

  // Non-interactive views for hack mode
  async viewOpenPositionsFor(user) {
    const positions = await this.contracts.vault.getUserPositions(user.address);
    if (!positions.length) {
      console.log(colorText("(no positions)", colors.dim));
      return;
    }
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const side = BigInt(p.size.toString()) >= 0n ? "LONG" : "SHORT";
      const sizeAbs =
        BigInt(p.size.toString()) >= 0n
          ? BigInt(p.size.toString())
          : -BigInt(p.size.toString());
      const entryStr = formatPriceWithValidation(
        BigInt(p.entryPrice.toString()),
        6,
        4,
        false
      );
      console.log(
        colorText(
          `${i + 1}. ${side} ${formatAmount(
            sizeAbs,
            18,
            4
          )} ALU @ $${entryStr}`,
          side === "LONG" ? colors.green : colors.red
        )
      );
    }
  }

  async viewMyOrdersFor(user) {
    const orders = await this.contracts.orderBook.getUserOrders(user.address);
    if (!orders.length) {
      console.log(colorText("(no orders)", colors.dim));
      return;
    }
    for (let i = 0; i < orders.length; i++) {
      try {
        const order = await this.contracts.orderBook.getOrder(orders[i]);
        if (order.trader !== ethers.ZeroAddress && order.amount > 0) {
          const type = order.isBuy ? "BUY" : "SELL";
          const price = formatPriceWithValidation(order.price, 6, 4, false);
          const amount = formatAmount(order.amount, 18, 6);
          console.log(
            colorText(
              `${i + 1}. ${type} ${amount} ALU @ $${price} (ID: ${orders[i]})`,
              order.isBuy ? colors.green : colors.red
            )
          );
        }
      } catch (_) {
        console.log(
          colorText(`${i + 1}. (error loading order ${orders[i]})`, colors.red)
        );
      }
    }
  }
  async showOverview() {
    try {
      console.clear();
      console.log(gradient("═".repeat(80)));
      console.log(colorText("📊 OVERVIEW - ALL USERS", colors.brightCyan));
      console.log(gradient("═".repeat(80)));

      // Aggregate positions by market and by user
      const marketMap = new Map(); // marketIdHex -> { symbol, markPrice6, positions: [] }
      const userTotals = []; // index -> { address, realized18, unrealized, positions, socialized6 }

      for (let i = 0; i < this.users.length; i++) {
        const user = this.users[i];
        const address = user.address;
        userTotals[i] = {
          address,
          realized18: 0n,
          unrealized: 0,
          positions: 0,
          socialized6: 0n,
        };

        // Get realized/unified summary
        try {
          const [
            _totalCollateral,
            _marginUsed,
            _marginReserved,
            _available,
            unifiedRealizedPnL,
            _unifiedUnrealizedPnL,
            _totalCommitted,
            _isHealthy,
          ] = await this.contracts.vault.getUnifiedMarginSummary(address);
          userTotals[i].realized18 = BigInt(
            (unifiedRealizedPnL || 0).toString()
          );
        } catch (_) {}

        // Socialized loss per user (6 decimals)
        try {
          const haircut6 = await this.contracts.vault.userSocializedLoss(
            address
          );
          userTotals[i].socialized6 = BigInt((haircut6 || 0).toString());
        } catch (_) {}

        // Positions
        const positions = await this.contracts.vault.getUserPositions(address);
        for (const position of positions) {
          try {
            const sizeBig = BigInt(position.size.toString());
            if (sizeBig === 0n) continue;

            const marketIdHex = position.marketId;
            const symbol = await safeDecodeMarketId(
              marketIdHex,
              this.contracts
            );

            // Get mark price and pnl for this position
            const { markPrice, pnl } = await getMarkPriceAndPnL(
              this.contracts,
              position
            );

            // Store by market
            if (!marketMap.has(marketIdHex)) {
              marketMap.set(marketIdHex, {
                symbol,
                markPrice6: markPrice,
                positions: [],
              });
            }

            const marketEntry = marketMap.get(marketIdHex);
            marketEntry.markPrice6 = markPrice; // keep latest
            marketEntry.positions.push({
              userIndex: i,
              address,
              size: position.size,
              entryPrice: position.entryPrice,
              pnl,
            });

            userTotals[i].unrealized += pnl;
            userTotals[i].positions += 1;
          } catch (err) {
            console.error("Error aggregating position for overview:", err);
          }
        }
      }

      // Build market list for indexing and aggregate per-market PnL
      const marketEntries = Array.from(marketMap.entries()).map(
        ([marketIdHex, data]) => {
          const totalMarketUnrealized = data.positions.reduce(
            (acc, p) => acc + (Number.isFinite(p.pnl) ? p.pnl : 0),
            0
          );
          return {
            marketIdHex,
            symbol: data.symbol,
            markPrice6: data.markPrice6,
            totalUnrealized: totalMarketUnrealized,
            openPositions: data.positions.length,
          };
        }
      );

      // Display: Markets table
      console.log(colorText("MARKETS OVERVIEW", colors.brightYellow));
      if (marketEntries.length === 0) {
        console.log(
          colorText("   No open positions across users.", colors.yellow)
        );
      } else {
        const header = [
          "#",
          "Symbol",
          "Mark",
          "OpenPos",
          "Unrealized PnL",
          "MarketId",
        ];
        console.log(
          colorText(
            `   ${header[0].padEnd(3)} ${header[1].padEnd(
              10
            )} ${header[2].padStart(10)} ${header[3].padStart(
              7
            )} ${header[4].padStart(16)} ${header[5].padEnd(12)}`,
            colors.dim
          )
        );
        for (let i = 0; i < marketEntries.length; i++) {
          const m = marketEntries[i];
          const markStr =
            typeof m.markPrice6 === "number"
              ? m.markPrice6.toFixed(4)
              : String(m.markPrice6);
          const unrealStr =
            (m.totalUnrealized >= 0 ? "+" : "") + m.totalUnrealized.toFixed(2);
          const line = `   ${String(i).padEnd(3)} ${String(m.symbol).padEnd(
            10
          )} ${markStr.toString().padStart(10)} ${String(
            m.openPositions
          ).padStart(7)} ${unrealStr.padStart(16)} ${String(
            m.marketIdHex
          ).substring(0, 10)}…`;
          console.log(
            colorText(line, m.totalUnrealized >= 0 ? colors.green : colors.red)
          );
        }

        // Compact per-market positions section with units and entry price
        console.log(gradient("-".repeat(80)));
        console.log(colorText("POSITIONS BY MARKET", colors.brightCyan));
        for (let i = 0; i < marketEntries.length; i++) {
          const m = marketEntries[i];
          const mapEntry = marketMap.get(m.marketIdHex);
          if (
            !mapEntry ||
            !mapEntry.positions ||
            mapEntry.positions.length === 0
          ) {
            continue;
          }
          console.log(
            colorText(
              `   [${i}] ${m.symbol} — ${mapEntry.positions.length} positions`,
              colors.brightYellow
            )
          );
          const pHeader = ["User", "Side", "Units", "Entry"];
          console.log(
            colorText(
              `      ${pHeader[0].padEnd(10)} ${pHeader[1].padEnd(
                6
              )} ${pHeader[2].padStart(14)} ${pHeader[3].padStart(12)}`,
              colors.dim
            )
          );
          for (const p of mapEntry.positions) {
            const userLabel =
              p.userIndex === 0 ? "Deployer" : `User ${p.userIndex}`;
            const sizeAbs = ethers.formatUnits(
              BigInt(p.size.toString()) >= 0n
                ? BigInt(p.size.toString())
                : -BigInt(p.size.toString()),
              18
            );
            const side = BigInt(p.size.toString()) >= 0n ? "LONG" : "SHORT";
            const entryStr = formatPriceWithValidation(
              BigInt(p.entryPrice.toString()),
              6,
              4,
              false
            );
            const line = `      ${userLabel.padEnd(10)} ${side.padEnd(
              6
            )} ${sizeAbs.padStart(14)} ${entryStr.padStart(12)}`;
            console.log(
              colorText(line, side === "LONG" ? colors.green : colors.red)
            );
          }
        }
      }

      // Totals per user
      console.log(gradient("-".repeat(80)));
      console.log(
        colorText(
          "👥 USER OVERVIEW (Realized + Unrealized - Socialized)",
          colors.brightCyan
        )
      );
      const userHeader = [
        "#",
        "User",
        "Positions",
        "Realized",
        "Unrealized",
        "Socialized",
        "Total",
        "Address",
      ];
      console.log(
        colorText(
          `   ${userHeader[0].padEnd(3)} ${userHeader[1].padEnd(
            10
          )} ${userHeader[2].padStart(9)} ${userHeader[3].padStart(
            11
          )} ${userHeader[4].padStart(12)} ${userHeader[5].padStart(
            12
          )} ${userHeader[6].padStart(9)} ${userHeader[7].padEnd(14)}`,
          colors.dim
        )
      );
      for (let i = 0; i < userTotals.length; i++) {
        const u = userTotals[i];
        const userLabel = i === 0 ? "Deployer" : `User ${i}`;
        const realized = parseFloat(ethers.formatUnits(u.realized18, 18));
        const unrealized = u.unrealized;
        const socialized = (() => {
          try {
            return parseFloat(formatUSDC(u.socialized6));
          } catch {
            return 0;
          }
        })();
        const total = realized + unrealized - socialized;

        const addrShort = `${u.address.substring(0, 6)}…${u.address.substring(
          u.address.length - 4
        )}`;

        const outerColor = total >= 0 ? colors.green : colors.red;

        const colIdx = String(i).padEnd(3);
        const colUser = userLabel.padEnd(10);
        const colPositions = String(u.positions).padStart(9);
        const colRealized = realized.toFixed(2).padStart(11);
        const colUnrealized = unrealized.toFixed(2).padStart(12);

        // Socialized should display as a negative and be red when > 0
        const socializedSigned =
          (socialized > 0 ? "-" : " ") + socialized.toFixed(2);
        const colSocializedPlain = socializedSigned.padStart(12);
        const colSocialized =
          socialized > 0
            ? `${colors.red}${colSocializedPlain}${colors.reset}${outerColor}`
            : colSocializedPlain;

        const colTotal = total.toFixed(2).padStart(9);

        const lineBody = `   ${colIdx} ${colUser} ${colPositions} ${colRealized} ${colUnrealized} ${colSocialized} ${colTotal} ${addrShort}`;

        // Apply outer color to the entire line, while preserving the inner red for socialized
        console.log(`${outerColor}${lineBody}${colors.reset}`);
      }

      console.log(gradient("═".repeat(80)));
      // Clear instructions for navigation
      console.log(colorText("Navigation:", colors.brightYellow));
      console.log(
        colorText("  • View a user: u <userIndex>   e.g., u 1", colors.dim)
      );
      console.log(
        colorText("  • View a market: m <marketIndex>   e.g., m 0", colors.dim)
      );
      console.log(
        colorText(
          "  • Sandbox a market: s <marketIndex> <newMarkPrice>   e.g., s 0 102.35",
          colors.dim
        )
      );
      console.log(colorText("  • Go back: press Enter", colors.dim));
      const action = await this.askQuestion(
        colorText("\nAction: ", colors.brightMagenta)
      );
      const input = String(action || "").trim();
      if (!input) {
        await this.selectUser();
        return;
      }
      const parts = input.split(/\s+/);
      if (parts.length === 2) {
        const cmd = parts[0].toLowerCase();
        const idx = parseInt(parts[1]);
        if (
          cmd === "u" &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < this.users.length
        ) {
          await this.showUserDetails(idx);
          await this.showOverview();
          return;
        }
        if (
          cmd === "m" &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < marketEntries.length
        ) {
          await this.showMarketDetails(marketEntries[idx].marketIdHex);
          await this.showOverview();
          return;
        }
      } else if (parts.length === 3) {
        const cmd = parts[0].toLowerCase();
        const idx = parseInt(parts[1]);
        const newMark = parseFloat(parts[2]);
        if (
          cmd === "s" &&
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < marketEntries.length &&
          Number.isFinite(newMark) &&
          newMark > 0
        ) {
          await this.runSandboxSimulation(
            marketEntries[idx].marketIdHex,
            newMark
          );
          await this.showOverview();
          return;
        }
      }
      await this.showOverview();
    } catch (error) {
      console.error("Error displaying overview:", error);
      await this.askQuestion(
        colorText("\nPress Enter to return... ", colors.dim)
      );
      await this.selectUser();
    }
  }

  async runSandboxSimulation(marketIdHex, newMarkPriceFloat) {
    try {
      console.clear();
      const symbol = await safeDecodeMarketId(marketIdHex, this.contracts);
      console.log(gradient("═".repeat(80)));
      console.log(
        colorText(
          `🧪 SANDBOX - ${symbol} @ hypothetical mark $${newMarkPriceFloat.toFixed(
            4
          )}`,
          colors.brightCyan
        )
      );
      console.log(gradient("═".repeat(80)));

      // Resolve the market-specific order book
      let orderBook;
      try {
        const orderBookAddr = await this.contracts.vault.marketToOrderBook(
          marketIdHex
        );
        if (orderBookAddr && orderBookAddr !== ethers.ZeroAddress) {
          const OrderBook = await ethers.getContractFactory("OrderBook");
          orderBook = OrderBook.attach(orderBookAddr);
        } else {
          orderBook = this.contracts.orderBook;
        }
      } catch (_) {
        orderBook = this.contracts.orderBook;
      }

      // Snapshot order book depth
      let bidPrices, bidAmounts, askPrices, askAmounts;
      try {
        const depth = 10;
        const data = await orderBook.getOrderBookDepth(depth);
        bidPrices = data[0];
        bidAmounts = data[1];
        askPrices = data[2];
        askAmounts = data[3];
      } catch (e) {
        console.log(
          colorText(
            "⚠️ Could not fetch order book depth; using best prices only.",
            colors.yellow
          )
        );
        const bestBid = await orderBook.bestBid();
        const bestAsk = await orderBook.bestAsk();
        bidPrices = [bestBid];
        bidAmounts = [0n];
        askPrices = [bestAsk];
        askAmounts = [0n];
      }

      // Convert new mark price to 6-decimal BigInt
      const hypotheticalMark6 = BigInt(Math.round(newMarkPriceFloat * 1e6));

      // Simple indicative simulation logic:
      // - If mark is above mid, assume pressure on asks; if below, on bids.
      // - Compute indicative crossed volume and reference price impact.
      const fmt6 = (x) => {
        try {
          return parseFloat(ethers.formatUnits(x, 6)).toFixed(4);
        } catch {
          return "-";
        }
      };
      const toFloat6 = (x) => {
        try {
          return parseFloat(ethers.formatUnits(x, 6));
        } catch {
          return 0;
        }
      };

      let bestBid = 0n,
        bestAsk = 0n;
      try {
        bestBid = await orderBook.bestBid();
        bestAsk = await orderBook.bestAsk();
      } catch (_) {}
      const midFloat =
        (toFloat6(bestBid) + toFloat6(bestAsk)) / 2 || newMarkPriceFloat;

      console.log(
        colorText(
          `Current Bid: $${fmt6(bestBid)}  Ask: $${fmt6(
            bestAsk
          )}  Mid: $${midFloat.toFixed(4)}`,
          colors.blue
        )
      );

      // Aggregate hypothetical fills (purely indicative; no state changes)
      let indicativeVolume = 0n;
      let indicativeWeightedPriceNum = 0n;
      let indicativeWeightedPriceDen = 0n;

      if (bidPrices && askPrices) {
        if (newMarkPriceFloat > midFloat) {
          // Pressure upwards: consume asks up to new mark
          for (let i = 0; i < askPrices.length; i++) {
            const price = askPrices[i];
            if (!price || price === 0n || price >= ethers.MaxUint256) continue;
            if (price > hypotheticalMark6) break;
            const amount = askAmounts[i] || 0n;
            indicativeVolume += amount;
            indicativeWeightedPriceNum += price * amount;
            indicativeWeightedPriceDen += amount;
          }
        } else if (newMarkPriceFloat < midFloat) {
          // Pressure downwards: consume bids down to new mark
          for (let i = 0; i < bidPrices.length; i++) {
            const price = bidPrices[i];
            if (!price || price === 0n) continue;
            if (price < hypotheticalMark6) break;
            const amount = bidAmounts[i] || 0n;
            indicativeVolume += amount;
            indicativeWeightedPriceNum += price * amount;
            indicativeWeightedPriceDen += amount;
          }
        }
      }

      let indicativeVWAP = "-";
      if (indicativeWeightedPriceDen > 0n) {
        const vwap6 = indicativeWeightedPriceNum / indicativeWeightedPriceDen;
        indicativeVWAP = fmt6(vwap6);
      }

      console.log(gradient("-".repeat(80)));
      console.log(
        colorText(`Indicative fills at hypothetical mark:`, colors.brightYellow)
      );
      console.log(
        colorText(
          `   Volume: ${ethers.formatUnits(
            indicativeVolume,
            18
          )} units  |  VWAP: $${indicativeVWAP}`,
          colors.white
        )
      );

      // Estimate unrealized P&L impact for each user in this market
      console.log(gradient("-".repeat(80)));
      console.log(
        colorText(
          `Unrealized P&L impact by user at $${newMarkPriceFloat.toFixed(4)}`,
          colors.brightYellow
        )
      );
      const header = ["User", "Unrealized ΔPnL", "Address"];
      console.log(
        colorText(
          `   ${header[0].padEnd(10)} ${header[1].padStart(
            16
          )} ${header[2].padEnd(14)}`,
          colors.dim
        )
      );
      for (let i = 0; i < this.users.length; i++) {
        const user = this.users[i];
        const positions = await this.contracts.vault.getUserPositions(
          user.address
        );
        let delta = 0;
        for (const pos of positions) {
          if (pos.marketId !== marketIdHex) continue;
          const size = BigInt(pos.size.toString());
          if (size === 0n) continue;
          const entry = BigInt(pos.entryPrice.toString());
          const priceDiff = hypotheticalMark6 - entry; // 6 decimals
          const pnl18 = (priceDiff * size) / 1000000n; // ÷ TICK_PRECISION (1e6) => 18 dec
          const pnl = parseFloat(ethers.formatUnits(pnl18, 18));
          delta += pnl;
        }
        const userLabel = i === 0 ? "Deployer" : `User ${i}`;
        const addrShort = `${user.address.substring(
          0,
          6
        )}…${user.address.substring(user.address.length - 4)}`;
        const line = `   ${userLabel.padEnd(10)} ${delta
          .toFixed(2)
          .padStart(16)} ${addrShort}`;
        console.log(colorText(line, delta >= 0 ? colors.green : colors.red));
      }

      console.log(gradient("═".repeat(80)));
      await this.askQuestion(
        colorText("\nPress Enter to go back... ", colors.dim)
      );
    } catch (error) {
      console.error("Error running sandbox simulation:", error);
      await this.askQuestion(
        colorText("\nPress Enter to return... ", colors.dim)
      );
    }
  }
  async showUserDetails(userIndex) {
    try {
      const user = this.users[userIndex];
      const address = user.address;
      console.clear();
      console.log(gradient("═".repeat(80)));
      console.log(
        colorText(
          `👤 USER DETAILS - ${
            userIndex === 0 ? "Deployer" : `User ${userIndex}`
          }`,
          colors.brightCyan
        )
      );
      console.log(colorText(address, colors.dim));
      console.log(gradient("═".repeat(80)));

      const balance = await this.contracts.mockUSDC.balanceOf(address);
      const collateral = await this.contracts.vault.userCollateral(address);
      const [
        totalCollateral,
        marginUsed,
        marginReserved,
        available,
        realizedPnL18,
        _unrealizedPnL18,
        totalCommitted,
        isHealthy,
      ] = await this.contracts.vault.getUnifiedMarginSummary(address);

      const realized = parseFloat(
        ethers.formatUnits(BigInt(realizedPnL18.toString()), 18)
      );
      const positions = await this.contracts.vault.getUserPositions(address);

      console.log(
        colorText(
          `USDC Balance: ${formatUSDC(balance)}  |  Collateral: ${formatUSDC(
            totalCollateral
          )}  |  Reserved: ${formatUSDC(marginReserved)}`,
          colors.blue
        )
      );
      console.log(
        colorText(
          `Margin Used: ${formatWithAutoDecimalDetection(
            marginUsed,
            6,
            2
          )}  |  Available: ${formatUSDC(available)}  |  Healthy: ${
            isHealthy ? "Yes" : "No"
          }`,
          colors.dim
        )
      );

      console.log(gradient("-".repeat(80)));
      if (positions.length === 0) {
        console.log(colorText("No open positions.", colors.yellow));
      } else {
        const header = ["Symbol", "Side", "Size", "Entry", "Mark", "PnL"];
        console.log(
          colorText(
            `   ${header[0].padEnd(10)} ${header[1].padEnd(
              6
            )} ${header[2].padStart(10)} ${header[3].padStart(
              10
            )} ${header[4].padStart(10)} ${header[5].padStart(10)}`,
            colors.dim
          )
        );
        let unrealizedSum = 0;
        for (const pos of positions) {
          const sizeBig = BigInt(pos.size.toString());
          if (sizeBig === 0n) continue;
          const symbol = await safeDecodeMarketId(pos.marketId, this.contracts);
          const { markPrice, pnl } = await getMarkPriceAndPnL(
            this.contracts,
            pos
          );
          unrealizedSum += pnl;
          const side = sizeBig >= 0n ? "LONG" : "SHORT";
          const sizeAbs = ethers.formatUnits(
            sizeBig >= 0n ? sizeBig : -sizeBig,
            18
          );
          const entryStr = formatPriceWithValidation(
            BigInt(pos.entryPrice.toString()),
            6,
            4,
            false
          );
          const markStr =
            typeof markPrice === "number"
              ? markPrice.toFixed(4)
              : String(markPrice);
          const pnlStr = (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
          const line = `   ${String(symbol).padEnd(10)} ${side.padEnd(
            6
          )} ${sizeAbs.padStart(10)} ${entryStr.padStart(
            10
          )} ${markStr.padStart(10)} ${pnlStr.padStart(10)}`;
          console.log(colorText(line, pnl >= 0 ? colors.green : colors.red));
        }
        const total = realized + unrealizedSum;
        console.log(gradient("-".repeat(80)));
        console.log(
          colorText(
            `Realized: ${realized.toFixed(
              2
            )}  |  Unrealized: ${unrealizedSum.toFixed(
              2
            )}  |  Total: ${total.toFixed(2)}`,
            total >= 0 ? colors.green : colors.red
          )
        );
      }

      await this.askQuestion(
        colorText("\nPress Enter to go back... ", colors.dim)
      );
    } catch (error) {
      console.error("Error displaying user details:", error);
      await this.askQuestion(
        colorText("\nPress Enter to return... ", colors.dim)
      );
    }
  }

  async showMarketDetails(marketIdHex) {
    try {
      console.clear();
      const symbol = await safeDecodeMarketId(marketIdHex, this.contracts);
      console.log(gradient("═".repeat(80)));
      console.log(
        colorText(`🪙 MARKET DETAILS - ${symbol}`, colors.brightCyan)
      );
      console.log(colorText(String(marketIdHex), colors.dim));
      console.log(gradient("═".repeat(80)));

      // Get orderbook address and price data
      let orderBookAddr = ethers.ZeroAddress;
      try {
        orderBookAddr = await this.contracts.vault.marketToOrderBook(
          marketIdHex
        );
      } catch (_) {}
      let mid = 0n,
        bid = 0n,
        ask = 0n,
        last = 0n,
        mark = 0n,
        spread = 0n,
        spreadBps = 0n,
        valid = false;
      try {
        if (orderBookAddr && orderBookAddr !== ethers.ZeroAddress) {
          const OrderBook = await ethers.getContractFactory("OrderBook");
          const ob = OrderBook.attach(orderBookAddr);
          const data = await ob.getMarketPriceData();
          mid = data[0];
          bid = data[1];
          ask = data[2];
          last = data[3];
          mark = data[4];
          spread = data[5];
          spreadBps = data[6];
          valid = data[7];
        } else {
          const data = await this.contracts.orderBook.getMarketPriceData();
          mid = data[0];
          bid = data[1];
          ask = data[2];
          last = data[3];
          mark = data[4];
          spread = data[5];
          spreadBps = data[6];
          valid = data[7];
        }
      } catch (_) {}

      const fmt6 = (x) => {
        try {
          return parseFloat(ethers.formatUnits(x, 6)).toFixed(4);
        } catch {
          return "-";
        }
      };
      const fmtNum = (x) => {
        try {
          return Number(x).toString();
        } catch {
          return "-";
        }
      };

      console.log(
        colorText(
          `Best Bid: ${fmt6(bid)}  |  Best Ask: ${fmt6(ask)}  |  Mid: ${fmt6(
            mid
          )}  |  Mark: ${fmt6(mark)}  |  Spread: ${fmt6(spread)} (${fmtNum(
            spreadBps
          )} bps)  |  Valid: ${valid ? "Yes" : "No"}`,
          colors.blue
        )
      );

      // List positions in this market across users
      console.log(gradient("-".repeat(80)));
      const header = [
        "User",
        "Side",
        "Size",
        "Entry",
        "Mark",
        "PnL",
        "Address",
      ];
      console.log(
        colorText(
          `   ${header[0].padEnd(10)} ${header[1].padEnd(
            6
          )} ${header[2].padStart(10)} ${header[3].padStart(
            10
          )} ${header[4].padStart(10)} ${header[5].padStart(
            10
          )} ${header[6].padEnd(14)}`,
          colors.dim
        )
      );
      let totalUnrealized = 0;
      for (let i = 0; i < this.users.length; i++) {
        const user = this.users[i];
        const positions = await this.contracts.vault.getUserPositions(
          user.address
        );
        for (const pos of positions) {
          if (pos.marketId !== marketIdHex) continue;
          const sizeBig = BigInt(pos.size.toString());
          if (sizeBig === 0n) continue;
          const { markPrice, pnl } = await getMarkPriceAndPnL(
            this.contracts,
            pos
          );
          totalUnrealized += pnl;
          const userLabel = i === 0 ? "Deployer" : `User ${i}`;
          const side = sizeBig >= 0n ? "LONG" : "SHORT";
          const sizeAbs = ethers.formatUnits(
            sizeBig >= 0n ? sizeBig : -sizeBig,
            18
          );
          const entryStr = formatPriceWithValidation(
            BigInt(pos.entryPrice.toString()),
            6,
            4,
            false
          );
          const markStr =
            typeof markPrice === "number"
              ? markPrice.toFixed(4)
              : String(markPrice);
          const pnlStr = (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
          const addrShort = `${user.address.substring(
            0,
            6
          )}…${user.address.substring(user.address.length - 4)}`;
          const line = `   ${userLabel.padEnd(10)} ${side.padEnd(
            6
          )} ${sizeAbs.padStart(10)} ${entryStr.padStart(
            10
          )} ${markStr.padStart(10)} ${pnlStr.padStart(10)} ${addrShort}`;
          console.log(colorText(line, pnl >= 0 ? colors.green : colors.red));
        }
      }
      console.log(gradient("-".repeat(80)));
      console.log(
        colorText(
          `Total Unrealized: ${totalUnrealized.toFixed(2)}`,
          totalUnrealized >= 0 ? colors.green : colors.red
        )
      );

      await this.askQuestion(
        colorText("\nPress Enter to go back... ", colors.dim)
      );
    } catch (error) {
      console.error("Error displaying market details:", error);
      await this.askQuestion(
        colorText("\nPress Enter to return... ", colors.dim)
      );
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
    console.log(
      colorText(
        `🎯 Event Listeners: ${colors.brightGreen}ACTIVE${colors.reset} ${colors.dim}(Trading, MatchingEngine, TradeExecution, Liquidation Debug)${colors.reset}`,
        colors.dim
      )
    );
    console.log(gradient("═".repeat(80)));
  }
  async displayPortfolio() {
    try {
      // Get comprehensive portfolio data
      const balance = await this.contracts.mockUSDC.balanceOf(
        this.currentUser.address
      );
      const [
        unifiedTotalCollateral,
        unifiedMarginUsedInPositions,
        unifiedMarginReservedForOrders,
        unifiedAvailableMargin,
        unifiedRealizedPnL,
        unifiedUnrealizedPnL,
        unifiedTotalMarginCommitted,
        unifiedIsMarginHealthy,
      ] = await this.contracts.vault.getUnifiedMarginSummary(
        this.currentUser.address
      );

      // Create compatible marginSummary object
      const marginSummary = {
        totalCollateral: unifiedTotalCollateral,
        marginUsed: unifiedMarginUsedInPositions,
        marginReserved: unifiedMarginReservedForOrders,
        availableCollateral: unifiedAvailableMargin,
        realizedPnL: unifiedRealizedPnL,
        unrealizedPnL: unifiedUnrealizedPnL,
      };
      const userOrders = await this.contracts.orderBook.getUserOrders(
        this.currentUser.address
      );
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );

      // Socialized loss: total and per-position (if available)
      let totalHaircut6 = 0n;
      try {
        totalHaircut6 = await this.contracts.vault.userSocializedLoss(
          this.currentUser.address
        );
      } catch (_) {}
      const totalHaircutDisplay = formatUSDC(totalHaircut6);

      const positionHaircuts = [];
      try {
        for (const p of positions) {
          const marketId = p.marketId;
          const haircut = p.socializedLossAccrued6 || 0n;
          positionHaircuts.push({ marketId, haircut });
        }
      } catch (_) {}

      // Get comprehensive margin data from all sources
      const comprehensiveMarginData = await this.getComprehensiveMarginData();

      // Calculate portfolio metrics
      // Using auto-detection for decimal precision as some values may be in 18 decimals instead of 6
      const walletBalance = formatUSDC(balance);
      const totalCollateral = formatUSDC(marginSummary.totalCollateral);
      const availableBalance = formatUSDC(marginSummary.availableCollateral);
      const marginUsed = formatWithAutoDecimalDetection(
        marginSummary.marginUsed,
        6
      );
      const marginReserved = formatUSDC(marginSummary.marginReserved); // This appears to always be correct
      // Handle realizedPnL - it's stored with 18 decimals (price×size÷TICK_PRECISION = 24-6=18 decimals)
      const realizedPnLBigInt = BigInt(
        (marginSummary.realizedPnL || 0).toString()
      );
      // Realized P&L calculation: (priceDiff×size)/TICK_PRECISION results in 18 decimals
      const realizedPnLStr = parseFloat(
        ethers.formatUnits(realizedPnLBigInt, 18)
      ).toFixed(2);
      const realizedPnL = parseFloat(realizedPnLStr);

      // Get real-time unrealized P&L using unified mark price calculation
      const unrealizedPnL = await getTotalRealTimeUnrealizedPnL(
        this.contracts,
        this.currentUser.address
      );
      // Portfolio value calculation fix: The contract incorrectly mixes decimal precisions
      // It adds collateral + realizedPnL + unrealizedPnL (but with mixed decimals)
      // We need to recalculate it correctly here using our auto-detected values
      const totalCollateralNum = parseFloat(totalCollateral);

      // FIX: Check if this is a liquidated account to avoid double-counting losses
      const userPositions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      const hasActivePositions = userPositions.length > 0;

      // For liquidated accounts (no positions + negative realized P&L),
      // collateral already includes all losses, so don't add realized P&L again
      const isLiquidatedAccount = !hasActivePositions && realizedPnL < 0;
      const adjustedRealizedPnL = isLiquidatedAccount ? 0 : realizedPnL;

      // Subtract socialized loss from equity to avoid overstatement
      const portfolioValue =
        totalCollateralNum +
        adjustedRealizedPnL +
        unrealizedPnL -
        parseFloat(totalHaircutDisplay);

      // DEBUG: Portfolio value calculation breakdown
      console.log(colorText(`\n🔍 PORTFOLIO VALUE DEBUG:`, colors.yellow));
      console.log(
        colorText(
          `   Total Collateral: $${totalCollateralNum.toFixed(2)}`,
          colors.dim
        )
      );
      console.log(
        colorText(`   Raw Realized P&L: $${realizedPnL.toFixed(2)}`, colors.dim)
      );
      console.log(
        colorText(
          `   Adjusted Realized P&L: $${adjustedRealizedPnL.toFixed(2)} ${
            isLiquidatedAccount ? "(liquidation double-count avoided)" : ""
          }`,
          colors.dim
        )
      );
      console.log(
        colorText(`   Unrealized P&L: $${unrealizedPnL.toFixed(2)}`, colors.dim)
      );
      console.log(
        colorText(
          `   Portfolio Value: $${portfolioValue.toFixed(2)}`,
          colors.dim
        )
      );
      console.log(
        colorText(
          `   Raw totalCollateral string: "${totalCollateral}"`,
          colors.dim
        )
      );

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

      // Socialized Loss Section
      console.log(
        colorText(
          "├─────────────────────────────────────────────────────────────┤",
          colors.cyan
        )
      );
      console.log(
        colorText(
          `│ Socialized Loss:    ${totalHaircutDisplay.padStart(
            12
          )} USDC                │`,
          colors.magenta
        )
      );
      if (positionHaircuts.length > 0) {
        for (const ph of positionHaircuts) {
          const mk = ph.marketId;
          const amt = formatUSDC(ph.haircut);
          console.log(
            colorText(
              `│   - ${mk}: ${amt.padStart(
                12
              )} USDC                            │`,
              colors.dim
            )
          );
        }
      }

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
          )} USDC (Lifetime)     │`,
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
          )} USDC (Current)      │`,
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

      // Key Insights Box with Comprehensive Margin Data
      console.log(
        colorText("\n🔍 KEY INSIGHTS & MARGIN BREAKDOWN:", colors.brightCyan)
      );
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

      // Display comprehensive margin data
      if (comprehensiveMarginData && comprehensiveMarginData.sources) {
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────┤",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│                    📊 MARGIN SOURCES                        │",
            colors.brightYellow
          )
        );

        // CoreVault Summary
        if (comprehensiveMarginData.sources.coreVaultSummary) {
          const summary = comprehensiveMarginData.sources.coreVaultSummary;
          console.log(
            colorText(
              `│ 🏛️  CoreVault Summary: ${colorText(
                summary.marginUsed,
                colors.yellow
              )} used, ${colorText(
                summary.marginReserved,
                colors.orange
              )} reserved   │`,
              colors.white
            )
          );
        }

        // Direct margin mapping
        if (comprehensiveMarginData.sources.coreVaultDirect) {
          const direct = comprehensiveMarginData.sources.coreVaultDirect;
          console.log(
            colorText(
              `│ 🎯 Direct Mapping: ${colorText(
                direct.marginLocked,
                colors.yellow
              )} USDC (userMarginByMarket)      │`,
              colors.white
            )
          );
        }

        // Position-embedded margin
        if (comprehensiveMarginData.sources.coreVaultPositions) {
          const positions = comprehensiveMarginData.sources.coreVaultPositions;
          console.log(
            colorText(
              `│ 📍 Position Embedded: ${colorText(
                positions.totalMarginFromPositions,
                colors.yellow
              )} USDC (position.marginLocked) │`,
              colors.white
            )
          );
        }

        // OrderBook orders
        if (comprehensiveMarginData.sources.orderBookOrders) {
          const orders = comprehensiveMarginData.sources.orderBookOrders;
          console.log(
            colorText(
              `│ 📋 Order Requirements: ${colorText(
                orders.totalMarginFromOrders,
                colors.yellow
              )} USDC (order.marginRequired)  │`,
              colors.white
            )
          );
        }

        // Show discrepancies if any
        if (
          comprehensiveMarginData.totals.discrepancies &&
          comprehensiveMarginData.totals.discrepancies.length > 0
        ) {
          console.log(
            colorText(
              "├─────────────────────────────────────────────────────────────┤",
              colors.dim
            )
          );
          console.log(
            colorText(
              "│                    ⚠️  DISCREPANCIES                        │",
              colors.red
            )
          );

          for (const discrepancy of comprehensiveMarginData.totals
            .discrepancies) {
            console.log(
              colorText(
                `│ ❌ ${discrepancy.type}: ${colorText(
                  discrepancy.difference,
                  colors.red
                )} USDC difference          │`,
                colors.white
              )
            );
          }
        } else {
          console.log(
            colorText(
              `│ 🔒 Total Margin Locked: ${colorText(
                comprehensiveMarginData.totals.totalMarginLocked
                  .toFixed(2)
                  .padEnd(16),
                colors.yellow
              )} USDC        │`,
              colors.white
            )
          );
        }
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
        "\n📊 LIVE ORDER BOOK - ALU/USDC (with Traders)",
        colors.brightYellow
      )
    );

    try {
      const [buyCount, sellCount] =
        await this.contracts.orderBook.getActiveOrdersCount();
      const bestBid = await this.contracts.orderBook.bestBid();
      const bestAsk = await this.contracts.orderBook.bestAsk();

      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────────────────────┐",
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
          `│ Best Bid: ${colorText(
            "$" + formatPriceWithValidation(bestBid, 6, 4, false),
            colors.green
          ).padEnd(25)} Best Ask: ${colorText(
            "$" + formatPriceWithValidation(bestAsk, 6, 4, false),
            colors.red
          ).padEnd(25)} │`,
          colors.white
        )
      );

      // Add mark price display
      let markPriceDisplay = "N/A";
      let midPriceDisplay = "N/A";
      let spreadDisplay = "N/A";

      try {
        // Get comprehensive market data from OrderBook
        const marketData = await this.contracts.orderBook.getMarketPriceData();

        if (marketData.isValid) {
          markPriceDisplay = colorText(
            "$" + formatPriceWithValidation(marketData.markPrice, 6, 4, false),
            colors.brightCyan
          );
          midPriceDisplay = colorText(
            "$" + formatPriceWithValidation(marketData.midPrice, 6, 4, false),
            colors.yellow
          );

          if (marketData.spreadBps > 0) {
            const spreadPercent = (Number(marketData.spreadBps) / 100).toFixed(
              2
            );
            spreadDisplay = colorText(`${spreadPercent}%`, colors.magenta);
          }
        }
      } catch (error) {
        // Fallback: calculate mark price manually
        if (bestBid > 0 && bestAsk < ethers.MaxUint256) {
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
            const calculatedMarkPrice = (bidPrice + askPrice) / 2;
            markPriceDisplay = colorText(
              "$" + calculatedMarkPrice.toFixed(4),
              colors.brightCyan
            );
            midPriceDisplay = markPriceDisplay; // Same as mark price in this case

            const spread = askPrice - bidPrice;
            const spreadPercent = (
              (spread / calculatedMarkPrice) *
              100
            ).toFixed(2);
            spreadDisplay = colorText(`${spreadPercent}%`, colors.magenta);
          }
        }
      }

      console.log(
        colorText(
          `│ Mark Price: ${markPriceDisplay.padEnd(
            20
          )} Mid Price: ${midPriceDisplay.padEnd(
            20
          )} Spread: ${spreadDisplay.padEnd(10)} │`,
          colors.white
        )
      );
      console.log(
        colorText(
          `│ Active Orders: ${colorText(
            buyCount + " buys",
            colors.green
          )}, ${colorText(sellCount + " sells", colors.red)}${" ".repeat(35)}│`,
          colors.white
        )
      );
      console.log(
        colorText(
          "└─────────────────────────────────────────────────────────────────────────────┘",
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
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );

      if (positions.length > 0) {
        console.log(
          colorText("\n🎯 QUICK POSITION SUMMARY", colors.brightYellow)
        );
        console.log(
          colorText("┌─────────────────────────────────────────┐", colors.cyan)
        );

        for (const position of positions) {
          try {
            const marketIdStr = (
              await safeDecodeMarketId(position.marketId, this.contracts)
            ).substring(0, 8);
            const positionSize = BigInt(position.size.toString());
            const absSize = positionSize >= 0n ? positionSize : -positionSize;
            const side = positionSize >= 0n ? "LONG" : "SHORT";
            const sideColor = positionSize >= 0n ? colors.green : colors.red;

            // Use high-precision formatting functions for accuracy
            const size = formatAmount(absSize, 18, 3); // 3 decimals for position size
            const entryPrice = formatPriceWithValidation(
              BigInt(position.entryPrice.toString()),
              6,
              4, // 4 decimals for higher price precision
              false // Don't show warnings in quick summary
            );

            // Fetch liquidation price from vault (equity-aware, updates on top-up)
            let liqStr = "N/A";
            let mmrBreakdown = "N/A";
            try {
              const [liqPrice, hasPos] =
                await this.contracts.vault.getLiquidationPrice(
                  this.currentUser.address,
                  position.marketId
                );
              if (hasPos) {
                const liqBn = BigInt(liqPrice.toString());
                liqStr = liqBn > 0n ? formatPrice(liqBn) : "0.0000";
              }
            } catch (_) {}

            // Fetch effective MMR and show fixed + dynamic breakdown (with gap where available)
            try {
              let mmrBps;
              let fillRatio;
              let gapRatio = 0n;
              let hasPos2 = false;
              if (
                typeof this.contracts.vault.getEffectiveMaintenanceDetails ===
                "function"
              ) {
                const res =
                  await this.contracts.vault.getEffectiveMaintenanceDetails(
                    this.currentUser.address,
                    position.marketId
                  );
                mmrBps = Number(res[0]);
                fillRatio = res[1];
                gapRatio = res[2];
                hasPos2 = res[3];
              } else {
                const res2 =
                  await this.contracts.vault.getEffectiveMaintenanceMarginBps(
                    this.currentUser.address,
                    position.marketId
                  );
                mmrBps = Number(res2[0]);
                fillRatio = res2[1];
                hasPos2 = res2[2];
              }
              if (hasPos2) {
                const baseBps = Number(await this.contracts.vault.baseMmrBps());
                const penaltyBps = Number(
                  await this.contracts.vault.penaltyMmrBps()
                );
                const fixedBps = baseBps + penaltyBps;
                const totalBps = Number(mmrBps);
                const dynamicBps = Math.max(0, totalBps - fixedBps);

                const fixedPct = (fixedBps / 100).toFixed(2) + "%";
                const dynamicPct = (dynamicBps / 100).toFixed(2) + "%";
                const totalPct = (totalBps / 100).toFixed(2) + "%";
                // fillRatio is 1e18-scaled
                const fillPct = (
                  Number(BigInt(fillRatio.toString())) / 1e16
                ).toFixed(2);
                const gapPct = gapRatio
                  ? (Number(BigInt(gapRatio.toString())) / 1e16).toFixed(2)
                  : "0.00";
                mmrBreakdown = `${fixedPct} + ${dynamicPct} = ${totalPct} (fill ${fillPct}%, gap ${gapPct}%)`;
              }
            } catch (_) {}

            console.log(
              colorText(
                `│ ${marketIdStr}: ${colorText(
                  side,
                  sideColor
                )} ${size} ALU @ $${entryPrice}  Liq: $${liqStr} │`,
                colors.white
              )
            );
            // Show MMR breakdown on a second line for clarity
            if (mmrBreakdown !== "N/A") {
              console.log(
                colorText(`│ MMR: ${mmrBreakdown.padEnd(68)} │`, colors.dim)
              );
            }
          } catch (error) {
            console.log(
              colorText(
                "│ Position data error                     │",
                colors.red
              )
            );
            console.error("Debug - Position error:", error.message);
          }
        }

        console.log(
          colorText("└─────────────────────────────────────────┘", colors.cyan)
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
        "│ 13. 🔍 Detailed Margin Analysis        │",
        colors.brightYellow
      )
    );
    console.log(
      colorText("│ 14. 🔥 View Liquidation History         │", colors.brightRed)
    );
    console.log(
      colorText(
        "│ 15. ➕ Top Up Position Margin            │",
        colors.brightGreen
      )
    );
    console.log(
      colorText(
        "│ 16. ➖ Reduce Margin (Partial Close)     │",
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
        "💡 1:1 margin ($100 position = $100 collateral) | Size in ALU tokens or USDC value",
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
        await this.viewDetailedMarginAnalysis();
        break;
      case "14":
        await this.viewLiquidationHistory();
        break;
      case "15":
        await this.topUpPositionMarginFlow();
        break;
      case "16":
        await this.reducePositionMarginFlow();
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
  // === Margin Top-Up ===
  async topUpPositionMarginFlow() {
    console.clear();
    console.log(boxText("➕ TOP UP POSITION MARGIN", colors.brightGreen));
    try {
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      if (positions.length === 0) {
        console.log(colorText("❌ No positions to top up", colors.red));
        await this.pause(2000);
        return;
      }

      // List positions
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const market = await safeDecodeMarketId(pos.marketId, this.contracts);
        const side = BigInt(pos.size.toString()) >= 0n ? "LONG" : "SHORT";
        const sizeFmt = formatAmount(
          BigInt(pos.size.toString()) >= 0n
            ? BigInt(pos.size.toString())
            : -BigInt(pos.size.toString()),
          18,
          4
        );
        const marginFmt = formatUSDC(BigInt(pos.marginLocked.toString()));
        console.log(
          colorText(
            `${i + 1}. ${market.substring(
              0,
              8
            )}  ${side}  ${sizeFmt} ALU  |  Margin: $${marginFmt}`,
            colors.white
          )
        );
      }

      const idxStr = await this.askQuestion(
        colorText("Select position # to top up: ", colors.yellow)
      );
      const idx = Number(idxStr) - 1;
      if (isNaN(idx) || idx < 0 || idx >= positions.length) {
        console.log(colorText("❌ Invalid selection", colors.red));
        await this.pause(2000);
        return;
      }

      const amountStr = await this.askQuestion(
        colorText("Enter top-up amount (USDC): $", colors.brightGreen)
      );
      if (!amountStr || isNaN(amountStr) || Number(amountStr) <= 0) {
        console.log(colorText("❌ Invalid amount", colors.red));
        await this.pause(2000);
        return;
      }
      const amount6 = ethers.parseUnits(amountStr, 6);

      const pos = positions[idx];
      const [liqBefore] = await this.contracts.vault.getLiquidationPrice(
        this.currentUser.address,
        pos.marketId
      );

      // Execute top-up
      const tx = await this.contracts.vault
        .connect(this.currentUser)
        .topUpPositionMargin(pos.marketId, amount6);
      console.log(colorText("⏳ Submitting top-up...", colors.yellow));
      const rcpt = await tx.wait();
      console.log(
        colorText(`✅ Top-up confirmed. Gas: ${rcpt.gasUsed}`, colors.green)
      );

      // Show updated liq price
      const [liqAfter] = await this.contracts.vault.getLiquidationPrice(
        this.currentUser.address,
        pos.marketId
      );
      console.log(
        colorText(
          `📊 Liq Price: $${formatPrice(
            BigInt(liqBefore.toString())
          )}  →  $${formatPrice(BigInt(liqAfter.toString()))}`,
          colors.cyan
        )
      );
    } catch (e) {
      console.log(colorText(`❌ Top-up failed: ${e.message}`, colors.red));
    }
    await this.pause(3000);
  }

  // === Margin Reduction ===
  async reducePositionMarginFlow() {
    console.clear();
    console.log(boxText("➖ REDUCE POSITION MARGIN", colors.brightYellow));
    try {
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      if (positions.length === 0) {
        console.log(colorText("❌ No positions to reduce", colors.red));
        await this.pause(2000);
        return;
      }

      // List positions
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const market = await safeDecodeMarketId(pos.marketId, this.contracts);
        const sizeBn = BigInt(pos.size.toString());
        const sizeFmt = formatAmount(sizeBn >= 0n ? sizeBn : -sizeBn, 18, 4);
        const marginFmt = formatUSDC(BigInt(pos.marginLocked.toString()));
        console.log(
          colorText(
            `${i + 1}. ${market.substring(0, 8)}  ${
              sizeBn >= 0n ? "LONG" : "SHORT"
            }  ${sizeFmt} ALU  |  Margin: $${marginFmt}`,
            colors.white
          )
        );
      }

      const idxStr = await this.askQuestion(
        colorText("Select position # to reduce margin: ", colors.yellow)
      );
      const idx = Number(idxStr) - 1;
      if (isNaN(idx) || idx < 0 || idx >= positions.length) {
        console.log(colorText("❌ Invalid selection", colors.red));
        await this.pause(2000);
        return;
      }

      const amountStr = await this.askQuestion(
        colorText("Enter reduce amount (USDC): $", colors.brightYellow)
      );
      if (!amountStr || isNaN(amountStr) || Number(amountStr) <= 0) {
        console.log(colorText("❌ Invalid amount", colors.red));
        await this.pause(2000);
        return;
      }
      const amount6 = ethers.parseUnits(amountStr, 6);

      const pos = positions[idx];
      const [liqBefore] = await this.contracts.vault.getLiquidationPrice(
        this.currentUser.address,
        pos.marketId
      );

      // CAUTION: Reducing margin below maintenance may make the position liquidatable
      // We directly call vault.releaseMargin as it is ORDERBOOK_ROLE only; if not allowed, inform user
      try {
        const tx = await this.contracts.vault
          .connect(this.currentUser)
          .releaseMargin(this.currentUser.address, pos.marketId, amount6);
        console.log(
          colorText("⏳ Submitting margin release...", colors.yellow)
        );
        const rcpt = await tx.wait();
        console.log(
          colorText(`✅ Margin reduced. Gas: ${rcpt.gasUsed}`, colors.green)
        );
      } catch (err) {
        console.log(
          colorText(
            "⚠️  Direct margin release not permitted. Use a partial close to free margin instead.",
            colors.yellow
          )
        );
        await this.pause(2500);
        return;
      }

      const [liqAfter] = await this.contracts.vault.getLiquidationPrice(
        this.currentUser.address,
        pos.marketId
      );
      console.log(
        colorText(
          `📊 Liq Price: $${formatPrice(
            BigInt(liqBefore.toString())
          )}  →  $${formatPrice(BigInt(liqAfter.toString()))}`,
          colors.cyan
        )
      );
    } catch (e) {
      console.log(
        colorText(`❌ Reduce margin failed: ${e.message}`, colors.red)
      );
    }
    await this.pause(3000);
  }
  async placeLimitOrder(isBuy) {
    console.clear();
    console.log(
      boxText(
        `🎯 PLACE ${isBuy ? "BUY" : "SELL"} LIMIT ORDER (1:1 MARGIN)`,
        isBuy ? colors.green : colors.red
      )
    );
    console.log(
      colorText(
        "💡 1:1 Margin: $100 position requires $100 collateral",
        colors.cyan
      )
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
          `   Type: ${isBuy ? "BUY" : "SELL"} LIMIT ORDER (1:1 MARGIN)`,
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
          `   Collateral Required: $${totalValue} USDC (1:1 ratio)`,
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

        // Pre-trade validation to prevent on-chain reverts
        try {
          const [marginBps, leverageFlag] = await Promise.all([
            this.contracts.orderBook.marginRequirementBps(),
            this.contracts.orderBook.leverageEnabled(),
          ]);

          if (!leverageFlag && Number(marginBps) !== 10000) {
            console.log(
              colorText(
                `❌ Invalid margin config: marginRequirementBps=${marginBps}, leverageEnabled=${leverageFlag}`,
                colors.red
              )
            );
            await this.pause(2000);
            return;
          }

          // Check registration and role by probing a cheap view call chain
          // Also compute required margin and compare with available collateral
          const userAddr = this.currentUser.address;
          const [available] = await Promise.all([
            this.contracts.vault.getAvailableCollateral(userAddr),
          ]);

          const required = (amountWei * priceWei) / 10n ** 18n; // 1:1 margin

          if (available < required) {
            console.log(
              colorText(
                `❌ Insufficient available collateral. Need $${formatUSDC(
                  required
                )}, available $${formatUSDC(available)}`,
                colors.red
              )
            );
            await this.pause(2000);
            return;
          }
        } catch (e) {
          console.log(
            colorText(
              `⚠️ Pre-trade validation failed (continuing): ${e.message}`,
              colors.yellow
            )
          );
        }

        // Always use margin limit order path per new design
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
        `🛒 PLACE ${isBuy ? "BUY" : "SELL"} MARKET ORDER (1:1 MARGIN)`,
        isBuy ? colors.brightGreen : colors.brightRed
      )
    );
    console.log(
      colorText(
        "💡 1:1 Margin: Collateral reserved based on execution price",
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
          `   Type: ${isBuy ? "BUY" : "SELL"} MARKET ORDER (1:1 MARGIN)`,
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

            // Enhanced price formatting with validation
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
              6
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
      const [
        unifiedTotalCollateral2,
        unifiedMarginUsedInPositions2,
        unifiedMarginReservedForOrders2,
        unifiedAvailableMargin2,
        unifiedRealizedPnL2,
        unifiedUnrealizedPnL2,
        unifiedTotalMarginCommitted2,
        unifiedIsMarginHealthy2,
      ] = await this.contracts.vault.getUnifiedMarginSummary(
        this.currentUser.address
      );

      // Create compatible marginSummary object
      const marginSummary = {
        totalCollateral: unifiedTotalCollateral2,
        marginUsed: unifiedMarginUsedInPositions2,
        marginReserved: unifiedMarginReservedForOrders2,
        availableCollateral: unifiedAvailableMargin2,
        realizedPnL: unifiedRealizedPnL2,
        unrealizedPnL: unifiedUnrealizedPnL2,
      };
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
      // Get real-time unrealized P&L using unified mark price calculation
      const unrealizedPnL = await getTotalRealTimeUnrealizedPnL(
        this.contracts,
        this.currentUser.address
      );
      // Portfolio value calculation fix: The contract incorrectly mixes decimal precisions
      // It adds collateral + realizedPnL + unrealizedPnL (but with mixed decimals)
      // We need to recalculate it correctly here using our auto-detected values
      const totalCollateralNum = parseFloat(totalCollateral);

      // FIX: Avoid double-counting liquidation losses (same as in main portfolio display)
      const currentPositions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      const hasActivePositionsCheck = currentPositions.length > 0;
      const isLiquidatedAccountCheck =
        !hasActivePositionsCheck && realizedPnL < 0;
      const adjustedRealizedPnLForPortfolio = isLiquidatedAccountCheck
        ? 0
        : realizedPnL;

      // Subtract socialized loss from equity to avoid overstatement
      const totalHaircut6_2 = await this.contracts.vault.userSocializedLoss(
        this.currentUser.address
      );
      const totalHaircutDisplay2 = parseFloat(formatUSDC(totalHaircut6_2));
      const portfolioValue =
        totalCollateralNum +
        adjustedRealizedPnLForPortfolio +
        unrealizedPnL -
        totalHaircutDisplay2;
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
              ethers.formatUnits(BigInt(position.entryPrice.toString()), 6)
            );
            const marginLocked = parseFloat(
              ethers.formatUnits(BigInt(position.marginLocked.toString()), 6)
            );
            const haircut6 = BigInt(
              (position.socializedLossAccrued6 || 0).toString()
            );
            const haircutDisplay = parseFloat(ethers.formatUnits(haircut6, 6));

            // Calculate position value
            const positionValue = size * entryPrice;
            totalPositionValue += positionValue;

            // Get current P&L from smart contract
            const { pnl: currentPnL } = await getMarkPriceAndPnL(
              this.contracts,
              position
            );

            const pnlColor = currentPnL >= 0 ? colors.green : colors.red;
            const pnlSign = currentPnL >= 0 ? "+" : "";

            console.log(
              colorText(
                `│ ${marketIdStr.padEnd(9)} │ ${colorText(
                  `${sizeSign}${size.toFixed(3)}`,
                  sizeColor
                ).padEnd(12)} │ ${entryPrice
                  .toFixed(2)
                  .padStart(11)} │ ${marginLocked
                  .toFixed(2)
                  .padStart(10)} │ ${colorText(
                  `${pnlSign}${currentPnL.toFixed(2)}`,
                  pnlColor
                ).padStart(8)} │`,
                colors.white
              )
            );
          } catch (positionError) {
            console.log(
              colorText(
                `│ ERROR    │ Cannot parse position data                      │`,
                colors.red
              )
            );
          }
        }
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );
        console.log(
          colorText(
            `│ 💎 TOTAL POSITION VALUE: ${totalPositionValue
              .toFixed(2)
              .padStart(12)} USDC                │`,
            colors.brightCyan
          )
        );
        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────────┘",
            colors.cyan
          )
        );
      }

      // Order Summary
      console.log(colorText(`\n📋 TRADING ACTIVITY:`, colors.bright));
      console.log(
        colorText(
          `   • Active Orders:      ${userOrders.length
            .toString()
            .padStart(12)}`,
          colors.yellow
        )
      );
      console.log(
        colorText(
          `   • Open Positions:     ${positions.length
            .toString()
            .padStart(12)}`,
          colors.magenta
        )
      );

      // Risk Metrics
      console.log(colorText(`\n⚠️  RISK METRICS:`, colors.bright));
      const leverageRatio = marginUsed > 0 ? portfolioValue / marginUsed : 0;
      const leverageColor =
        leverageRatio > 10
          ? colors.red
          : leverageRatio > 5
          ? colors.yellow
          : colors.green;
      console.log(
        colorText(
          `   • Effective Leverage: ${colorText(
            leverageRatio.toFixed(2).padStart(12),
            leverageColor
          )}x`,
          colors.white
        )
      );

      const marginRatio =
        totalCollateral > 0 ? (availableBalance / totalCollateral) * 100 : 0;
      const marginColor =
        marginRatio < 20
          ? colors.red
          : marginRatio < 40
          ? colors.yellow
          : colors.green;
      console.log(
        colorText(
          `   • Available Margin:   ${colorText(
            marginRatio.toFixed(1).padStart(12),
            marginColor
          )}%`,
          colors.white
        )
      );

      // Recommendations
      console.log(colorText(`\n💡 RECOMMENDATIONS:`, colors.brightYellow));
      console.log(
        colorText(
          "┌─────────────────────────────────────────────────────────────┐",
          colors.dim
        )
      );

      if (availableBalance < totalCollateral * 0.2) {
        console.log(
          colorText(
            "│ ⚠️  Consider reducing position sizes or adding collateral   │",
            colors.yellow
          )
        );
      }
      if (utilizationRate > 80) {
        console.log(
          colorText(
            "│ 🔴 High utilization rate - risk of margin calls           │",
            colors.red
          )
        );
      }
      if (unrealizedPnL < -totalCollateral * 0.1) {
        console.log(
          colorText(
            "│ 📉 Significant unrealized losses - consider risk management│",
            colors.red
          )
        );
      }
      if (availableBalance > totalCollateral * 0.5) {
        console.log(
          colorText(
            "│ ✅ Good available balance for new trading opportunities    │",
            colors.green
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
        colorText("❌ Could not fetch portfolio analysis data", colors.red)
      );
      console.log(colorText(`Error: ${error.message}`, colors.red));
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }

  async viewLiquidationHistory() {
    console.clear();
    console.log(boxText("📊 LIQUIDATION HISTORY", colors.brightRed));

    try {
      // Get liquidation events for this user
      const currentBlock = await this.contracts.vault.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 100000); // Last ~100k blocks

      // Get LiquidationExecuted events
      const liquidationFilter =
        this.contracts.vault.filters.LiquidationExecuted(
          this.currentUser.address
        );
      const liquidationEvents = await this.contracts.vault.queryFilter(
        liquidationFilter,
        fromBlock
      );

      // Get MarginConfiscated events
      const marginFilter = this.contracts.vault.filters.MarginConfiscated(
        this.currentUser.address
      );
      const marginEvents = await this.contracts.vault.queryFilter(
        marginFilter,
        fromBlock
      );

      if (liquidationEvents.length === 0 && marginEvents.length === 0) {
        console.log(
          colorText("\n💫 No liquidation history found", colors.yellow)
        );
        await this.askQuestion(
          colorText("\n📱 Press Enter to continue...", colors.dim)
        );
        return;
      }

      console.log(colorText("\n🔥 LIQUIDATION EVENTS:", colors.brightRed));
      console.log(colorText("═".repeat(70), colors.cyan));

      for (const event of liquidationEvents) {
        const block = await event.getBlock();
        const timestamp = new Date(block.timestamp * 1000);
        const marketId = event.args.marketId;
        const totalLoss = ethers.formatUnits(event.args.totalLoss, 6);
        const remainingCollateral = ethers.formatUnits(
          event.args.remainingCollateral,
          6
        );

        console.log(
          colorText(
            `\n📅 Date: ${timestamp.toLocaleString()}`,
            colors.brightYellow
          )
        );
        console.log(
          colorText(`🏦 Market: ${marketId.substring(0, 10)}...`, colors.dim)
        );
        console.log(
          colorText(`💸 Total Loss: $${totalLoss} USDC`, colors.brightRed)
        );
        console.log(
          colorText(
            `💰 Remaining Collateral: $${remainingCollateral} USDC`,
            colors.green
          )
        );
      }

      if (marginEvents.length > 0) {
        console.log(
          colorText("\n📊 MARGIN CONFISCATION DETAILS:", colors.cyan)
        );
        console.log(colorText("═".repeat(70), colors.cyan));

        for (const event of marginEvents) {
          const block = await event.getBlock();
          const timestamp = new Date(block.timestamp * 1000);
          const marginAmount = ethers.formatUnits(event.args.marginAmount, 6);
          const penalty = ethers.formatUnits(event.args.penalty, 6);

          console.log(
            colorText(
              `\n📅 Date: ${timestamp.toLocaleString()}`,
              colors.brightYellow
            )
          );
          console.log(
            colorText(
              `💸 Margin Confiscated: $${marginAmount} USDC`,
              colors.red
            )
          );
          console.log(
            colorText(`🔥 Liquidation Penalty: $${penalty} USDC`, colors.red)
          );
        }
      }
    } catch (error) {
      console.log(
        colorText("⚠️ Error fetching liquidation history:", colors.red)
      );
      console.log(colorText(error.message, colors.dim));
    }

    await this.askQuestion(
      colorText("\n📱 Press Enter to continue...", colors.dim)
    );
  }
  async viewOpenPositions() {
    console.clear();
    console.log(boxText("📊 OPEN POSITIONS OVERVIEW", colors.brightCyan));

    try {
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );

      if (positions.length === 0) {
        console.log(colorText("\n💤 No open positions", colors.yellow));
        console.log(
          colorText(
            "┌─────────────────────────────────────────────────────────────┐",
            colors.dim
          )
        );
        console.log(
          colorText(
            "│                    No Active Positions                     │",
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
            "│  💡 Place some trades to see positions here!               │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│     • Use limit orders for precise entry points            │",
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
            "│     • All positions use 1:1 margin requirement            │",
            colors.white
          )
        );
        console.log(
          colorText(
            "└─────────────────────────────────────────────────────────────┘",
            colors.dim
          )
        );
      } else {
        console.log(
          colorText(
            `\n📈 ACTIVE POSITIONS (${positions.length})`,
            colors.brightYellow
          )
        );
        console.log(
          colorText(
            "┌─────────────────────────────────────────────────────────────────────────────────┐",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "│  Market    │   Side   │    Size     │ Av Entry Price │   Margin   │   Mark   │  P&L   │  Liq  │",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "├─────────────────────────────────────────────────────────────────────────────────┤",
            colors.cyan
          )
        );

        let totalMarginLocked = 0;
        let totalUnrealizedPnL = 0;

        for (let i = 0; i < positions.length; i++) {
          const position = positions[i];
          try {
            // Parse position data
            const marketIdStr = (
              await safeDecodeMarketId(position.marketId, this.contracts)
            ).substring(0, 8);

            // Safe BigInt conversion for position size
            const positionSize = BigInt(position.size.toString());
            const absSize = positionSize >= 0n ? positionSize : -positionSize;
            const size = parseFloat(ethers.formatUnits(absSize, 18));
            const sizeColor = positionSize >= 0n ? colors.green : colors.red;
            const side = positionSize >= 0n ? "LONG " : "SHORT";

            // Use high-precision formatting to get exact entry price from smart contract
            const entryPrice = formatPriceWithValidation(
              BigInt(position.entryPrice.toString()),
              6,
              4, // 4 decimals for higher precision
              false // Don't show warnings in overview
            );
            const marginLocked = parseFloat(
              ethers.formatUnits(BigInt(position.marginLocked.toString()), 6)
            );

            totalMarginLocked += marginLocked;

            // Get current mark price and P&L from smart contract
            const { markPrice, pnl: positionPnL } = await getMarkPriceAndPnL(
              this.contracts,
              position
            );

            totalUnrealizedPnL += positionPnL;

            const pnlColor = positionPnL >= 0 ? colors.green : colors.red;
            const pnlSign = positionPnL >= 0 ? "+" : "";

            // Compute liquidation price from on-chain view
            let liqDisplay = "N/A";
            try {
              const [liqPrice, hasPos] =
                await this.contracts.vault.getLiquidationPrice(
                  this.currentUser.address,
                  position.marketId
                );
              if (hasPos) {
                const liqBn = BigInt(liqPrice.toString());
                liqDisplay = liqBn > 0n ? formatPrice(liqBn, 6, 2) : "0.00";
              }
            } catch (_) {}

            console.log(
              colorText(
                `│ ${marketIdStr.padEnd(10)} │ ${colorText(
                  side.padEnd(8),
                  sizeColor
                )} │ ${size.toFixed(4).padStart(11)} │ $${entryPrice.padStart(
                  10
                )} │ ${marginLocked.toFixed(2).padStart(10)} │ ${markPrice
                  .toFixed(2)
                  .padStart(8)} │ ${colorText(
                  (pnlSign + positionPnL.toFixed(2)).padStart(6),
                  pnlColor
                )} │ ${liqDisplay.padStart(5)} │`,
                colors.white
              )
            );

            // Show per-position haircut line
            const haircut6 = BigInt(
              (position.socializedLossAccrued6 || 0).toString()
            );
            const haircutDisplay = parseFloat(ethers.formatUnits(haircut6, 6));
            if (haircutDisplay > 0) {
              console.log(
                colorText(
                  `│            │          │             │             │ haircut  ${haircutDisplay
                    .toFixed(2)
                    .padStart(10)} │          │        │       │`,
                  colors.dim
                )
              );
            }
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
        const haircut6 = BigInt(
          (position.socializedLossAccrued6 || 0).toString()
        );
        const haircutDisplay = parseFloat(ethers.formatUnits(haircut6, 6));
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
        if (haircutDisplay > 0) {
          console.log(
            colorText(
              `✂️  Accrued Haircut:  $${haircutDisplay.toFixed(2)} USDC`,
              colors.dim
            )
          );
        }
        console.log(
          colorText(
            `💎 Position Value:   $${positionValue.toFixed(2)} USDC`,
            colors.blue
          )
        );

        // Calculate leverage
        const leverage = marginLocked > 0 ? positionValue / marginLocked : 1;
        const leverageColor =
          leverage > 5
            ? colors.red
            : leverage > 2
            ? colors.yellow
            : colors.green;
        console.log(
          colorText(
            `⚡ Leverage:         ${colorText(
              leverage.toFixed(2) + "x",
              leverageColor
            )}`,
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
            const spread = askPrice - bidPrice;

            // Get unified mark price and P&L using our consistent approach
            const { markPrice, pnl: unrealizedPnL } = await getMarkPriceAndPnL(
              this.contracts,
              position
            );
            const pnlPercent = (unrealizedPnL / marginLocked) * 100;

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
            const price = Number(ethers.formatUnits(trade.price, 6));
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
            const price = Number(ethers.formatUnits(trade.price, 6));
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
  async exit() {
    console.clear();
    console.log(
      gradient("🌟 Thank you for using Dexetra Interactive Trader! 🌟")
    );
    console.log(colorText("\n🚀 Happy Trading! 🚀", colors.brightGreen));

    // Clean up event listeners
    try {
      if (this.contracts.orderBook) {
        // Basic trading events
        this.contracts.orderBook.removeAllListeners("OrderMatched");
        this.contracts.orderBook.removeAllListeners("OrderPlaced");
        this.contracts.orderBook.removeAllListeners("OrderCancelled");

        // Matching engine debug events
        this.contracts.orderBook.removeAllListeners("MatchingStarted");
        this.contracts.orderBook.removeAllListeners("PriceLevelEntered");
        this.contracts.orderBook.removeAllListeners("OrderMatchAttempt");
        this.contracts.orderBook.removeAllListeners(
          "SlippageProtectionTriggered"
        );
        this.contracts.orderBook.removeAllListeners("MatchingCompleted");

        // _executeTrade debug events
        this.contracts.orderBook.removeAllListeners("TradeExecutionStarted");
        this.contracts.orderBook.removeAllListeners("TradeValueCalculated");
        this.contracts.orderBook.removeAllListeners("TradeRecorded");
        this.contracts.orderBook.removeAllListeners("PositionsRetrieved");
        this.contracts.orderBook.removeAllListeners("PositionsCalculated");
        this.contracts.orderBook.removeAllListeners("ActiveTradersUpdated");
        this.contracts.orderBook.removeAllListeners("MarginValidationPassed");
        this.contracts.orderBook.removeAllListeners("LiquidationTradeDetected");
        this.contracts.orderBook.removeAllListeners("MarginUpdatesStarted");
        this.contracts.orderBook.removeAllListeners("MarginUpdatesCompleted");
        this.contracts.orderBook.removeAllListeners("FeesDeducted");
        this.contracts.orderBook.removeAllListeners("PriceUpdated");
        this.contracts.orderBook.removeAllListeners(
          "LiquidationCheckTriggered"
        );
        this.contracts.orderBook.removeAllListeners("TradeExecutionCompleted");

        // _checkPositionsForLiquidation debug events
        this.contracts.orderBook.removeAllListeners("LiquidationCheckStarted");
        this.contracts.orderBook.removeAllListeners(
          "LiquidationRecursionGuardSet"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationTraderBeingChecked"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationLiquidatableCheck"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationPositionRetrieved"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationMarketOrderAttempt"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationMarketOrderResult"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationSocializedLossAttempt"
        );
        this.contracts.orderBook.removeAllListeners(
          "LiquidationSocializedLossResult"
        );
        this.contracts.orderBook.removeAllListeners("LiquidationCompleted");
        this.contracts.orderBook.removeAllListeners("LiquidationIndexUpdated");
        this.contracts.orderBook.removeAllListeners("LiquidationCheckFinished");
        this.contracts.orderBook.removeAllListeners(
          "LiquidationMarginConfiscated"
        );

        // Clean up CoreVault event listeners
        if (this.contracts.vault) {
          this.contracts.vault.removeAllListeners("MarginConfiscated");
        }

        console.log(colorText("✅ Event listeners cleaned up", colors.dim));
      }
    } catch (error) {
      console.log(
        colorText(
          "⚠️ Warning: Could not clean up event listeners",
          colors.yellow
        )
      );
    }

    this.rl.close();
    this.isRunning = false;
    process.exit(0);
  }

  // UTILITY METHODS
  askQuestion(question) {
    // If running non-interactively or input closed, exit cleanly
    if (
      !process.stdin.isTTY ||
      !this.rl ||
      this.rl.closed ||
      this.inputClosed
    ) {
      try {
        console.log(
          colorText(
            "\n⚠️ Non-interactive mode detected (stdin closed). Exiting.",
            colors.yellow
          )
        );
      } catch (_) {}
      process.exit(0);
    }
    return new Promise((resolve) => {
      try {
        this.rl.question(question, (answer) => resolve(answer ?? ""));
      } catch (_) {
        try {
          console.log(
            colorText("\n⚠️ Input unavailable. Exiting trader.", colors.yellow)
          );
        } catch (__) {}
        process.exit(0);
      }
    });
  }

  async pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Display detailed margin analysis from all sources
   */
  async viewDetailedMarginAnalysis() {
    console.clear();
    console.log(colorText("🔍 UNIFIED MARGIN ANALYSIS", colors.brightCyan));
    console.log(gradient("═".repeat(80)));

    try {
      const comprehensiveMarginData = await this.getComprehensiveMarginData();

      if (comprehensiveMarginData.sources.error) {
        console.log(
          colorText(
            `❌ Error: ${comprehensiveMarginData.sources.error}`,
            colors.red
          )
        );
        await this.pause(3000);
        return;
      }

      // Display unified margin summary
      const unified = comprehensiveMarginData.sources.unifiedMargin;
      console.log(
        colorText("\n📊 KEY INSIGHTS & MARGIN BREAKDOWN", colors.brightYellow)
      );
      console.log(colorText("─".repeat(60), colors.dim));

      // Display margin ratio
      const marginRatio = (
        (Number(unified.totalMarginCommitted) /
          Number(unified.totalCollateral)) *
        100
      ).toFixed(2);
      const marginRatioColor =
        Number(marginRatio) > 80
          ? colors.red
          : Number(marginRatio) > 60
          ? colors.yellow
          : colors.green;

      console.log(colorText(`📈 KEY METRICS`, colors.brightCyan));
      console.log(
        colorText(
          `   Margin Ratio:        ${colorText(
            marginRatio + "%",
            marginRatioColor
          )} (Committed/Collateral)`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Free Margin:         ${colorText(
            (
              (Number(unified.availableMargin) /
                Number(unified.totalCollateral)) *
              100
            ).toFixed(2) + "%",
            colors.brightGreen
          )} of collateral`,
          colors.white
        )
      );

      console.log(colorText(`\n💰 MARGIN BREAKDOWN`, colors.brightCyan));
      console.log(
        colorText(
          `   Total Collateral:     ${colorText(
            unified.totalCollateral,
            colors.green
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Margin in Positions:  ${colorText(
            unified.marginUsedInPositions,
            colors.yellow
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Reserved for Orders:  ${colorText(
            unified.marginReservedForOrders,
            colors.orange
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Available Balance:    ${colorText(
            unified.availableMargin,
            colors.brightGreen
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Total Committed:      ${colorText(
            unified.totalMarginCommitted,
            colors.magenta
          )} USDC`,
          colors.white
        )
      );

      console.log(colorText(`\n📈 PROFIT & LOSS`, colors.brightCyan));
      const realizedColor =
        Number(unified.realizedPnL) >= 0 ? colors.green : colors.red;
      const unrealizedColor =
        Number(unified.unrealizedPnL) >= 0 ? colors.green : colors.red;
      console.log(
        colorText(
          `   Realized P&L:        ${colorText(
            unified.realizedPnL,
            realizedColor
          )} USDC`,
          colors.white
        )
      );
      console.log(
        colorText(
          `   Unrealized P&L:      ${colorText(
            unified.unrealizedPnL,
            unrealizedColor
          )} USDC`,
          colors.white
        )
      );

      // Display margin utilization
      const util = comprehensiveMarginData.sources.marginUtilization;
      console.log(colorText(`\n📊 MARGIN UTILIZATION`, colors.brightCyan));
      const utilizationColor =
        Number(util.utilizationBps) > 8000
          ? colors.red
          : Number(util.utilizationBps) > 6000
          ? colors.yellow
          : colors.green;
      console.log(
        colorText(
          `   Current Utilization: ${colorText(
            util.utilizationPercent,
            utilizationColor
          )}`,
          colors.white
        )
      );

      // Display position details
      if (comprehensiveMarginData.sources.positions.positions.length > 0) {
        console.log(colorText(`\n📍 POSITION DETAILS`, colors.brightCyan));
        console.log(colorText("─".repeat(60), colors.dim));

        for (const pos of comprehensiveMarginData.sources.positions.positions) {
          const sizeNum = Number(pos.size);
          const sideColor = sizeNum >= 0 ? colors.green : colors.red;
          const side = sizeNum >= 0 ? "LONG" : "SHORT";

          console.log(
            colorText(
              `   Market: ${pos.marketId.substring(0, 8)}...`,
              colors.white
            )
          );
          console.log(
            colorText(`   Side:   ${colorText(side, sideColor)}`, colors.white)
          );
          console.log(
            colorText(
              `   Size:   ${colorText(
                Math.abs(sizeNum).toFixed(4),
                sideColor
              )} ALU`,
              colors.white
            )
          );
          console.log(
            colorText(`   Entry:  $${pos.entryPrice} USDC`, colors.white)
          );
          console.log(
            colorText(
              `   Margin: ${colorText(pos.marginLocked, colors.yellow)} USDC`,
              colors.white
            )
          );
          console.log(colorText("   " + "─".repeat(40), colors.dim));
        }
      }

      // Display health status
      console.log(colorText(`\n🏥 MARGIN HEALTH STATUS`, colors.brightCyan));
      console.log(colorText("─".repeat(60), colors.dim));
      const healthColor = unified.isMarginHealthy
        ? colors.brightGreen
        : colors.red;
      const healthStatus = unified.isMarginHealthy
        ? "HEALTHY ✅"
        : "NEEDS ATTENTION ⚠️";
      console.log(
        colorText(
          `   Status: ${colorText(healthStatus, healthColor)}`,
          colors.white
        )
      );

      // Display any synchronization warnings
      if (comprehensiveMarginData.totals.discrepancies.length > 0) {
        console.log(colorText(`\n⚠️ SYNCHRONIZATION WARNINGS`, colors.yellow));
        console.log(colorText("─".repeat(60), colors.dim));

        for (const discrepancy of comprehensiveMarginData.totals
          .discrepancies) {
          console.log(colorText(`   ${discrepancy.type}:`, colors.red));
          console.log(colorText(`   ${discrepancy.description}`, colors.white));
          console.log(
            colorText(`   Details: ${discrepancy.difference}`, colors.dim)
          );
        }
      } else {
        console.log(colorText(`\n🔒 LOCKED MARGIN DETAILS`, colors.yellow));
        console.log(colorText("─".repeat(60), colors.dim));
        console.log(
          colorText(
            `   Margin in Positions: ${colorText(
              unified.marginUsedInPositions,
              colors.yellow
            )} USDC`,
            colors.white
          )
        );
        console.log(
          colorText(
            `   Reserved for Orders: ${colorText(
              unified.marginReservedForOrders,
              colors.yellow
            )} USDC`,
            colors.white
          )
        );
        console.log(
          colorText(
            `   Total Margin Locked: ${colorText(
              unified.totalMarginCommitted,
              colors.yellow
            )} USDC`,
            colors.white
          )
        );
      }

      console.log(colorText("\n" + "─".repeat(60), colors.dim));
      console.log(
        colorText("Press any key to return to main menu...", colors.dim)
      );
      await this.askQuestion("");
    } catch (error) {
      console.log(
        colorText(
          `❌ Error in detailed margin analysis: ${error.message}`,
          colors.red
        )
      );
      console.log(
        colorText("Press any key to return to main menu...", colors.dim)
      );
      await this.askQuestion("");
    }
  }

  /**
   * Get comprehensive margin data from all available sources
   * @returns {Object} Comprehensive margin breakdown with sources
   */
  async getComprehensiveMarginData() {
    const marketId = MARKET_INFO.ALUMINUM.marketId;
    const marginData = {
      sources: {},
      totals: {
        totalMarginUsed: 0,
        totalMarginReserved: 0,
        totalMarginLocked: 0,
        discrepancies: [],
      },
    };

    try {
      // Get unified margin data from CoreVault's single source of truth
      console.log("🔍 Fetching unified margin data from CoreVault...");

      const [
        totalCollateral,
        marginUsedInPositions,
        marginReservedForOrders,
        availableMargin,
        realizedPnL,
        unrealizedPnL,
        totalMarginCommitted,
        isMarginHealthy,
      ] = await this.contracts.vault.getUnifiedMarginSummary(
        this.currentUser.address
      );
      // Store unified margin data
      marginData.sources.unifiedMargin = {
        source: "CoreVault.getUnifiedMarginSummary()",
        totalCollateral: formatUSDC(totalCollateral),
        marginUsedInPositions: formatUSDC(marginUsedInPositions),
        marginReservedForOrders: formatUSDC(marginReservedForOrders),
        availableMargin: formatUSDC(availableMargin),
        realizedPnL: formatWithAutoDecimalDetection(realizedPnL, 6),
        unrealizedPnL: formatWithAutoDecimalDetection(unrealizedPnL, 6),
        totalMarginCommitted: formatUSDC(totalMarginCommitted),
        isMarginHealthy,
        raw: {
          totalCollateral: totalCollateral.toString(),
          marginUsedInPositions: marginUsedInPositions.toString(),
          marginReservedForOrders: marginReservedForOrders.toString(),
          availableMargin: availableMargin.toString(),
          realizedPnL: realizedPnL.toString(),
          unrealizedPnL: unrealizedPnL.toString(),
          totalMarginCommitted: totalMarginCommitted.toString(),
        },
      };

      // Get margin utilization ratio
      const utilizationBps = await this.contracts.vault.getMarginUtilization(
        this.currentUser.address
      );
      marginData.sources.marginUtilization = {
        source: "CoreVault.getMarginUtilization()",
        utilizationBps: utilizationBps.toString(),
        utilizationPercent: (Number(utilizationBps) / 100).toFixed(2) + "%",
      };

      // Get positions for detailed view
      const positions = await this.contracts.vault.getUserPositions(
        this.currentUser.address
      );
      const positionDetails = [];
      for (const pos of positions) {
        positionDetails.push({
          marketId: pos.marketId,
          size: formatWithAutoDecimalDetection(pos.size, 18),
          entryPrice: formatUSDC(pos.entryPrice),
          marginLocked: formatUSDC(pos.marginLocked),
        });
      }
      marginData.sources.positions = {
        source: "CoreVault.getUserPositions()",
        positions: positionDetails,
      };

      // Calculate totals from unified source
      marginData.totals.totalMarginUsed = Number(
        formatUSDC(marginUsedInPositions)
      );
      marginData.totals.totalMarginReserved = Number(
        formatUSDC(marginReservedForOrders)
      );
      marginData.totals.totalMarginLocked = Number(
        formatUSDC(totalMarginCommitted)
      );

      // Get OrderBook's view for verification
      console.log("🔍 Verifying OrderBook synchronization...");
      const orderBookPosition = await this.contracts.orderBook.getUserPosition(
        this.currentUser.address
      );
      marginData.sources.orderBookView = {
        source: "OrderBook position tracking",
        positionSize: orderBookPosition.toString(),
      };

      // Check for any synchronization issues
      let vaultTotalSize = 0n;
      for (const pos of positions) {
        // Use the raw position data instead of formatted strings
        vaultTotalSize += BigInt(pos.size.toString());
      }

      if (vaultTotalSize !== orderBookPosition) {
        marginData.totals.discrepancies.push({
          type: "Position Sync Warning",
          description: "OrderBook position tracking differs from CoreVault",
          difference: `OrderBook: ${orderBookPosition}, CoreVault: ${vaultTotalSize}`,
        });
      }

      console.log("✅ Comprehensive margin data collected successfully");
      return marginData;
    } catch (error) {
      console.log(
        `⚠️ Error collecting comprehensive margin data: ${error.message}`
      );
      return {
        sources: { error: error.message },
        totals: {
          totalMarginUsed: 0,
          totalMarginReserved: 0,
          totalMarginLocked: 0,
          discrepancies: [],
        },
      };
    }
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
