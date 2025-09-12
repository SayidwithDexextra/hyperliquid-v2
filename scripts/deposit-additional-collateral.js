/**
 * 💰 DEPOSIT ADDITIONAL COLLATERAL
 *
 * This script deposits 8,000 USDC to User 1 and User 2's collateral
 * to ensure they have enough for comprehensive testing
 */

const { ethers } = require("hardhat");

// Color codes for better visualization
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  brightYellow: "\x1b[93m",
  brightGreen: "\x1b[92m",
};

const colorText = (text, color) => `${color}${text}${colors.reset}`;

function formatUSDC(value) {
  return ethers.formatUnits(value, 6);
}

async function main() {
  console.log(
    colorText("💰 DEPOSIT ADDITIONAL COLLATERAL", colors.brightYellow)
  );
  console.log(colorText("=".repeat(60), colors.cyan));

  try {
    // Load contracts
    const usdc = await ethers.getContractAt(
      "MockUSDC",
      "0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E"
    );
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      "0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690"
    );

    // Get signers
    const [deployer, user1, user2] = await ethers.getSigners();

    const depositAmount = ethers.parseUnits("8000", 6); // 8,000 USDC

    // Check current balances
    console.log(colorText("\n📊 Current State:", colors.brightYellow));

    for (const [user, label] of [
      [user1, "User 1"],
      [user2, "User 2"],
    ]) {
      const walletBalance = await usdc.balanceOf(user.address);
      const marginSummary = await vault.getMarginSummary(user.address);

      console.log(colorText(`\n${label}:`, colors.cyan));
      console.log(`  Wallet Balance: ${formatUSDC(walletBalance)} USDC`);
      console.log(
        `  Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`
      );
      console.log(
        `  Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`
      );
    }

    // Deposit for both users
    console.log(
      colorText("\n💸 Depositing 8,000 USDC for each user...", colors.yellow)
    );

    // User 1 deposit
    console.log(colorText("\nUser 1:", colors.cyan));
    let tx = await usdc.connect(user1).approve(vault.target, depositAmount);
    await tx.wait();
    console.log("  ✅ Approved USDC");

    tx = await vault.connect(user1).depositCollateral(depositAmount);
    await tx.wait();
    console.log("  ✅ Deposited 8,000 USDC");

    // User 2 deposit
    console.log(colorText("\nUser 2:", colors.cyan));
    tx = await usdc.connect(user2).approve(vault.target, depositAmount);
    await tx.wait();
    console.log("  ✅ Approved USDC");

    tx = await vault.connect(user2).depositCollateral(depositAmount);
    await tx.wait();
    console.log("  ✅ Deposited 8,000 USDC");

    // Display final state
    console.log(colorText("\n📊 Final State:", colors.brightGreen));

    for (const [user, label] of [
      [user1, "User 1"],
      [user2, "User 2"],
    ]) {
      const walletBalance = await usdc.balanceOf(user.address);
      const marginSummary = await vault.getMarginSummary(user.address);

      console.log(colorText(`\n${label}:`, colors.cyan));
      console.log(`  Wallet Balance: ${formatUSDC(walletBalance)} USDC`);
      console.log(
        `  Total Collateral: ${formatUSDC(marginSummary.totalCollateral)} USDC`
      );
      console.log(
        `  Available: ${formatUSDC(marginSummary.availableCollateral)} USDC`
      );
    }

    console.log(
      colorText(
        "\n✅ Additional collateral deposited successfully!",
        colors.brightGreen
      )
    );
    console.log(
      colorText(
        "   Users now have sufficient collateral for comprehensive testing",
        colors.green
      )
    );
  } catch (error) {
    console.error(colorText(`\n❌ Error: ${error.message}`, colors.red));
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
