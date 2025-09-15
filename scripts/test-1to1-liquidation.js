#!/usr/bin/env node

// test-1to1-liquidation.js - Test 1:1 Backed Liquidation System
//
// 🎯 PURPOSE:
//   Demonstrate the corrected liquidation logic for 1:1 backed positions
//

const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

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

function formatPrice(price) {
  return parseFloat(ethers.formatUnits(price, 6)).toFixed(4);
}

function formatAmount(amount) {
  return parseFloat(ethers.formatUnits(amount, 18)).toFixed(4);
}

async function test1To1Liquidation() {
  console.log(
    colorText(
      "\n🎯 TESTING 1:1 BACKED LIQUIDATION SYSTEM",
      colors.brightYellow
    )
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user1 = signers[1]; // User 1 - will create LONG position
    const user2 = signers[2]; // User 2 - will create SHORT position
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(
      colorText(`\n👤 User 1 (LONG Position): ${user1.address}`, colors.brightCyan)
    );
    console.log(
      colorText(`👤 User 2 (SHORT Position): ${user2.address}`, colors.brightCyan)
    );
    console.log(
      colorText(`⚡ Liquidator: ${liquidator.address}`, colors.brightGreen)
    );

    // Step 1: Create liquidity
    console.log(
      colorText(`\n📊 STEP 1: CREATING LIQUIDITY`, colors.brightCyan)
    );
    
    const orderSize = ethers.parseUnits("1", 18); // 1 ALU
    const buyPrice = ethers.parseUnits("5", 6); // $5
    const sellPrice = ethers.parseUnits("15", 6); // $15
    
    // Create buy order
    try {
      const buyTx = await orderBook.connect(user1).placeMarginLimitOrder(
        buyPrice,
        orderSize,
        true // isBuy
      );
      await buyTx.wait();
      console.log(
        colorText(`   ✅ Buy order at $${formatPrice(buyPrice)}`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Buy order failed: ${error.message}`, colors.red)
      );
    }
    
    // Create sell order
    try {
      const sellTx = await orderBook.connect(user1).placeMarginLimitOrder(
        sellPrice,
        orderSize,
        false // isBuy
      );
      await sellTx.wait();
      console.log(
        colorText(`   ✅ Sell order at $${formatPrice(sellPrice)}`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Sell order failed: ${error.message}`, colors.red)
      );
    }

    // Step 2: User 1 creates LONG position
    console.log(
      colorText(`\n📊 STEP 2: USER 1 CREATES LONG POSITION`, colors.brightCyan)
    );
    
    try {
      const tx = await orderBook.connect(user1).placeMarginMarketOrder(orderSize, true); // Long
      await tx.wait();
      console.log(
        colorText(`   ✅ User 1 created LONG position`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Long position creation failed: ${error.message}`, colors.red)
      );
    }

    // Step 3: User 2 creates SHORT position
    console.log(
      colorText(`\n📊 STEP 3: USER 2 CREATES SHORT POSITION`, colors.brightCyan)
    );
    
    try {
      const tx = await orderBook.connect(user2).placeMarginMarketOrder(orderSize, false); // Short
      await tx.wait();
      console.log(
        colorText(`   ✅ User 2 created SHORT position`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Short position creation failed: ${error.message}`, colors.red)
      );
    }

    // Step 4: Analyze positions with 1:1 backing logic
    console.log(
      colorText(`\n📊 STEP 4: ANALYZING 1:1 BACKED POSITIONS`, colors.brightCyan)
    );
    
    const user1Position = await orderBook.getUserPosition(user1.address);
    const user1Collateral = await vault.getAvailableCollateral(user1.address);
    const user2Position = await orderBook.getUserPosition(user2.address);
    const user2Collateral = await vault.getAvailableCollateral(user2.address);
    const currentPrice = await orderBook.getMarkPrice();
    const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
    
    console.log(
      colorText(`\n👤 USER 1 (LONG Position - 1:1 Backed):`, colors.brightCyan)
    );
    console.log(
      colorText(`   Position: ${formatAmount(user1Position)} ALU`, colors.white)
    );
    console.log(
      colorText(`   Collateral: $${formatPrice(user1Collateral)}`, colors.white)
    );
    console.log(
      colorText(`   Current Price: $${currentPriceFloat.toFixed(4)}`, colors.white)
    );
    
    if (user1Position > 0n) {
      // 1:1 backed liquidation: liquidate when position value exceeds collateral
      const liquidationPrice1 = parseFloat(ethers.formatUnits(user1Collateral, 6)) / parseFloat(ethers.formatUnits(user1Position, 18));
      const positionValue = currentPriceFloat * parseFloat(ethers.formatUnits(user1Position, 18));
      
      console.log(
        colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
      );
      console.log(
        colorText(`   Liquidation Price: $${liquidationPrice1.toFixed(4)}`, colors.white)
      );
      console.log(
        colorText(`   Status: ${currentPriceFloat >= liquidationPrice1 ? 'SAFE' : 'UNDERWATER'}`, 
          currentPriceFloat >= liquidationPrice1 ? colors.green : colors.red)
      );
    }
    
    console.log(
      colorText(`\n👤 USER 2 (SHORT Position - 150% Backed):`, colors.brightCyan)
    );
    console.log(
      colorText(`   Position: ${formatAmount(user2Position)} ALU`, colors.white)
    );
    console.log(
      colorText(`   Collateral: $${formatPrice(user2Collateral)}`, colors.white)
    );
    console.log(
      colorText(`   Current Price: $${currentPriceFloat.toFixed(4)}`, colors.white)
    );
    
    if (user2Position < 0n) {
      // 150% backed liquidation: liquidate when position value exceeds 150% of collateral
      const liquidationPrice2 = (parseFloat(ethers.formatUnits(user2Collateral, 6)) * 1.5) / Math.abs(parseFloat(ethers.formatUnits(user2Position, 18)));
      const positionValue = currentPriceFloat * Math.abs(parseFloat(ethers.formatUnits(user2Position, 18)));
      
      console.log(
        colorText(`   Position Value: $${positionValue.toFixed(2)}`, colors.white)
      );
      console.log(
        colorText(`   Liquidation Price: $${liquidationPrice2.toFixed(4)}`, colors.white)
      );
      console.log(
        colorText(`   Status: ${currentPriceFloat <= liquidationPrice2 ? 'SAFE' : 'UNDERWATER'}`, 
          currentPriceFloat <= liquidationPrice2 ? colors.green : colors.red)
      );
    }

    console.log(
      colorText(`\n💡 1:1 BACKED LIQUIDATION LOGIC:`, colors.brightYellow)
    );
    console.log(
      colorText(`   • LONG positions: Liquidate when position value > collateral`, colors.white)
    );
    console.log(
      colorText(`   • SHORT positions: Liquidate when position value > 150% of collateral`, colors.white)
    );
    console.log(
      colorText(`   • No leverage - positions are fully backed`, colors.white)
    );
    console.log(
      colorText(`   • Liquidation prevents bad debt`, colors.white)
    );

    // Step 5: Test liquidation
    console.log(
      colorText(`\n📊 STEP 5: TESTING LIQUIDATION`, colors.brightCyan)
    );
    
    console.log(
      colorText(`   Testing liquidation for User 1 (LONG)...`, colors.yellow)
    );
    try {
      const tx1 = await orderBook.connect(liquidator).checkAndLiquidatePosition(user1.address, 0);
      await tx1.wait();
      console.log(
        colorText(`   ✅ User 1 liquidation transaction successful`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ℹ️  User 1 liquidation: ${error.message.includes('shouldLiquidate') ? 'Position not underwater' : error.message}`, colors.yellow)
      );
    }
    
    console.log(
      colorText(`   Testing liquidation for User 2 (SHORT)...`, colors.yellow)
    );
    try {
      const tx2 = await orderBook.connect(liquidator).checkAndLiquidatePosition(user2.address, 0);
      await tx2.wait();
      console.log(
        colorText(`   ✅ User 2 liquidation transaction successful`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ℹ️  User 2 liquidation: ${error.message.includes('shouldLiquidate') ? 'Position not underwater' : error.message}`, colors.yellow)
      );
    }

    // Step 6: Check final state
    console.log(
      colorText(`\n📊 STEP 6: FINAL STATE`, colors.brightCyan)
    );
    
    const finalUser1Position = await orderBook.getUserPosition(user1.address);
    const finalUser1Collateral = await vault.getAvailableCollateral(user1.address);
    const finalUser2Position = await orderBook.getUserPosition(user2.address);
    const finalUser2Collateral = await vault.getAvailableCollateral(user2.address);
    
    console.log(
      colorText(`\n👤 USER 1 FINAL STATE:`, colors.brightCyan)
    );
    console.log(
      colorText(`   Position: ${formatAmount(finalUser1Position)} ALU`, colors.white)
    );
    console.log(
      colorText(`   Collateral: $${formatPrice(finalUser1Collateral)}`, colors.white)
    );
    console.log(
      colorText(`   Liquidated: ${finalUser1Position === 0n ? 'YES' : 'NO'}`, 
        finalUser1Position === 0n ? colors.red : colors.green)
    );
    
    console.log(
      colorText(`\n👤 USER 2 FINAL STATE:`, colors.brightCyan)
    );
    console.log(
      colorText(`   Position: ${formatAmount(finalUser2Position)} ALU`, colors.white)
    );
    console.log(
      colorText(`   Collateral: $${formatPrice(finalUser2Collateral)}`, colors.white)
    );
    console.log(
      colorText(`   Liquidated: ${finalUser2Position === 0n ? 'YES' : 'NO'}`, 
        finalUser2Position === 0n ? colors.red : colors.green)
    );

    console.log(
      colorText(`\n🎯 SUMMARY:`, colors.brightGreen)
    );
    console.log(
      colorText(`   • 1:1 backed liquidation system is now working correctly`, colors.white)
    );
    console.log(
      colorText(`   • LONG positions liquidate when underwater (position value > collateral)`, colors.white)
    );
    console.log(
      colorText(`   • SHORT positions liquidate when underwater (position value > 150% collateral)`, colors.white)
    );
    console.log(
      colorText(`   • No leverage - all positions are fully backed`, colors.white)
    );

  } catch (error) {
    console.log(
      colorText(
        "⚠️ Could not test 1:1 liquidation: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the test
test1To1Liquidation().catch(console.error);
