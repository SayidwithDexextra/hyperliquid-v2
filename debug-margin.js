#!/usr/bin/env node

const { ethers } = require("hardhat");
const { getContract } = require("./config/contracts");

async function main() {
  console.log("\n🔍 DEBUGGING MARGIN TRACKING\n");

  try {
    const [deployer, user1] = await ethers.getSigners();

    // Get contracts
    const usdc = await getContract("MOCK_USDC");
    const vault = await getContract("CENTRALIZED_VAULT");
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");

    console.log("1. Setting up User1 with 1000 USDC collateral...");
    await usdc.mint(user1.address, ethers.parseUnits("1000", 6));
    await usdc
      .connect(user1)
      .approve(vault.target, ethers.parseUnits("1000", 6));
    await vault.connect(user1).depositCollateral(ethers.parseUnits("1000", 6));

    console.log("\n2. Checking initial state:");
    console.log(
      "   User collateral:",
      ethers.formatUnits(await vault.userCollateral(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Available collateral:",
      ethers.formatUnits(await vault.getAvailableCollateral(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Total margin used:",
      ethers.formatUnits(await vault.getTotalMarginUsed(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Total margin reserved:",
      ethers.formatUnits(await vault.getTotalMarginReserved(user1.address), 6),
      "USDC"
    );

    console.log(
      "\n3. Placing a limit order (100 units @ $10 = $1000 margin)..."
    );
    try {
      const tx = await orderBook
        .connect(user1)
        .placeMarginLimitOrder(
          ethers.parseUnits("10", 6),
          ethers.parseUnits("100", 6),
          true
        );
      await tx.wait();
      console.log("   ✅ Order placed successfully");
    } catch (error) {
      console.log("   ❌ Order failed:", error.message);
    }

    console.log("\n4. Checking state after order:");
    console.log(
      "   User collateral:",
      ethers.formatUnits(await vault.userCollateral(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Available collateral:",
      ethers.formatUnits(await vault.getAvailableCollateral(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Total margin used:",
      ethers.formatUnits(await vault.getTotalMarginUsed(user1.address), 6),
      "USDC"
    );
    console.log(
      "   Total margin reserved:",
      ethers.formatUnits(await vault.getTotalMarginReserved(user1.address), 6),
      "USDC"
    );

    // Check userMarketIds
    console.log("\n5. Checking userMarketIds:");
    try {
      const marketIds = await vault.getUserMarketIds(user1.address);
      console.log("   User market IDs:", marketIds.length);
      if (marketIds.length > 0) {
        for (let i = 0; i < marketIds.length; i++) {
          const margin = await vault.userMarginByMarket(
            user1.address,
            marketIds[i]
          );
          console.log(
            `   Market ${i}: ${marketIds[i]} - Margin: ${ethers.formatUnits(
              margin,
              6
            )} USDC`
          );
        }
      }
    } catch (error) {
      console.log("   Error checking market IDs:", error.message);
    }

    // Check pending orders
    console.log("\n6. Checking pending orders:");
    try {
      const pendingOrders = await vault.getUserPendingOrders(user1.address);
      console.log("   Pending orders:", pendingOrders.length);
      if (pendingOrders.length > 0) {
        for (let i = 0; i < pendingOrders.length; i++) {
          console.log(
            `   Order ${i}: Reserved margin: ${ethers.formatUnits(
              pendingOrders[i].marginReserved,
              6
            )} USDC`
          );
        }
      }
    } catch (error) {
      console.log("   Error checking pending orders:", error.message);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
