const { ethers } = require("hardhat");

async function main() {
  const provider = ethers.provider;

  // Check latest deployment addresses
  const deploymentInfo = require("../deployments/localhost-deployment.json");

  console.log("\nChecking deployment status...");

  for (const [name, address] of Object.entries(deploymentInfo.contracts)) {
    const code = await provider.getCode(address);
    console.log(`${name}: ${address} - Code length: ${code.length}`);
  }

  // Also check the aluminum orderbook
  if (deploymentInfo.aluminumMarket) {
    const code = await provider.getCode(
      deploymentInfo.aluminumMarket.orderBook
    );
    console.log(
      `ALUMINUM_ORDERBOOK: ${deploymentInfo.aluminumMarket.orderBook} - Code length: ${code.length}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
