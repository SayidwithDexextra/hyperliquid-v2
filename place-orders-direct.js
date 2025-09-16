#!/usr/bin/env node

// place-orders-direct.js - Direct order placement without view functions
// This bypasses the stripped methods and focuses purely on order placement

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("📋 PLACING ORDERS USING PROPER CONTRACT CONNECTION");
  console.log("=".repeat(60));

  // Get contracts using the same method as fill-order-book.js
  const vault = await getContract("CENTRALIZED_VAULT");
  const orderBook = await getContract("ALUMINUM_ORDERBOOK");
  const usdc = await getContract("MOCK_USDC");

  const [deployer, user1, user2, user3] = await ethers.getSigners();

  try {
    console.log("\n📊 CONTRACT ADDRESSES:");
    console.log(`   OrderBook: ${await orderBook.getAddress()}`);
    console.log(`   Vault: ${await vault.getAddress()}`);
    console.log(`   USDC: ${await usdc.getAddress()}`);

    console.log("\n✅ Contracts connected successfully using getContract()");
    console.log("⚠️  Skipping view functions due to contract size limitations");

    // Fund users if needed (following fill-order-book.js pattern)
    console.log("\n💰 ENSURING SUFFICIENT COLLATERAL:");
    console.log("-".repeat(40));

    const fundingAmount = ethers.parseUnits("10000", 6); // 10,000 USDC
    const depositAmount = ethers.parseUnits("5000", 6); // 5,000 USDC collateral

    // Fund deployer
    console.log("💰 Funding deployer...");
    await usdc.connect(deployer).mint(deployer.address, fundingAmount);
    await usdc
      .connect(deployer)
      .approve(await vault.getAddress(), depositAmount);
    await vault.connect(deployer).depositCollateral(depositAmount);
    console.log("✅ Deployer funded and deposited collateral");

    // Fund user3
    console.log("💰 Funding user3...");
    await usdc.connect(user3).mint(user3.address, fundingAmount);
    await usdc.connect(user3).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user3).depositCollateral(depositAmount);
    console.log("✅ User3 funded and deposited collateral");

    // ============ ORDER 1: DEPLOYER LIMIT BUY ============
    console.log("\n" + "=".repeat(50));
    console.log("📈 ORDER 1: DEPLOYER LIMIT BUY");
    console.log("=".repeat(50));

    const buyPrice = ethers.parseUnits("1.0", 6); // $1.00
    const buyAmount = ethers.parseUnits("10", 18); // 10 ALU

    console.log("🎯 Placing: BUY 10 ALU @ $1.00 (Limit Order)");
    console.log(`💰 Price: $${ethers.formatUnits(buyPrice, 6)}`);
    console.log(`📊 Amount: ${ethers.formatUnits(buyAmount, 18)} ALU`);

    const tx1 = await orderBook
      .connect(deployer)
      .placeMarginLimitOrder(buyPrice, buyAmount, true);
    console.log(`📄 Transaction submitted: ${tx1.hash}`);

    const receipt1 = await tx1.wait();
    console.log(`✅ Transaction confirmed in block ${receipt1.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt1.gasUsed}`);

    // Wait between orders
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // ============ ORDER 2: USER3 MARKET SELL ============
    console.log("\n" + "=".repeat(50));
    console.log("📉 ORDER 2: USER3 MARKET SELL");
    console.log("=".repeat(50));

    const sellAmount1 = ethers.parseUnits("10", 18); // 10 ALU

    console.log("🎯 Placing: SELL 10 ALU (Market Order)");
    console.log(`📊 Amount: ${ethers.formatUnits(sellAmount1, 18)} ALU`);

    const tx2 = await orderBook
      .connect(user3)
      .placeMarginMarketOrder(sellAmount1, false);
    console.log(`📄 Transaction submitted: ${tx2.hash}`);

    const receipt2 = await tx2.wait();
    console.log(`✅ Transaction confirmed in block ${receipt2.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt2.gasUsed}`);

    // Check for events in receipt2
    console.log("\n🔍 Checking for trade events...");
    let tradesFound = 0;
    for (const log of receipt2.logs) {
      // Look for any events (we can't decode them without full ABI, but we can see if any fired)
      if (log.topics && log.topics.length > 0) {
        tradesFound++;
        console.log(`   📋 Event found: ${log.topics[0]}`);
      }
    }
    console.log(`📊 Total events in transaction: ${tradesFound}`);

    // Wait between orders
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // ============ ORDER 3: USER3 LIMIT SELL ============
    console.log("\n" + "=".repeat(50));
    console.log("📉 ORDER 3: USER3 LIMIT SELL");
    console.log("=".repeat(50));

    const sellPrice = ethers.parseUnits("2.5", 6); // $2.50
    const sellAmount2 = ethers.parseUnits("15", 18); // 15 ALU

    console.log("🎯 Placing: SELL 15 ALU @ $2.50 (Limit Order)");
    console.log(`💰 Price: $${ethers.formatUnits(sellPrice, 6)}`);
    console.log(`📊 Amount: ${ethers.formatUnits(sellAmount2, 18)} ALU`);

    const tx3 = await orderBook
      .connect(user3)
      .placeMarginLimitOrder(sellPrice, sellAmount2, false);
    console.log(`📄 Transaction submitted: ${tx3.hash}`);

    const receipt3 = await tx3.wait();
    console.log(`✅ Transaction confirmed in block ${receipt3.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt3.gasUsed}`);

    // ============ FINAL SUMMARY ============
    console.log("\n" + "=".repeat(60));
    console.log("🎉 ALL ORDERS SUBMITTED SUCCESSFULLY!");
    console.log("=".repeat(60));

    console.log("\n📋 TRANSACTION SUMMARY:");
    console.log(`✅ Order 1 (Deployer Buy):  ${tx1.hash}`);
    console.log(`   Block: ${receipt1.blockNumber}, Gas: ${receipt1.gasUsed}`);
    console.log(`✅ Order 2 (User3 Market):  ${tx2.hash}`);
    console.log(`   Block: ${receipt2.blockNumber}, Gas: ${receipt2.gasUsed}`);
    console.log(`✅ Order 3 (User3 Limit):   ${tx3.hash}`);
    console.log(`   Block: ${receipt3.blockNumber}, Gas: ${receipt3.gasUsed}`);

    console.log("\n💡 NOTE:");
    console.log("   - All transactions were confirmed on-chain");
    console.log("   - Orders should be active in the smart contracts");
    console.log("   - View functions may not work due to contract size issues");
    console.log("   - But the order placement functions are working!");
  } catch (error) {
    console.error("❌ Order placement failed:", error.message);

    if (error.message.includes("insufficient")) {
      console.error("💡 Need more collateral - increase funding amounts");
    } else if (error.message.includes("revert")) {
      console.error("💡 Contract reverted - check order parameters");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
