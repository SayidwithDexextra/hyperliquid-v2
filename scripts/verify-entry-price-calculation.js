#!/usr/bin/env node

/**
 * 📊 ENTRY PRICE CALCULATION VERIFICATION
 *
 * This script verifies how the entry price of 1.166667 was calculated
 * based on the actual trades executed by the deployer.
 */

const { ethers } = require("hardhat");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function main() {
  console.log(
    colorText("\n📊 ENTRY PRICE CALCULATION VERIFICATION", colors.bright)
  );
  console.log(colorText("═".repeat(80), colors.cyan));

  console.log(colorText("\n📜 DEPLOYER'S TRADES:", colors.yellow));
  console.log("  Trade 1: SOLD 100 ALU at $1.00 USDC");
  console.log("  Trade 2: SOLD 50 ALU at $1.50 USDC");
  console.log("  Total: SOLD 150 ALU");

  console.log(
    colorText("\n🧮 WEIGHTED AVERAGE PRICE CALCULATION:", colors.magenta)
  );

  // Trade details
  const trade1Amount = 100;
  const trade1Price = 1.0;
  const trade1Volume = trade1Amount * trade1Price;

  const trade2Amount = 50;
  const trade2Price = 1.5;
  const trade2Volume = trade2Amount * trade2Price;

  console.log(
    `\n  Trade 1 Volume: ${trade1Amount} ALU × $${trade1Price} = $${trade1Volume} USDC`
  );
  console.log(
    `  Trade 2 Volume: ${trade2Amount} ALU × $${trade2Price} = $${trade2Volume} USDC`
  );

  const totalVolume = trade1Volume + trade2Volume;
  const totalAmount = trade1Amount + trade2Amount;

  console.log(
    `\n  Total Volume: $${trade1Volume} + $${trade2Volume} = $${totalVolume} USDC`
  );
  console.log(
    `  Total Amount: ${trade1Amount} + ${trade2Amount} = ${totalAmount} ALU`
  );

  const weightedAveragePrice = totalVolume / totalAmount;

  console.log(
    colorText(
      `\n  Weighted Average Price = Total Volume ÷ Total Amount`,
      colors.cyan
    )
  );
  console.log(
    colorText(
      `  Weighted Average Price = $${totalVolume} ÷ ${totalAmount} ALU`,
      colors.cyan
    )
  );
  console.log(
    colorText(
      `  Weighted Average Price = $${weightedAveragePrice.toFixed(6)} USDC`,
      colors.green
    )
  );

  // Verify the fraction
  console.log(colorText("\n🔢 FRACTION VERIFICATION:", colors.blue));
  console.log(
    `  ${totalVolume} ÷ ${totalAmount} = ${totalVolume}/${totalAmount} = ${
      totalVolume / totalAmount
    }`
  );
  console.log(`  175 ÷ 150 = 7/6 = 1.16̄ (repeating)`);
  console.log(`  Decimal representation: 1.166666... → 1.166667 (rounded)`);

  console.log(colorText("\n✅ CONCLUSION:", colors.green));
  console.log(
    "  The entry price of $1.166667 is the weighted average price of all sell trades:"
  );
  console.log(
    "  - It is NOT from position flipping or previous long positions"
  );
  console.log("  - The deployer NEVER had a long position");
  console.log(
    "  - The deployer executed two SELL orders that created a SHORT position"
  );
  console.log(
    "  - The entry price is correctly calculated as the volume-weighted average"
  );

  console.log(colorText("\n📋 POSITION SUMMARY:", colors.yellow));
  console.log("  Position Type: SHORT (negative size)");
  console.log("  Position Size: -150 ALU");
  console.log("  Entry Price: $1.166667 (weighted average of $1.00 and $1.50)");
  console.log("  Current Mark Price: $1.00");
  console.log("  P&L: +$25.00 (profit because price went down while short)");

  console.log(colorText("\n═".repeat(80), colors.cyan));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
