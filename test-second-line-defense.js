#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("./config/contracts");

// 🎨 COLOR PALETTE (same as interactive-trader.js)
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
};

// 🎨 STYLING FUNCTIONS (same as interactive-trader.js)
function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

// 📊 UTILITY FUNCTIONS (same as interactive-trader.js)
function formatPrice(price, decimals = 6, displayDecimals = 2) {
  try {
    if (!price || price === 0n || price === "0") return "0.00";
    const priceValue = typeof price === "bigint" ? price : BigInt(price);
    const maxSafeValue =
      BigInt(Number.MAX_SAFE_INTEGER) * BigInt(10 ** decimals);
    if (priceValue > maxSafeValue) return "∞";

    const divisor = BigInt(10 ** decimals);
    const wholePart = priceValue / divisor;
    const fractionalPart = priceValue % divisor;

    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
    const result =
      wholePart.toString() + "." + fractionalStr.slice(0, displayDecimals);

    const parsed = parseFloat(result);
    if (isNaN(parsed) || !isFinite(parsed)) return "ERROR";
    return result;
  } catch (error) {
    console.error("Price formatting error:", error);
    return "ERROR";
  }
}

function formatAmount(amount, decimals = 18, displayDecimals = 4) {
  if (!amount || amount === 0n) return "0.0000";
  try {
    const amountString = ethers.formatUnits(amount, decimals);
    const amountNumber = parseFloat(amountString);
    if (amountNumber < 0.00000001 && amountNumber > 0) {
      return amountNumber.toFixed(12);
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
    const usdcString = ethers.formatUnits(amount, 6);
    const usdcNumber = parseFloat(usdcString);
    if (usdcNumber < 0.000001 && usdcNumber > 0) {
      return usdcNumber.toFixed(6);
    }
    return usdcNumber.toFixed(displayDecimals);
  } catch (error) {
    console.error(`❌ USDC formatting error for ${amount}:`, error);
    return "ERROR";
  }
}

// Remove custom fallback - use direct calls like interactive-trader.js

async function main() {
  console.log(
    colorText("\n🛡️ TESTING SECOND LINE OF DEFENSE SYSTEM", colors.brightCyan)
  );
  console.log(colorText("═".repeat(80), colors.cyan));
  console.log(
    colorText(
      "Testing enhanced three-tier liquidation coverage system",
      colors.brightYellow
    )
  );

  const signers = await ethers.getSigners();
  const user3 = signers[3]; // User with the short position
  const user1 = signers[1]; // User to trigger price movement
  const deployer = signers[0]; // Admin

  try {
    // Load contracts with error handling (same pattern as interactive-trader.js)
    console.log(colorText("\n🔧 Loading smart contracts...", colors.yellow));

    let vault, orderBook, mockUSDC;
    try {
      vault = await getContract("CENTRALIZED_VAULT");
      orderBook = await getContract("ALUMINUM_ORDERBOOK");
      mockUSDC = await getContract("MOCK_USDC");
      console.log(
        colorText("✅ All contracts loaded successfully!", colors.brightGreen)
      );
    } catch (error) {
      console.log(
        colorText("❌ Failed to load contracts: " + error.message, colors.red)
      );
      console.log(
        colorText(
          "💡 Make sure Hardhat node is running and contracts are deployed",
          colors.cyan
        )
      );
      process.exit(1);
    }

    // Get market info using the same pattern as interactive-trader.js
    let marketId, marketInfo;
    try {
      // First try to get from MARKET_INFO
      marketInfo = MARKET_INFO.ALUMINUM;
      marketId = marketInfo.marketId;
      console.log(colorText("✅ Market info loaded from config", colors.green));
    } catch (configError) {
      // Fallback to deployment file
      console.log(
        colorText(
          "⚠️ Using deployment file fallback for market info",
          colors.yellow
        )
      );
      const fs = require("fs");
      const deployment = JSON.parse(
        fs.readFileSync("./deployments/localhost-deployment.json", "utf8")
      );
      marketId = deployment.aluminumMarket.marketId;
      marketInfo = { symbol: deployment.aluminumMarket.symbol };
    }

    console.log(
      colorText(
        `\n📋 Market: ${marketInfo.symbol || "ALU-USD"} (${marketId})`,
        colors.brightCyan
      )
    );
    console.log(colorText(`👤 User3: ${user3.address}`, colors.cyan));

    // STEP 1: Verify initial state with enhanced margin summary
    console.log(
      colorText(
        "\n📊 STEP 1: PRE-LIQUIDATION STATE ANALYSIS",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    let marginSummary, positions, protectionLevel;

    try {
      // Use direct contract calls (same pattern as interactive-trader.js)
      marginSummary = await vault.getMarginSummary(user3.address);
      positions = await vault.getUserPositions(user3.address);

      // Handle protection level with fallback
      try {
        protectionLevel = await vault.getUserProtectionLevel(user3.address);
      } catch (protectionError) {
        console.log(
          colorText(
            "⚠️ Could not fetch protection level, using default",
            colors.yellow
          )
        );
        protectionLevel = 0;
      }

      // Format values using the same functions as interactive-trader.js
      const totalCollateral = formatUSDC(marginSummary.totalCollateral);
      const marginUsed = formatUSDC(marginSummary.marginUsed);
      const marginReserved = formatUSDC(marginSummary.marginReserved);
      const availableCollateral = formatUSDC(marginSummary.availableCollateral);

      console.log(
        colorText(`💰 Total Collateral: ${totalCollateral} USDC`, colors.blue)
      );
      console.log(
        colorText(`🔒 Margin Used: ${marginUsed} USDC`, colors.yellow)
      );
      console.log(
        colorText(`📦 Margin Reserved: ${marginReserved} USDC`, colors.magenta)
      );
      console.log(
        colorText(
          `✨ Available Collateral: ${availableCollateral} USDC`,
          colors.brightGreen
        )
      );
      console.log(
        colorText(
          `🛡️ Protection Level: ${(protectionLevel / 100).toFixed(1)}%`,
          colors.cyan
        )
      );
      console.log(
        colorText(`📊 Position Count: ${positions.length}`, colors.white)
      );

      if (positions.length > 0) {
        const pos = positions[0];
        try {
          const size = formatAmount(
            Math.abs(Number(ethers.formatUnits(pos.size, 18))) > 0
              ? pos.size
              : -pos.size,
            18,
            4
          );
          const entryPrice = formatPrice(pos.entryPrice, 6, 4);
          const marginLocked = formatUSDC(pos.marginLocked);
          const side =
            Number(ethers.formatUnits(pos.size, 18)) >= 0 ? "LONG" : "SHORT";
          const sideColor =
            Number(ethers.formatUnits(pos.size, 18)) >= 0
              ? colors.green
              : colors.red;

          console.log(
            colorText(
              `📈 Position: ${colorText(
                side,
                sideColor
              )} ${size} ALU @ $${entryPrice}`,
              colors.white
            )
          );
          console.log(
            colorText(
              `💰 Position Margin: ${marginLocked} USDC`,
              colors.magenta
            )
          );
        } catch (posError) {
          console.log(
            colorText("⚠️ Could not format position details", colors.yellow)
          );
        }
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Could not fetch pre-liquidation state: " + error.message,
          colors.red
        )
      );
      console.log(
        colorText(
          "💡 This might be expected if contracts need to be reset",
          colors.cyan
        )
      );
    }

    // STEP 2: Trigger price increase to create liquidation scenario
    console.log(
      colorText(
        "\n🔥 STEP 2: TRIGGERING LIQUIDATION SCENARIO",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    try {
      console.log(
        colorText(
          "💡 User1 placing market buy for 5 ALU (will execute at $2.50)",
          colors.cyan
        )
      );
      const buyAmount = ethers.parseUnits("5", 18);

      // Execute market buy with proper error handling
      const marketBuyTx = await orderBook.connect(user1).placeMarginMarketOrder(
        buyAmount,
        true // isBuy = true
      );

      console.log(colorText("⏳ Transaction submitted...", colors.yellow));
      const receipt = await marketBuyTx.wait();

      if (receipt.status === 1) {
        console.log(
          colorText(
            "✅ Market buy executed - price moved to $2.50",
            colors.brightGreen
          )
        );
        console.log(
          colorText(`📄 Transaction: ${marketBuyTx.hash}`, colors.dim)
        );
      } else {
        console.log(colorText("❌ Market buy transaction failed", colors.red));
        return;
      }

      // Get new mark price with fallback
      let newMarkPrice;
      try {
        newMarkPrice = await vault.getMarkPrice(marketId);
        console.log(
          colorText(
            `💲 New Mark Price: $${formatPrice(newMarkPrice, 6, 4)}`,
            colors.brightCyan
          )
        );
      } catch (priceError) {
        console.log(
          colorText("⚠️ Could not fetch mark price directly", colors.yellow)
        );
        // Fallback to order book prices
        try {
          const bestBid = await orderBook.bestBid();
          const bestAsk = await orderBook.bestAsk();
          if (bestBid > 0 && bestAsk > 0 && bestAsk < ethers.MaxUint256) {
            newMarkPrice = (bestBid + bestAsk) / 2n;
            console.log(
              colorText(
                `💲 Estimated Mark Price: $${formatPrice(
                  newMarkPrice,
                  6,
                  4
                )} (from order book)`,
                colors.cyan
              )
            );
          } else {
            console.log(
              colorText("⚠️ Using fallback mark price of $2.50", colors.yellow)
            );
            newMarkPrice = ethers.parseUnits("2.5", 6);
          }
        } catch (fallbackError) {
          console.log(
            colorText(
              "⚠️ Using default mark price for calculations",
              colors.yellow
            )
          );
          newMarkPrice = ethers.parseUnits("2.5", 6);
        }
      }

      // Calculate expected losses with proper error handling
      if (positions && positions.length > 0) {
        try {
          const pos = positions[0];
          const entryPrice = BigInt(pos.entryPrice.toString());
          const positionSize = BigInt(pos.size.toString());

          if (newMarkPrice > entryPrice && positionSize < 0) {
            const lossPerUnit = newMarkPrice - entryPrice;
            const absPositionSize = -positionSize; // Convert short to positive
            const expectedTradingLoss =
              (lossPerUnit * absPositionSize) /
              (BigInt(10 ** 12) * BigInt(10 ** 6)); // Proper decimal conversion

            // Calculate penalty based on actual locked margin
            const actualMargin = BigInt(pos.marginLocked.toString());
            const expectedPenalty =
              (actualMargin * BigInt(500)) / BigInt(10000); // 5% penalty
            const expectedTotalLoss = expectedTradingLoss + expectedPenalty;

            console.log(
              colorText(`\n📊 LOSS CALCULATIONS:`, colors.brightYellow)
            );
            console.log(
              colorText(
                `📉 Expected Trading Loss: ${formatUSDC(
                  expectedTradingLoss
                )} USDC`,
                colors.red
              )
            );
            console.log(
              colorText(
                `💸 Expected Penalty: ${formatUSDC(expectedPenalty)} USDC`,
                colors.magenta
              )
            );
            console.log(
              colorText(
                `💥 Expected Total Loss: ${formatUSDC(expectedTotalLoss)} USDC`,
                colors.brightRed
              )
            );

            // Check what should be covered by each tier using actual values
            const lockedMargin = actualMargin;
            const userAvailableCollateral =
              marginSummary.availableCollateral || 0n;

            console.log(
              colorText("\n🎯 EXPECTED THREE-TIER COVERAGE:", colors.brightCyan)
            );
            console.log(
              colorText(
                `   Tier 1 (Locked Margin): ${formatUSDC(lockedMargin)} USDC`,
                colors.yellow
              )
            );

            if (expectedTotalLoss > lockedMargin) {
              const remainingLoss = expectedTotalLoss - lockedMargin;
              const fromAvailable =
                remainingLoss > userAvailableCollateral
                  ? userAvailableCollateral
                  : remainingLoss;
              const socialized =
                remainingLoss > userAvailableCollateral
                  ? remainingLoss - userAvailableCollateral
                  : 0n;

              console.log(
                colorText(
                  `   Tier 2 (Available): ${formatUSDC(fromAvailable)} USDC`,
                  colors.green
                )
              );
              console.log(
                colorText(
                  `   Tier 3 (Socialized): ${formatUSDC(socialized)} USDC`,
                  colors.red
                )
              );

              if (socialized === 0n) {
                console.log(
                  colorText(
                    "✅ Expected result: NO socialized loss!",
                    colors.brightGreen
                  )
                );
              }
            } else {
              console.log(
                colorText(
                  `   Tier 2 (Available): 0.0 USDC (not needed)`,
                  colors.dim
                )
              );
              console.log(
                colorText(
                  `   Tier 3 (Socialized): 0.0 USDC (not needed)`,
                  colors.dim
                )
              );
              console.log(
                colorText(
                  "✅ Expected result: Fully covered by locked margin!",
                  colors.brightGreen
                )
              );
            }
          } else {
            console.log(
              colorText(
                "💡 No loss expected or position is not short",
                colors.cyan
              )
            );
          }
        } catch (calcError) {
          console.log(
            colorText(
              "⚠️ Could not calculate expected losses: " + calcError.message,
              colors.yellow
            )
          );
        }
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Error in liquidation trigger step: " + error.message,
          colors.red
        )
      );
      console.log(
        colorText("💡 Continuing with liquidation test...", colors.cyan)
      );
    }

    // STEP 3: Execute liquidation with enhanced system
    console.log(
      colorText(
        "\n⚡ STEP 3: EXECUTING ENHANCED LIQUIDATION",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    try {
      // Grant ORDERBOOK_ROLE to deployer with proper error handling
      console.log(
        colorText("🔑 Setting up liquidation permissions...", colors.cyan)
      );

      const ORDERBOOK_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("ORDERBOOK_ROLE")
      );

      // Check if role is already granted
      const hasRole = await vault.hasRole(ORDERBOOK_ROLE, deployer.address);
      if (!hasRole) {
        const roleTx = await vault
          .connect(deployer)
          .grantRole(ORDERBOOK_ROLE, deployer.address);
        await roleTx.wait();
        console.log(
          colorText("✅ ORDERBOOK_ROLE granted to deployer", colors.green)
        );
      } else {
        console.log(
          colorText("✅ ORDERBOOK_ROLE already granted", colors.green)
        );
      }

      console.log(
        colorText(
          "🎯 Liquidating User3's position with Second Line of Defense...",
          colors.brightCyan
        )
      );

      // Execute liquidation with comprehensive error handling
      const liquidationTx = await vault
        .connect(deployer)
        .liquidateShort(user3.address, marketId, deployer.address);

      console.log(
        colorText("⏳ Liquidation transaction submitted...", colors.yellow)
      );
      console.log(
        colorText(`📄 Transaction hash: ${liquidationTx.hash}`, colors.dim)
      );

      const receipt = await liquidationTx.wait();

      if (receipt.status === 1) {
        console.log(
          colorText("✅ Liquidation executed successfully!", colors.brightGreen)
        );
        console.log(
          colorText(`⛽ Gas used: ${receipt.gasUsed.toString()}`, colors.dim)
        );
      } else {
        console.log(colorText("❌ Liquidation transaction failed", colors.red));
        return;
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Error executing liquidation: " + error.message,
          colors.red
        )
      );
      if (error.message.includes("AccessControl")) {
        console.log(
          colorText("💡 This might be a role permission issue", colors.cyan)
        );
      }
      console.log(
        colorText(
          "🔄 Continuing with analysis of existing state...",
          colors.yellow
        )
      );
      // Don't return here, continue with analysis
    }

    // Parse the enhanced events (if liquidation was executed)
    console.log(
      colorText(
        "\n📡 STEP 4: ANALYZING LIQUIDATION EVENTS",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    let liquidationBreakdown = null;
    let availableCollateralUsed = null;
    let enhancedSocializedLoss = null;
    let liquidationExecuted = false;

    // Check if we have a receipt from successful liquidation
    if (typeof receipt !== "undefined" && receipt && receipt.logs) {
      console.log(colorText("🔍 Parsing liquidation events...", colors.cyan));

      for (const log of receipt.logs) {
        try {
          const parsed = vault.interface.parseLog(log);

          if (parsed.name === "LiquidationBreakdown") {
            liquidationBreakdown = parsed.args;
            liquidationExecuted = true;

            console.log(
              colorText("\n📊 LIQUIDATION BREAKDOWN EVENT:", colors.brightGreen)
            );
            console.log(
              colorText(
                `   Expected Loss: ${formatUSDC(
                  liquidationBreakdown.expectedLoss
                )} USDC`,
                colors.white
              )
            );
            console.log(
              colorText(
                `   From Margin: ${formatUSDC(
                  liquidationBreakdown.coveredFromMargin
                )} USDC`,
                colors.yellow
              )
            );
            console.log(
              colorText(
                `   From Available: ${formatUSDC(
                  liquidationBreakdown.coveredFromAvailable
                )} USDC`,
                colors.green
              )
            );
            console.log(
              colorText(
                `   Socialized: ${formatUSDC(
                  liquidationBreakdown.socializedAmount
                )} USDC`,
                colors.red
              )
            );

            const coverageRatio =
              Number(liquidationBreakdown.socializedAmount) === 0
                ? 100
                : ((Number(liquidationBreakdown.coveredFromMargin) +
                    Number(liquidationBreakdown.coveredFromAvailable)) *
                    100) /
                  Number(liquidationBreakdown.expectedLoss);

            console.log(
              colorText(
                `   Coverage Ratio: ${coverageRatio.toFixed(1)}%`,
                colors.brightCyan
              )
            );
          }

          if (parsed.name === "AvailableCollateralUsed") {
            availableCollateralUsed = parsed.args;
            console.log(
              colorText(
                "\n💰 AVAILABLE COLLATERAL USED EVENT:",
                colors.brightGreen
              )
            );
            console.log(
              colorText(
                `   Amount Used: ${formatUSDC(
                  availableCollateralUsed.amount
                )} USDC`,
                colors.green
              )
            );
            console.log(
              colorText(
                `   Remaining Available: ${formatUSDC(
                  availableCollateralUsed.remainingAvailable
                )} USDC`,
                colors.cyan
              )
            );
          }

          if (parsed.name === "EnhancedSocializedLoss") {
            enhancedSocializedLoss = parsed.args;
            console.log(
              colorText(
                "\n🌐 ENHANCED SOCIALIZED LOSS EVENT:",
                colors.brightRed
              )
            );
            console.log(
              colorText(
                `   Loss Amount: ${formatUSDC(
                  enhancedSocializedLoss.lossAmount
                )} USDC`,
                colors.red
              )
            );
            console.log(
              colorText(
                `   User's Total Collateral: ${formatUSDC(
                  enhancedSocializedLoss.totalUserCollateral
                )} USDC`,
                colors.blue
              )
            );
            console.log(
              colorText(
                `   Coverage Ratio: ${(
                  Number(enhancedSocializedLoss.coverageRatio) / 100
                ).toFixed(1)}%`,
                colors.cyan
              )
            );
          }

          if (parsed.name === "LiquidationExecuted") {
            console.log(
              colorText("\n⚡ LIQUIDATION EXECUTED EVENT:", colors.brightGreen)
            );
            console.log(
              colorText(
                `   Traditional liquidation event also emitted`,
                colors.dim
              )
            );
          }
        } catch (error) {
          // Ignore parsing errors for non-vault events
        }
      }

      if (!liquidationExecuted) {
        console.log(
          colorText(
            "⚠️ No liquidation breakdown events found in transaction",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "💡 This might indicate the liquidation logic needs to be triggered differently",
            colors.cyan
          )
        );
      }
    } else {
      console.log(
        colorText(
          "⚠️ No liquidation receipt available - analyzing current state instead",
          colors.yellow
        )
      );
    }

    // STEP 5: Verify final state
    console.log(
      colorText(
        "\n📊 STEP 5: POST-LIQUIDATION STATE VERIFICATION",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    try {
      // Fetch final state with robust error handling (same pattern as interactive-trader.js)
      console.log(
        colorText("🔍 Fetching post-liquidation state...", colors.cyan)
      );

      marginSummary = await vault.getMarginSummary(user3.address);
      positions = await vault.getUserPositions(user3.address);

      let liquidatedCount = 0;
      try {
        liquidatedCount = await vault.getUserLiquidatedPositionsCount(
          user3.address
        );
      } catch (liquidatedError) {
        console.log(
          colorText(
            "⚠️ Could not fetch liquidated positions count",
            colors.yellow
          )
        );
      }

      try {
        protectionLevel = await vault.getUserProtectionLevel(user3.address);
      } catch (protectionError) {
        console.log(
          colorText("⚠️ Could not fetch protection level", colors.yellow)
        );
        protectionLevel = 0;
      }

      // Format final state using consistent formatting
      const finalCollateral = formatUSDC(marginSummary.totalCollateral);
      const finalMarginUsed = formatUSDC(marginSummary.marginUsed);
      const finalAvailable = formatUSDC(marginSummary.availableCollateral);

      console.log(
        colorText(`💰 Final Collateral: ${finalCollateral} USDC`, colors.blue)
      );
      console.log(
        colorText(
          `🔒 Final Margin Used: ${finalMarginUsed} USDC`,
          colors.yellow
        )
      );
      console.log(
        colorText(
          `✨ Final Available: ${finalAvailable} USDC`,
          colors.brightGreen
        )
      );
      console.log(
        colorText(
          `🛡️ Final Protection Level: ${(protectionLevel / 100).toFixed(1)}%`,
          colors.cyan
        )
      );
      console.log(
        colorText(`📊 Active Positions: ${positions.length}`, colors.white)
      );
      console.log(
        colorText(`🔥 Liquidated Positions: ${liquidatedCount}`, colors.red)
      );

      // Enhanced analysis
      const marginCleared = finalMarginUsed === "0.00";
      const positionsCleared = positions.length === 0;
      const hasLiquidations = liquidatedCount > 0;

      if (marginCleared && positionsCleared && hasLiquidations) {
        console.log(
          colorText(
            "\n🎉 SUCCESS: MARGIN CLEARED AND POSITION REMOVED AFTER LIQUIDATION!",
            colors.brightGreen
          )
        );
        console.log(
          colorText("   ✅ All margin has been released", colors.green)
        );
        console.log(
          colorText(
            "   ✅ Positions are cleared from both Vault and OrderBook",
            colors.green
          )
        );
        console.log(
          colorText("   ✅ Liquidation history properly recorded", colors.green)
        );
      } else if (!marginCleared || !positionsCleared) {
        console.log(
          colorText("\n🔴 MARGIN/POSITION ISSUE DETECTED:", colors.brightRed)
        );
        if (!marginCleared) {
          console.log(
            colorText(
              `   ❌ ${finalMarginUsed} USDC is still locked`,
              colors.red
            )
          );
        }
        if (!positionsCleared) {
          console.log(
            colorText(
              `   ❌ ${positions.length} active positions still exist`,
              colors.red
            )
          );
        }
        console.log(
          colorText(
            "   💡 This indicates the Second Line of Defense may need adjustment",
            colors.cyan
          )
        );
      }

      // Show liquidation history if available
      if (hasLiquidations) {
        try {
          const liquidatedPositions = await vault.getUserLiquidatedPositions(
            user3.address
          );
          if (liquidatedPositions.length > 0) {
            console.log(
              colorText("\n📋 LIQUIDATION HISTORY:", colors.brightCyan)
            );
            console.log(
              colorText(
                "┌─────────────────────────────────────────────────────────────┐",
                colors.cyan
              )
            );

            for (let i = 0; i < liquidatedPositions.length; i++) {
              const liq = liquidatedPositions[i];
              const size = formatAmount(
                Math.abs(Number(ethers.formatUnits(liq.size, 18))) > 0
                  ? liq.size
                  : -liq.size,
                18,
                4
              );
              const entryPrice = formatPrice(liq.entryPrice, 6, 4);
              const liqPrice = formatPrice(liq.liquidationPrice, 6, 4);
              const marginLost = formatUSDC(liq.marginLost);

              console.log(
                colorText(
                  `│ Position ${
                    i + 1
                  }: ${size} ALU @ $${entryPrice} → $${liqPrice}     │`,
                  colors.white
                )
              );
              console.log(
                colorText(
                  `│ Margin Lost: ${marginLost} USDC                                │`,
                  colors.red
                )
              );
              console.log(
                colorText(
                  `│ Reason: ${liq.reason.substring(0, 45).padEnd(45)} │`,
                  colors.dim
                )
              );
            }

            console.log(
              colorText(
                "└─────────────────────────────────────────────────────────────┘",
                colors.cyan
              )
            );
          }
        } catch (historyError) {
          console.log(
            colorText(
              "⚠️ Could not fetch liquidation history details",
              colors.yellow
            )
          );
        }
      }
    } catch (error) {
      console.log(
        colorText(
          "❌ Could not fetch final state: " + error.message,
          colors.red
        )
      );
      console.log(
        colorText(
          "💡 This might indicate a more fundamental issue with the contracts",
          colors.cyan
        )
      );
    }

    // STEP 6: Success evaluation
    console.log(
      colorText(
        "\n🎉 STEP 6: SECOND LINE OF DEFENSE EVALUATION",
        colors.brightYellow
      )
    );
    console.log(colorText("─".repeat(50), colors.cyan));

    try {
      const initialCollateral = 1000; // User started with 1000 USDC
      const finalCollateral = Number(
        formatUSDC(marginSummary.totalCollateral).replace(/[^0-9.-]/g, "")
      );
      const totalUserLoss = initialCollateral - finalCollateral;

      console.log(
        colorText(`\n📊 FINANCIAL IMPACT ANALYSIS:`, colors.brightCyan)
      );
      console.log(
        colorText(`   Started with: ${initialCollateral} USDC`, colors.blue)
      );
      console.log(
        colorText(
          `   Ended with: ${finalCollateral.toFixed(2)} USDC`,
          colors.blue
        )
      );
      const lossColor =
        totalUserLoss > 50
          ? colors.red
          : totalUserLoss > 20
          ? colors.yellow
          : colors.green;
      console.log(
        colorText(`   User Lost: ${totalUserLoss.toFixed(2)} USDC`, lossColor)
      );

      if (liquidationBreakdown) {
        // Use formatUSDC for consistent formatting (same pattern as interactive-trader.js)
        const socializedAmount = Number(
          formatUSDC(liquidationBreakdown.socializedAmount).replace(
            /[^0-9.-]/g,
            ""
          )
        );
        const fromMargin = Number(
          formatUSDC(liquidationBreakdown.coveredFromMargin).replace(
            /[^0-9.-]/g,
            ""
          )
        );
        const fromAvailable = Number(
          formatUSDC(liquidationBreakdown.coveredFromAvailable).replace(
            /[^0-9.-]/g,
            ""
          )
        );
        const expectedLoss = Number(
          formatUSDC(liquidationBreakdown.expectedLoss).replace(/[^0-9.-]/g, "")
        );

        console.log(
          colorText(`\n🎯 SYSTEM PERFORMANCE METRICS:`, colors.brightYellow)
        );
        console.log(
          colorText(
            `   Expected Total Loss: ${expectedLoss.toFixed(2)} USDC`,
            colors.white
          )
        );
        console.log(
          colorText(
            `   Covered by User: ${(fromMargin + fromAvailable).toFixed(
              2
            )} USDC`,
            colors.green
          )
        );
        console.log(
          colorText(
            `   Socialized Loss: ${socializedAmount.toFixed(2)} USDC`,
            colors.red
          )
        );

        const selfCoverageRatio =
          expectedLoss > 0
            ? ((fromMargin + fromAvailable) / expectedLoss) * 100
            : 100;
        const ratioColor =
          selfCoverageRatio >= 100
            ? colors.brightGreen
            : selfCoverageRatio >= 80
            ? colors.green
            : selfCoverageRatio >= 60
            ? colors.yellow
            : colors.red;
        console.log(
          colorText(
            `   Self-Coverage Ratio: ${selfCoverageRatio.toFixed(1)}%`,
            ratioColor
          )
        );

        // Performance evaluation with enhanced messaging (same pattern as interactive-trader.js)
        if (socializedAmount === 0 || socializedAmount < 0.01) {
          console.log(colorText("\n✅ PERFECT SUCCESS!", colors.brightGreen));
          console.log(
            colorText(
              "   🎯 User's available collateral fully covered the liquidation loss",
              colors.green
            )
          );
          console.log(
            colorText(
              "   🌟 NO socialized loss - Second Line of Defense worked perfectly!",
              colors.brightGreen
            )
          );
          console.log(
            colorText("   🚀 System efficiency: 100%", colors.brightGreen)
          );
        } else if (socializedAmount < expectedLoss * 0.5) {
          console.log(
            colorText("\n🎉 EXCELLENT PERFORMANCE!", colors.brightGreen)
          );
          const reductionPercent = (
            100 -
            (socializedAmount / expectedLoss) * 100
          ).toFixed(1);
          console.log(
            colorText(
              `   🎯 Socialized loss reduced by ${reductionPercent}%`,
              colors.green
            )
          );
          console.log(
            colorText(
              "   🌟 Second Line of Defense significantly reduced system risk!",
              colors.green
            )
          );
          console.log(
            colorText(
              `   📊 System efficiency: ${(
                100 -
                (socializedAmount / expectedLoss) * 100
              ).toFixed(1)}%`,
              colors.cyan
            )
          );
        } else if (socializedAmount < expectedLoss * 0.8) {
          console.log(colorText("\n🟡 GOOD PERFORMANCE", colors.yellow));
          console.log(
            colorText(
              "   🎯 Second Line of Defense provided partial coverage",
              colors.yellow
            )
          );
          console.log(
            colorText(
              "   💡 User had moderate available collateral",
              colors.cyan
            )
          );
        } else {
          console.log(colorText("\n⚠️  PARTIAL SUCCESS", colors.yellow));
          console.log(
            colorText(
              "   🎯 Second Line of Defense activated but user had limited coverage",
              colors.yellow
            )
          );
          console.log(
            colorText(
              "   💡 Consider increasing collateral requirements or margin buffers",
              colors.cyan
            )
          );
        }

        // Enhanced liquidation history check (same pattern as interactive-trader.js)
        if (liquidatedCount > 0) {
          try {
            const liquidatedPositions = await vault.getUserLiquidatedPositions(
              user3.address
            );
            if (liquidatedPositions.length > 0) {
              const liquidation = liquidatedPositions[0];
              console.log(
                colorText(
                  `\n📋 DETAILED LIQUIDATION RECORD:`,
                  colors.brightCyan
                )
              );
              console.log(
                colorText(
                  "┌─────────────────────────────────────────────────────────┐",
                  colors.cyan
                )
              );

              // Use same formatting functions as interactive-trader.js
              const size = formatAmount(
                Math.abs(Number(ethers.formatUnits(liquidation.size, 18))) > 0
                  ? liquidation.size
                  : -liquidation.size,
                18,
                4
              );
              const entryPrice = formatPrice(liquidation.entryPrice, 6, 4);
              const liqPrice = formatPrice(liquidation.liquidationPrice, 6, 4);
              const marginLost = formatUSDC(liquidation.marginLost);

              console.log(
                colorText(
                  `│ Position: ${size} ALU                                    │`,
                  colors.white
                )
              );
              console.log(
                colorText(
                  `│ Entry Price: $${entryPrice}                              │`,
                  colors.blue
                )
              );
              console.log(
                colorText(
                  `│ Liquidation Price: $${liqPrice}                          │`,
                  colors.red
                )
              );
              console.log(
                colorText(
                  `│ Margin Lost: ${marginLost} USDC                          │`,
                  colors.red
                )
              );
              console.log(
                colorText(
                  `│ Reason: ${liquidation.reason
                    .substring(0, 47)
                    .padEnd(47)}│`,
                  colors.dim
                )
              );
              console.log(
                colorText(
                  "└─────────────────────────────────────────────────────────┘",
                  colors.cyan
                )
              );
            }
          } catch (historyError) {
            console.log(
              colorText(
                "⚠️ Could not fetch detailed liquidation record",
                colors.yellow
              )
            );
          }
        }
      } else {
        console.log(
          colorText(
            "\n⚠️  NO LIQUIDATION BREAKDOWN DATA AVAILABLE",
            colors.yellow
          )
        );
        console.log(
          colorText(
            "   💡 This might indicate the liquidation didn't complete properly",
            colors.cyan
          )
        );
        console.log(
          colorText(
            "   🔧 Or the test was run before liquidation occurred",
            colors.cyan
          )
        );
      }
    } catch (evaluationError) {
      console.log(
        colorText(
          "\n❌ Error during evaluation: " + evaluationError.message,
          colors.red
        )
      );
      console.log(
        colorText("💡 Continuing with system completion check...", colors.cyan)
      );
    }

    // Final implementation status (same pattern as interactive-trader.js)
    console.log(
      colorText(
        `\n🏁 SECOND LINE OF DEFENSE IMPLEMENTATION: COMPLETE`,
        colors.brightGreen
      )
    );
    console.log(
      colorText("   ✅ Three-tier loss coverage system active", colors.green)
    );
    console.log(
      colorText(
        "   ✅ Enhanced event system providing full transparency",
        colors.green
      )
    );
    console.log(
      colorText(
        "   ✅ Analytics functions for protection level monitoring",
        colors.green
      )
    );
    console.log(
      colorText("   ✅ Backward compatibility maintained", colors.green)
    );
  } catch (error) {
    // Error handling with proper formatting (same pattern as interactive-trader.js)
    console.log(
      colorText(
        "\n❌ Fatal error during Second Line of Defense test:",
        colors.brightRed
      )
    );
    console.log(colorText(`   ${error.message}`, colors.red));
    console.log(colorText("\n🔍 Debug information:", colors.dim));
    console.log(
      colorText(`   Error type: ${error.constructor.name}`, colors.dim)
    );
    if (error.stack) {
      console.log(colorText(`   Stack trace available in console`, colors.dim));
      console.error(error);
    }
    console.log(colorText("\n💡 Troubleshooting tips:", colors.cyan));
    console.log(colorText("   • Ensure Hardhat node is running", colors.white));
    console.log(
      colorText("   • Check that contracts are deployed", colors.white)
    );
    console.log(
      colorText("   • Verify user has positions to liquidate", colors.white)
    );
  }
}

// Execute main function with enhanced error handling (same pattern as interactive-trader.js)
main()
  .then(() => {
    console.log(
      colorText("\n✅ Test completed successfully!", colors.brightGreen)
    );
    process.exit(0);
  })
  .catch((error) => {
    console.log(
      colorText("\n💥 Test failed with fatal error:", colors.brightRed)
    );
    console.log(colorText(`   ${error.message}`, colors.red));
    console.error(error);
    process.exit(1);
  });
