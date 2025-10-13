const { ethers, network } = require("hardhat");
const { getContract } = require("../config/contracts");

async function main() {
  console.log("🚀 Starting user funding script...");

  const [deployer] = await ethers.getSigners();
  console.log(`🔑 Using deployer address: ${deployer.address}`);

  // Dynamically load the deployment file based on the current network
  const networkName = network.name === "hardhat" ? "localhost" : network.name;
  const deploymentFilePath = `../deployments/${networkName}-deployment.json`;
  console.log(`\n🔍 Loading deployment file from: ${deploymentFilePath}`);
  const deployment = require(deploymentFilePath);

  if (deployer.address.toLowerCase() !== deployment.deployer.toLowerCase()) {
    console.error(
      "❌ Error: The deployer address from your environment does not match the one in the deployment file."
    );
    console.error(`   Env Deployer: ${deployer.address}`);
    console.error(`   Deployment Deployer: ${deployment.deployer}`);
    process.exit(1);
  }

  const mockUSDC = await getContract("MOCK_USDC", { signer: deployer });
  console.log(
    `💰 MOCK_USDC contract loaded at: ${await mockUSDC.getAddress()}`
  );

  const usersToFund = deployment.allUsers.filter((user) =>
    user.role.startsWith("user")
  );
  const amountToFund = ethers.parseUnits("1000000", 6); // 1,000,000 USDC with 6 decimals

  console.log(
    `\n💸 Funding ${usersToFund.length} users with ${ethers.formatUnits(
      amountToFund,
      6
    )} USDC each...`
  );

  for (const user of usersToFund) {
    try {
      console.log(`\n--- Funding ${user.role} (${user.address}) ---`);
      const tx = await mockUSDC.transfer(user.address, amountToFund);
      console.log(`   ⏳ Transaction sent... hash: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Successfully funded!`);
      const balance = await mockUSDC.balanceOf(user.address);
      console.log(`   New balance: ${ethers.formatUnits(balance, 6)} USDC`);
    } catch (error) {
      console.error(
        `   ❌ Failed to fund ${user.role} (${user.address}):`,
        error.message
      );
    }
  }

  console.log("\n🎉 Funding script completed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
