const { ethers } = require("hardhat");

async function testVaultUpdate() {
  console.log("🔍 Testing Vault Update Position...");

  try {
    // Get signers
    const [deployer, user1] = await ethers.getSigners();
    console.log(`Deployer: ${deployer.address}`);
    console.log(`User1: ${user1.address}`);

    // Load contracts
    const deployedContracts = require("./deployments/localhost-deployment.json");
    const orderBook = await ethers.getContractAt(
      "OrderBook",
      deployedContracts.contracts.ALUMINUM_ORDERBOOK
    );
    const vault = await ethers.getContractAt(
      "CentralizedVault",
      deployedContracts.contracts.CENTRALIZED_VAULT
    );

    // Test different price values
    const testPrices = [
      ethers.parseUnits("1", 6), // 1 USDC (6 decimals)
      ethers.parseUnits("0.992467", 6), // Best bid price
      ethers.parseUnits("0.1", 6), // 0.1 USDC
      ethers.parseUnits("0.01", 6), // 0.01 USDC
      ethers.parseUnits("0.001", 6), // 0.001 USDC
      1, // 1 wei
      0, // 0 (should fail)
    ];

    const testAmount = ethers.parseEther("0.1"); // 0.1 ALU
    const marketId = deployedContracts.aluminumMarket.marketId;

    for (let i = 0; i < testPrices.length; i++) {
      const price = testPrices[i];
      console.log(
        `\n🧪 Test ${i + 1}: Price = ${price.toString()} (${ethers.formatUnits(
          price,
          6
        )} USDC)`
      );

      try {
        // Try to call updatePositionWithMargin directly
        const tx = await vault.connect(deployer).updatePositionWithMargin(
          user1.address,
          marketId,
          -int256(testAmount), // Sell order (negative)
          price,
          ethers.parseUnits("1", 6) // 1 USDC margin
        );

        console.log(`   ✅ Success! TX: ${tx.hash}`);

        // Revert the transaction for next test
        await tx.wait();
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

// Helper function to convert to int256
function int256(value) {
  return value;
}

// Run the test
testVaultUpdate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
