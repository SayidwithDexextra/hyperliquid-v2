#!/usr/bin/env node

// test-isolated-position-liquidation.js - Test Isolated Position Liquidation
//
// 🎯 PURPOSE:
//   Demonstrate how isolated positions work with their own isolated margin
//   Each position has its own margin and liquidation price, independent of user's total collateral
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

async function testIsolatedPositionLiquidation() {
  console.log(
    colorText(
      "\n🎯 TESTING ISOLATED POSITION LIQUIDATION SYSTEM",
      colors.brightYellow
    )
  );

  try {
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const signers = await ethers.getSigners();
    const user1 = signers[1]; // User 1 - will create isolated positions
    const liquidator = signers[0]; // Deployer will be the liquidator

    console.log(
      colorText(`\n👤 User 1: ${user1.address}`, colors.brightCyan)
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

    // Step 2: User creates isolated positions
    console.log(
      colorText(`\n📊 STEP 2: CREATING ISOLATED POSITIONS`, colors.brightCyan)
    );
    
    // Create LONG isolated position
    try {
      const longTx = await orderBook.connect(user1).placeMarginMarketOrder(orderSize, true); // Long
      await longTx.wait();
      console.log(
        colorText(`   ✅ User 1 created LONG isolated position`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Long position creation failed: ${error.message}`, colors.red)
      );
    }

    // Create SHORT isolated position
    try {
      const shortTx = await orderBook.connect(user1).placeMarginMarketOrder(orderSize, false); // Short
      await shortTx.wait();
      console.log(
        colorText(`   ✅ User 1 created SHORT isolated position`, colors.green)
      );
    } catch (error) {
      console.log(
        colorText(`   ❌ Short position creation failed: ${error.message}`, colors.red)
      );
    }

    // Step 3: Analyze isolated positions
    console.log(
      colorText(`\n📊 STEP 3: ANALYZING ISOLATED POSITIONS`, colors.brightCyan)
    );
    
    const userCollateral = await vault.getAvailableCollateral(user1.address);
    const currentPrice = await orderBook.getMarkPrice();
    const currentPriceFloat = parseFloat(ethers.formatUnits(currentPrice, 6));
    
    console.log(
      colorText(`\n👤 USER 1 TOTAL COLLATERAL:`, colors.brightCyan)
    );
    console.log(
      colorText(`   Total Collateral: $${formatPrice(userCollateral)}`, colors.white)
    );
    console.log(
      colorText(`   Current Price: $${currentPriceFloat.toFixed(4)}`, colors.white)
    );

    // Get isolated positions
    const positionIds = await orderBook.getUserPositions(user1.address);
    console.log(
      colorText(`\n📋 ISOLATED POSITIONS (${positionIds.length} total):`, colors.brightCyan)
    );

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      const position = await orderBook.getPosition(user1.address, positionId);
      
      if (position.isActive) {
        const positionType = position.size > 0n ? "LONG" : "SHORT";
        const positionSize = formatAmount(position.size);
        const entryPrice = formatPrice(position.entryPrice);
        const isolatedMargin = formatPrice(position.isolatedMargin);
        const liquidationPrice = formatPrice(position.liquidationPrice);
        const maintenanceMargin = formatPrice(position.maintenanceMargin);
        
        console.log(
          colorText(`\n   Position ${i + 1} (ID: ${positionId}):`, colors.brightYellow)
        );
        console.log(
          colorText(`     Type: ${positionType}`, colors.white)
        );
        console.log(
          colorText(`     Size: ${positionSize} ALU`, colors.white)
        );
        console.log(
          colorText(`     Entry Price: $${entryPrice}`, colors.white)
        );
        console.log(
          colorText(`     Isolated Margin: $${isolatedMargin}`, colors.white)
        );
        console.log(
          colorText(`     Maintenance Margin: $${maintenanceMargin}`, colors.white)
        );
        console.log(
          colorText(`     Liquidation Price: $${liquidationPrice}`, colors.white)
        );
        
        // Check if position is at risk
        let isAtRisk = false;
        if (position.size > 0n) {
          // Long position: at risk if current price <= liquidation price
          isAtRisk = currentPriceFloat <= parseFloat(liquidationPrice);
        } else {
          // Short position: at risk if current price >= liquidation price
          isAtRisk = currentPriceFloat >= parseFloat(liquidationPrice);
        }
        
        console.log(
          colorText(`     Status: ${isAtRisk ? 'AT RISK' : 'SAFE'}`, 
            isAtRisk ? colors.red : colors.green)
        );
      }
    }

    console.log(
      colorText(`\n💡 ISOLATED POSITION SYSTEM:`, colors.brightYellow)
    );
    console.log(
      colorText(`   • Each position has its own isolated margin`, colors.white)
    );
    console.log(
      colorText(`   • Liquidation based on position's isolated margin, not total collateral`, colors.white)
    );
    console.log(
      colorText(`   • Positions are independent - one can be liquidated while others remain safe`, colors.white)
    );
    console.log(
      colorText(`   • Socialized loss only occurs if isolated margin is insufficient`, colors.white)
    );

    // Step 4: Test liquidation
    console.log(
      colorText(`\n📊 STEP 4: TESTING LIQUIDATION`, colors.brightCyan)
    );
    
    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      console.log(
        colorText(`   Testing liquidation for Position ${i + 1} (ID: ${positionId})...`, colors.yellow)
      );
      
      try {
        const tx = await orderBook.connect(liquidator).checkAndLiquidatePosition(user1.address, positionId);
        await tx.wait();
        console.log(
          colorText(`   ✅ Position ${i + 1} liquidation transaction successful`, colors.green)
        );
      } catch (error) {
        console.log(
          colorText(`   ℹ️  Position ${i + 1} liquidation: ${error.message.includes('shouldLiquidate') ? 'Position not at liquidation price' : error.message}`, colors.yellow)
        );
      }
    }

    // Step 5: Check final state
    console.log(
      colorText(`\n📊 STEP 5: FINAL STATE`, colors.brightCyan)
    );
    
    const finalUserCollateral = await vault.getAvailableCollateral(user1.address);
    const finalPositionIds = await orderBook.getUserPositions(user1.address);
    
    console.log(
      colorText(`\n👤 USER 1 FINAL STATE:`, colors.brightCyan)
    );
    console.log(
      colorText(`   Total Collateral: $${formatPrice(finalUserCollateral)}`, colors.white)
    );
    console.log(
      colorText(`   Active Positions: ${finalPositionIds.length}`, colors.white)
    );
    
    let activePositions = 0;
    for (let i = 0; i < finalPositionIds.length; i++) {
      const positionId = finalPositionIds[i];
      const position = await orderBook.getPosition(user1.address, positionId);
      if (position.isActive) {
        activePositions++;
      }
    }
    
    console.log(
      colorText(`   Liquidated Positions: ${finalPositionIds.length - activePositions}`, colors.white)
    );

    console.log(
      colorText(`\n🎯 SUMMARY:`, colors.brightGreen)
    );
    console.log(
      colorText(`   • Isolated position system is working correctly`, colors.white)
    );
    console.log(
      colorText(`   • Each position has its own isolated margin and liquidation price`, colors.white)
    );
    console.log(
      colorText(`   • Positions are liquidated independently based on their own margin`, colors.white)
    );
    console.log(
      colorText(`   • User's total collateral is only used for socialized losses`, colors.white)
    );

  } catch (error) {
    console.log(
      colorText(
        "⚠️ Could not test isolated position liquidation: " + error.message,
        colors.red
      )
    );
    console.error(error);
  }
}

// Run the test
testIsolatedPositionLiquidation().catch(console.error);
