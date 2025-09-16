#!/usr/bin/env node

const { ethers } = require("hardhat");

async function simpleTest() {
  console.log("🧪 SIMPLE CONTRACT TEST");
  console.log("═".repeat(40));

  try {
    // Get the deployed vault address from the latest deployment
    const vaultAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    console.log(`🏦 Testing Vault at: ${vaultAddress}`);

    // Check if there's code at this address
    const code = await ethers.provider.getCode(vaultAddress);
    console.log(`📝 Contract code length: ${code.length}`);

    if (code === "0x") {
      console.log("❌ No contract code found!");
      return;
    }

    // Get the vault contract
    const vault = await ethers.getContractAt("CentralizedVault", vaultAddress);

    console.log("🔍 Testing simple reads...");

    // Test the simplest possible function calls
    try {
      const totalCollateralDeposited = await vault.totalCollateralDeposited();
      console.log(
        `✅ totalCollateralDeposited: ${ethers.formatUnits(
          totalCollateralDeposited,
          6
        )} USDC`
      );
    } catch (error) {
      console.log(`❌ totalCollateralDeposited failed: ${error.message}`);

      // Try calling with different approaches
      console.log("🔧 Trying alternative approach...");
      try {
        const result = await vault.totalCollateralDeposited.staticCall();
        console.log(
          `✅ Static call result: ${ethers.formatUnits(result, 6)} USDC`
        );
      } catch (staticError) {
        console.log(`❌ Static call also failed: ${staticError.message}`);
      }
    }

    try {
      const totalMarginLocked = await vault.totalMarginLocked();
      console.log(
        `✅ totalMarginLocked: ${ethers.formatUnits(totalMarginLocked, 6)} USDC`
      );
    } catch (error) {
      console.log(`❌ totalMarginLocked failed: ${error.message}`);
    }

    // Test with a user address
    const [deployer] = await ethers.getSigners();
    console.log(`👤 Testing with deployer: ${deployer.address}`);

    try {
      const userCollateral = await vault.userCollateral(deployer.address);
      console.log(
        `✅ userCollateral: ${ethers.formatUnits(userCollateral, 6)} USDC`
      );
    } catch (error) {
      console.log(`❌ userCollateral failed: ${error.message}`);
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  }
}

simpleTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
