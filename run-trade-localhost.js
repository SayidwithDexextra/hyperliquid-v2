#!/usr/bin/env node

// run-trade-localhost.js - Run trade.js with localhost network
//
// 🎯 PURPOSE:
//   Run trade.js with the correct localhost network configuration
//
// 🚀 USAGE:
//   node run-trade-localhost.js --show-book
//   node run-trade-localhost.js --trade-history
//   node run-trade-localhost.js --list-orders

const { spawn } = require("child_process");
const path = require("path");

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

async function main() {
  const args = process.argv.slice(2);

  console.log(
    colorText(
      "🚀 Running trade.js with localhost network...",
      colors.brightCyan
    )
  );

  // Set environment variable to use localhost network
  process.env.HARDHAT_NETWORK = "localhost";

  // Import and run the trade.js script
  const tradeScript = require("./trade.js");

  // Override the main function to use localhost network
  const originalMain = tradeScript.main;

  // Run the trade.js script with localhost network
  const scriptPath = path.join(__dirname, "trade.js");
  const nodeProcess = spawn("node", [scriptPath, ...args], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      HARDHAT_NETWORK: "localhost",
    },
  });

  nodeProcess.on("close", (code) => {
    console.log(
      colorText(`\n✨ Trade session ended with code ${code}`, colors.green)
    );
  });

  nodeProcess.on("error", (error) => {
    console.error(
      colorText("❌ Failed to start trade script:", colors.red),
      error.message
    );
  });
}

// Execute main function
main().catch(console.error);
