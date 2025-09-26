const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Debug script to trace the exact execution path and identify where the overflow is occurring
async function main() {
  console.log("\n🔍 HYPERLIQUID V2 - OVERFLOW DEBUGGING SCRIPT");
  console.log(
    "════════════════════════════════════════════════════════════════════════════════"
  );
  console.log(
    "This script will attempt to identify the exact cause of the arithmetic overflow"
  );

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const user1 = signers[1];
  const user2 = signers[2];
  const user3 = signers[3];

  console.log(`📋 Deployer: ${deployer.address}`);
  console.log(`📋 User 1: ${user1.address}`);
  console.log(`📋 User 2: ${user2.address}`);
  console.log(`📋 User 3: ${user3.address}`);

  // Load deployments
  let deploymentData;
  try {
    deploymentData = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "deployments", "unknown-deployment.json"),
        "utf8"
      )
    );
    console.log("✅ Loaded deployment data from unknown-deployment.json");
  } catch (error) {
    console.error("❌ Failed to load deployment data:", error.message);
    return;
  }

  // Get contract instances
  console.log("📋 Deployment data:", deploymentData);

  // Extract contract addresses
  const mockUSDCAddress = deploymentData.contracts.MOCK_USDC;
  const orderBookAddress = deploymentData.contracts.ALUMINUM_ORDERBOOK;
  const coreVaultAddress = deploymentData.contracts.CORE_VAULT;

  console.log(`📋 MockUSDC address: ${mockUSDCAddress}`);
  console.log(`📋 OrderBook address: ${orderBookAddress}`);
  console.log(`📋 CoreVault address: ${coreVaultAddress}`);

  // Get contract instances
  const mockUSDC = await ethers.getContractAt("MockUSDC", mockUSDCAddress);
  const orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);
  const coreVault = await ethers.getContractAt("CoreVault", coreVaultAddress);

  console.log("\n📊 CONTRACT STATUS CHECK");
  console.log("────────────────────────────────────────────────────────────");

  // Check market status
  const bestBid = await orderBook.bestBid();
  const bestAsk = await orderBook.bestAsk();
  const markPrice = await orderBook.getMarkPrice();
  console.log(`📈 Current Best Bid: $${ethers.formatUnits(bestBid, 6)}`);
  console.log(`📉 Current Best Ask: $${ethers.formatUnits(bestAsk, 6)}`);
  console.log(`📊 Current Mark Price: $${ethers.formatUnits(markPrice, 6)}`);

  // Check user balances and positions
  const user1Balance = await coreVault.getCollateralBalance(user1.address);
  const user2Balance = await coreVault.getCollateralBalance(user2.address);
  console.log(
    `💰 User1 Collateral: ${ethers.formatUnits(user1Balance, 6)} USDC`
  );
  console.log(
    `💰 User2 Collateral: ${ethers.formatUnits(user2Balance, 6)} USDC`
  );

  // Set up event listeners for debugging events
  console.log("\n🔬 SETTING UP EVENT LISTENERS FOR DEBUGGING EVENTS");
  console.log("────────────────────────────────────────────────────────────");

  // Listen for arithmetic debug events
  orderBook.on(
    "ArithmeticDebug",
    (operation, location, value1, value2, result) => {
      console.log(`🧮 ARITHMETIC DEBUG [${location}] ${operation}:`);
      console.log(`   Value1: ${value1.toString()}`);
      console.log(`   Value2: ${value2.toString()}`);
      console.log(`   Result: ${result.toString()}`);
    }
  );

  orderBook.on(
    "ArithmeticDebugInt",
    (operation, location, value1, value2, result) => {
      console.log(`🧮 ARITHMETIC DEBUG INT [${location}] ${operation}:`);
      console.log(`   Value1: ${value1.toString()}`);
      console.log(`   Value2: ${value2.toString()}`);
      console.log(`   Result: ${result.toString()}`);
    }
  );

  orderBook.on(
    "ArithmeticScaling",
    (location, originalValue, scaledValue, scalingFactor) => {
      console.log(`📏 SCALING [${location}]:`);
      console.log(`   Original: ${originalValue.toString()}`);
      console.log(`   Scaled: ${scaledValue.toString()}`);
      console.log(`   Factor: ${scalingFactor.toString()}`);
    }
  );

  orderBook.on(
    "MarginCalculationDebug",
    (amount, price, isBuy, marginRequired) => {
      console.log(`💵 MARGIN CALCULATION:`);
      console.log(
        `   Amount: ${ethers.formatUnits(
          amount,
          18
        )} ALU (${amount.toString()})`
      );
      console.log(
        `   Price: $${ethers.formatUnits(price, 6)} (${price.toString()})`
      );
      console.log(`   Is Buy: ${isBuy}`);
      console.log(
        `   Margin Required: ${ethers.formatUnits(
          marginRequired,
          6
        )} USDC (${marginRequired.toString()})`
      );
    }
  );

  console.log("\n🧪 EXECUTING TEST TRANSACTION");
  console.log("────────────────────────────────────────────────────────────");

  try {
    // Try with progressively smaller amounts to find the threshold
    const testAmounts = [
      { name: "Normal", amount: ethers.parseUnits("5", 18) },
      { name: "Small", amount: ethers.parseUnits("1", 18) },
      { name: "Tiny", amount: ethers.parseUnits("0.1", 18) },
      { name: "Micro", amount: ethers.parseUnits("0.01", 18) },
      { name: "Nano", amount: ethers.parseUnits("0.001", 18) },
      { name: "Pico", amount: ethers.parseUnits("0.0001", 18) },
    ];

    // Price is $2.50 USDC (6 decimals)
    const price = ethers.parseUnits("2.5", 6);

    for (const test of testAmounts) {
      console.log(
        `\n🔬 Testing with ${test.name} amount: ${ethers.formatUnits(
          test.amount,
          18
        )} ALU`
      );

      try {
        // First try to calculate margin required (this doesn't modify state)
        console.log("📊 Attempting to calculate margin required...");
        const tx = await orderBook
          .connect(user1)
          .callStatic._calculateMarginRequired(test.amount, price, true);
        console.log(
          `✅ Margin calculation successful: ${ethers.formatUnits(tx, 6)} USDC`
        );

        // If that worked, try to place the order
        console.log("📝 Attempting to place margin limit order...");
        const orderTx = await orderBook.connect(user1).placeMarginLimitOrder(
          price,
          test.amount,
          true // isBuy = true
        );

        // Wait for transaction to be mined
        const receipt = await orderTx.wait();
        console.log(
          `✅ Order placed successfully! Gas used: ${receipt.gasUsed.toString()}`
        );

        // If we got here, the transaction succeeded
        console.log("🎉 SUCCESS: Transaction completed without overflow!");
        break;
      } catch (error) {
        console.log(`❌ ERROR with ${test.name} amount:`);
        console.log(`   ${error.message}`);

        // Extract panic code if available
        if (error.message.includes("panic code")) {
          const panicCode = error.message.match(/panic code (0x[0-9a-f]+)/i);
          if (panicCode) {
            console.log(`   Panic Code: ${panicCode[1]}`);
          }
        }

        // If this is the last test amount, we've exhausted all options
        if (test === testAmounts[testAmounts.length - 1]) {
          console.log("\n❌ All test amounts failed with overflow errors");
        }
      }
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }

  // Keep the script running to receive events
  console.log("\n⏳ Waiting for events (press Ctrl+C to exit)...");

  // Keep the script running for a while to receive events
  await new Promise((resolve) => setTimeout(resolve, 10000));

  console.log("\n✅ DEBUG SCRIPT COMPLETED");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
