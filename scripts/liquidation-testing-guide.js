#!/usr/bin/env node

// liquidation-testing-guide.js - Liquidation Testing Guide
//
// 🎯 PURPOSE:
//   Interactive guide for testing liquidation functionality with filled order book
//   Provides step-by-step instructions and runs the appropriate scripts
//
// 🚀 USAGE:
//   node scripts/liquidation-testing-guide.js
//   npx hardhat run scripts/liquidation-testing-guide.js --network localhost

const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function runScript(scriptName, description) {
  console.log(colorText(`\n🚀 Running: ${description}`, colors.brightCyan));
  console.log(colorText(`   Script: ${scriptName}`, colors.dim));
  console.log(colorText(`   ${"=".repeat(60)}`, colors.dim));

  try {
    const { stdout, stderr } = await execAsync(
      `npx hardhat run ${scriptName} --network localhost`
    );

    if (stdout) {
      console.log(stdout);
    }
    if (stderr) {
      console.log(colorText(`   Warnings/Errors:`, colors.yellow));
      console.log(stderr);
    }

    console.log(
      colorText(`   ✅ ${description} completed successfully`, colors.green)
    );
  } catch (error) {
    console.log(colorText(`   ❌ ${description} failed:`, colors.red));
    console.log(error.message);
  }
}

async function liquidationTestingGuide() {
  console.log(colorText("\n🎯 LIQUIDATION TESTING GUIDE", colors.brightYellow));
  console.log(colorText("═".repeat(80), colors.brightYellow));

  console.log(
    colorText(
      "\n📋 This guide will help you test liquidation functionality with a filled order book.",
      colors.white
    )
  );

  console.log(colorText("\n🔧 Available Scripts:", colors.brightCyan));

  console.log(colorText("\n1. Small Scale Liquidity Filler", colors.white));
  console.log(
    colorText(
      "   • Fills order book with tiny prices ($0.005 - $0.03)",
      colors.dim
    )
  );
  console.log(
    colorText("   • Small order sizes (0.001 - 0.01 ALU)", colors.dim)
  );
  console.log(
    colorText("   • Perfect for testing with minimal capital", colors.dim)
  );

  console.log(colorText("\n2. Comprehensive Liquidity Filler", colors.white));
  console.log(
    colorText(
      "   • Fills order book with realistic prices ($0.50 - $2.00)",
      colors.dim
    )
  );
  console.log(colorText("   • Larger order sizes (0.1 - 10 ALU)", colors.dim));
  console.log(
    colorText("   • Creates a more realistic trading environment", colors.dim)
  );

  console.log(
    colorText("\n3. Liquidation Test with Filled Book", colors.white)
  );
  console.log(
    colorText("   • Creates positions using the filled order book", colors.dim)
  );
  console.log(
    colorText("   • Tests both long and short position liquidation", colors.dim)
  );
  console.log(
    colorText("   • Verifies liquidation mechanics work correctly", colors.dim)
  );

  console.log(colorText("\n4. Complete Liquidation Test Suite", colors.white));
  console.log(
    colorText(
      "   • End-to-end test: fill book + create positions + liquidate",
      colors.dim
    )
  );
  console.log(
    colorText("   • Comprehensive analysis of liquidation results", colors.dim)
  );
  console.log(colorText("   • Perfect for full system validation", colors.dim));

  console.log(colorText("\n5. Order Book Viewers", colors.white));
  console.log(
    colorText(
      "   • simple-orderbook-viewer.js - Basic order book display",
      colors.dim
    )
  );
  console.log(
    colorText(
      "   • live-orderbook-viewer.js - Advanced order book monitoring",
      colors.dim
    )
  );

  console.log(
    colorText("\n🎯 RECOMMENDED TESTING SEQUENCE:", colors.brightYellow)
  );

  console.log(
    colorText("\nOption A: Quick Test (Small Scale)", colors.brightCyan)
  );
  console.log(
    colorText("   1. node scripts/fill-orderbook-small.js", colors.white)
  );
  console.log(
    colorText(
      "   2. node scripts/test-liquidation-with-filled-book.js",
      colors.white
    )
  );
  console.log(
    colorText("   3. node scripts/simple-orderbook-viewer.js", colors.white)
  );

  console.log(colorText("\nOption B: Comprehensive Test", colors.brightCyan));
  console.log(
    colorText(
      "   1. node scripts/fill-orderbook-comprehensive.js",
      colors.white
    )
  );
  console.log(
    colorText("   2. node scripts/complete-liquidation-test.js", colors.white)
  );
  console.log(
    colorText("   3. node scripts/live-orderbook-viewer.js", colors.white)
  );

  console.log(colorText("\nOption C: All-in-One Test", colors.brightCyan));
  console.log(
    colorText("   1. node scripts/complete-liquidation-test.js", colors.white)
  );
  console.log(
    colorText("   2. node scripts/simple-orderbook-viewer.js", colors.white)
  );

  console.log(colorText("\n🔍 WHAT TO LOOK FOR:", colors.brightYellow));

  console.log(
    colorText("\n✅ Successful Liquidation Indicators:", colors.green)
  );
  console.log(
    colorText("   • Position size becomes 0 after liquidation", colors.white)
  );
  console.log(colorText("   • User's collateral decreases", colors.white));
  console.log(colorText("   • Liquidation transaction succeeds", colors.white));
  console.log(
    colorText(
      "   • Order book liquidity is consumed during liquidation",
      colors.white
    )
  );

  console.log(colorText("\n❌ Common Issues to Watch For:", colors.red));
  console.log(colorText("   • 'Insufficient liquidity' errors", colors.white));
  console.log(
    colorText("   • 'Position not liquidatable' errors", colors.white)
  );
  console.log(
    colorText("   • Orders not executing due to price mismatches", colors.white)
  );
  console.log(
    colorText("   • Collateral not being properly confiscated", colors.white)
  );

  console.log(colorText("\n🛠️  TROUBLESHOOTING TIPS:", colors.brightYellow));

  console.log(colorText("\n1. If orders aren't executing:", colors.white));
  console.log(
    colorText(
      "   • Check that order book has liquidity at the right price levels",
      colors.dim
    )
  );
  console.log(
    colorText(
      "   • Verify mark price is within the order book range",
      colors.dim
    )
  );
  console.log(
    colorText("   • Ensure users have sufficient collateral", colors.dim)
  );

  console.log(colorText("\n2. If liquidation isn't working:", colors.white));
  console.log(
    colorText("   • Check that position value > collateral value", colors.dim)
  );
  console.log(
    colorText("   • Verify liquidation conditions are met", colors.dim)
  );
  console.log(
    colorText("   • Ensure liquidator has proper permissions", colors.dim)
  );

  console.log(colorText("\n3. If you see authorization errors:", colors.white));
  console.log(
    colorText(
      "   • Run the deployment script to set up proper roles",
      colors.dim
    )
  );
  console.log(
    colorText(
      "   • Check that OrderBook has ORDERBOOK_ROLE on Vault",
      colors.dim
    )
  );
  console.log(
    colorText("   • Verify all contracts are properly connected", colors.dim)
  );

  console.log(colorText("\n🎉 READY TO TEST!", colors.brightGreen));

  console.log(
    colorText(
      "\nChoose your testing approach and run the appropriate scripts.",
      colors.white
    )
  );

  console.log(colorText("\nFor the quickest test, run:", colors.brightCyan));
  console.log(
    colorText("   node scripts/complete-liquidation-test.js", colors.white)
  );

  console.log(colorText("\n" + "=".repeat(80), colors.brightYellow));
}

// Run the guide
liquidationTestingGuide().catch(console.error);
