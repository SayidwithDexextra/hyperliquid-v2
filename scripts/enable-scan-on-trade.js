const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const deploymentPath = path.join(
    __dirname,
    "../deployments/hyperliquid-deployment.json"
  );
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const orderBook = deployment.contracts?.ALUMINUM_ORDERBOOK;
  if (!orderBook) throw new Error("Missing ALUMINUM_ORDERBOOK address");

  const obLiq = await ethers.getContractAt("OBLiquidationFacet", orderBook);
  const tx = await obLiq.setConfigLiquidationScanOnTrade(true);
  const receipt = await tx.wait();

  console.log("setConfigLiquidationScanOnTrade(true) tx:", receipt?.hash);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
