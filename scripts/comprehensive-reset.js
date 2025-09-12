#!/usr/bin/env node

// comprehensive-reset.js - Complete system reset script
//
// This script performs a thorough reset of the trading system:
// 1. Cancels ALL orders (including deployer)
// 2. Closes ALL positions properly
// 3. Resets user collateral
// 4. Verifies clean state

const { ethers } = require("hardhat");
const { getContract, getAddress } = require("../config/contracts");

// Color utilities
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

async function main() {
  console.log(
    "\n" +
      colorText("🔄 COMPREHENSIVE SYSTEM RESET", colors.bright + colors.yellow)
  );
  console.log("=".repeat(60));

  try {
    // Get contracts
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const vault = await getContract("CENTRALIZED_VAULT");
    const mockUSDC = await getContract("MOCK_USDC");
    const marketId = ethers.keccak256(ethers.toUtf8Bytes("ALU-USD"));

    // Get all signers
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const allUsers = signers.slice(0, 4); // Include deployer and 3 users

    console.log(colorText("\n📋 Users to reset:", colors.cyan));
    allUsers.forEach((user, i) => {
      const label = i === 0 ? "Deployer" : `User ${i}`;
      console.log(`  ${label}: ${user.address}`);
    });

    // Step 1: Cancel ALL orders for ALL users (including deployer)
    console.log(
      colorText("\n🚫 Step 1: Canceling ALL orders...", colors.yellow)
    );

    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];
      const label = i === 0 ? "Deployer" : `User ${i}`;
      let canceledCount = 0;

      try {
        // Get and cancel buy orders
        const buyOrders = await orderBook.getUserBuyOrders(user.address);
        for (const order of buyOrders) {
          if (order.isActive) {
            try {
              await orderBook.connect(user).cancelOrder(order.orderId);
              canceledCount++;
              console.log(
                colorText(
                  `  ✅ ${label}: Cancelled buy order #${order.orderId}`,
                  colors.green
                )
              );
            } catch (err) {
              console.log(
                colorText(
                  `  ⚠️  ${label}: Failed to cancel buy order #${order.orderId}`,
                  colors.yellow
                )
              );
            }
          }
        }

        // Get and cancel sell orders
        const sellOrders = await orderBook.getUserSellOrders(user.address);
        for (const order of sellOrders) {
          if (order.isActive) {
            try {
              await orderBook.connect(user).cancelOrder(order.orderId);
              canceledCount++;
              console.log(
                colorText(
                  `  ✅ ${label}: Cancelled sell order #${order.orderId}`,
                  colors.green
                )
              );
            } catch (err) {
              console.log(
                colorText(
                  `  ⚠️  ${label}: Failed to cancel sell order #${order.orderId}`,
                  colors.yellow
                )
              );
            }
          }
        }

        if (canceledCount === 0) {
          console.log(
            colorText(`  ℹ️  ${label}: No active orders to cancel`, colors.gray)
          );
        }
      } catch (error) {
        console.log(colorText(`  ℹ️  ${label}: No orders found`, colors.gray));
      }
    }

    // Step 2: Close ALL positions
    console.log(
      colorText("\n📊 Step 2: Closing ALL positions...", colors.yellow)
    );

    // First, check who has positions
    const positionHolders = [];
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];
      const label = i === 0 ? "Deployer" : `User ${i}`;

      try {
        const positions = await vault.getUserPositions(user.address);
        const activePosition = positions.find(
          (p) => p.marketId === marketId && p.size !== 0n
        );

        if (activePosition) {
          const size = activePosition.size;
          const absSize = size < 0n ? -size : size;
          const isLong = size > 0n;
          const sizeFormatted = ethers.formatUnits(absSize, 18);

          console.log(
            colorText(
              `  ${label}: ${isLong ? "LONG" : "SHORT"} ${sizeFormatted} ALU`,
              colors.cyan
            )
          );
          positionHolders.push({ user, label, size, absSize, isLong });
        } else {
          console.log(colorText(`  ${label}: No position`, colors.gray));
        }
      } catch (error) {
        console.log(
          colorText(`  ${label}: Error checking position`, colors.red)
        );
      }
    }

    // Close positions by matching them against each other
    if (positionHolders.length > 0) {
      console.log(
        colorText(
          "\n  Closing positions through direct settlement...",
          colors.yellow
        )
      );

      // Grant settlement role to deployer temporarily
      const SETTLEMENT_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("SETTLEMENT_ROLE")
      );
      const deployerHasRole = await vault.hasRole(
        SETTLEMENT_ROLE,
        deployer.address
      );

      if (!deployerHasRole) {
        console.log(
          colorText("  Granting settlement role to deployer...", colors.cyan)
        );
        await vault
          .connect(deployer)
          .grantRole(SETTLEMENT_ROLE, deployer.address);
      }

      // Force settle all positions at mark price
      const markPrice = await vault.getMarkPrice(marketId);
      console.log(
        colorText(
          `  Current mark price: $${ethers.formatUnits(markPrice, 6)}`,
          colors.cyan
        )
      );

      for (const holder of positionHolders) {
        try {
          // Close position by creating opposite position with zero size
          await vault
            .connect(deployer)
            .forceClosePosition(holder.user.address, marketId);
          console.log(
            colorText(`  ✅ ${holder.label}: Position closed`, colors.green)
          );
        } catch (error) {
          // If forceClosePosition doesn't exist, try alternative method
          console.log(
            colorText(
              `  Trying alternative close method for ${holder.label}...`,
              colors.yellow
            )
          );

          // Create opposite order to net out position
          const closePrice = markPrice;
          const oppositeDirection = !holder.isLong;

          try {
            // Place order from user to close their position
            await orderBook
              .connect(holder.user)
              .placeMarginLimitOrder(
                closePrice,
                holder.absSize,
                oppositeDirection
              );

            // Place opposite order from another user or deployer
            const counterparty =
              holder.user.address === deployer.address ? allUsers[1] : deployer;
            await orderBook
              .connect(counterparty)
              .placeMarginLimitOrder(closePrice, holder.absSize, holder.isLong);

            console.log(
              colorText(
                `  ✅ ${holder.label}: Position closed via orders`,
                colors.green
              )
            );
          } catch (err) {
            console.log(
              colorText(
                `  ❌ ${holder.label}: Failed to close position - ${err.message}`,
                colors.red
              )
            );
          }
        }
      }

      // Revoke settlement role if we granted it
      if (!deployerHasRole) {
        await vault
          .connect(deployer)
          .revokeRole(SETTLEMENT_ROLE, deployer.address);
        console.log(
          colorText("  Revoked settlement role from deployer", colors.cyan)
        );
      }
    }

    // Step 3: Reset collateral
    console.log(
      colorText("\n💰 Step 3: Resetting user collateral...", colors.yellow)
    );

    const targetCollateral = ethers.parseUnits("1000", 6); // 1000 USDC for users

    for (let i = 1; i < allUsers.length; i++) {
      // Skip deployer (index 0)
      const user = allUsers[i];
      const label = `User ${i}`;

      try {
        const marginSummary = await vault.getMarginSummary(user.address);
        const currentCollateral = marginSummary.totalCollateral;

        if (currentCollateral !== targetCollateral) {
          if (currentCollateral < targetCollateral) {
            // Need to deposit
            const toDeposit = targetCollateral - currentCollateral;

            // Ensure user has USDC
            const userBalance = await mockUSDC.balanceOf(user.address);
            if (userBalance < toDeposit) {
              await mockUSDC
                .connect(deployer)
                .mint(user.address, toDeposit - userBalance);
            }

            // Approve and deposit
            await mockUSDC.connect(user).approve(vault.target, toDeposit);
            await vault.connect(user).depositCollateral(toDeposit);

            console.log(
              colorText(
                `  ✅ ${label}: Deposited ${ethers.formatUnits(
                  toDeposit,
                  6
                )} USDC`,
                colors.green
              )
            );
          } else {
            // Need to withdraw
            const toWithdraw = currentCollateral - targetCollateral;
            await vault.connect(user).withdrawCollateral(toWithdraw);

            console.log(
              colorText(
                `  ✅ ${label}: Withdrew ${ethers.formatUnits(
                  toWithdraw,
                  6
                )} USDC`,
                colors.green
              )
            );
          }
        } else {
          console.log(
            colorText(
              `  ✅ ${label}: Already has ${ethers.formatUnits(
                targetCollateral,
                6
              )} USDC`,
              colors.green
            )
          );
        }
      } catch (error) {
        console.log(
          colorText(
            `  ❌ ${label}: Failed to reset collateral - ${error.message}`,
            colors.red
          )
        );
      }
    }

    // Step 4: Verify clean state
    console.log(
      colorText("\n✅ Step 4: Verifying clean state...", colors.yellow)
    );

    // Check order book
    const activeBuyOrders = await orderBook.getActiveBuyOrders();
    const activeSellOrders = await orderBook.getActiveSellOrders();

    console.log(colorText(`  Order book:`, colors.cyan));
    console.log(`    Active buy orders: ${activeBuyOrders.length}`);
    console.log(`    Active sell orders: ${activeSellOrders.length}`);

    // Check positions
    console.log(colorText(`  Positions:`, colors.cyan));
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];
      const label = i === 0 ? "Deployer" : `User ${i}`;

      try {
        const positions = await vault.getUserPositions(user.address);
        const activePosition = positions.find(
          (p) => p.marketId === marketId && p.size !== 0n
        );

        if (activePosition) {
          const size = activePosition.size;
          const absSize = size < 0n ? -size : size;
          const isLong = size > 0n;
          console.log(
            colorText(
              `    ⚠️  ${label}: Still has ${
                isLong ? "LONG" : "SHORT"
              } ${ethers.formatUnits(absSize, 18)} ALU`,
              colors.yellow
            )
          );
        } else {
          console.log(colorText(`    ✅ ${label}: No position`, colors.green));
        }
      } catch (error) {
        console.log(
          colorText(`    ❌ ${label}: Error checking position`, colors.red)
        );
      }
    }

    // Check collateral
    console.log(colorText(`  Collateral:`, colors.cyan));
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];
      const label = i === 0 ? "Deployer" : `User ${i}`;

      try {
        const marginSummary = await vault.getMarginSummary(user.address);
        const collateral = marginSummary.totalCollateral;
        console.log(`    ${label}: ${ethers.formatUnits(collateral, 6)} USDC`);
      } catch (error) {
        console.log(
          colorText(`    ❌ ${label}: Error checking collateral`, colors.red)
        );
      }
    }

    console.log(
      "\n" + colorText("✅ RESET COMPLETE!", colors.bright + colors.green)
    );
    console.log("=".repeat(60));
  } catch (error) {
    console.error(colorText("\n❌ Reset failed:", colors.red), error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
