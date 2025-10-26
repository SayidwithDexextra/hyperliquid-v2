const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const deploymentPath = path.join(
    __dirname,
    "../deployments/hyperliquid-deployment.json"
  );
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const coreVaultAddr = deployment.contracts?.CORE_VAULT;
  const marketId =
    deployment.contracts?.ALUMINUM_MARKET_ID ||
    deployment.aluminumMarket?.marketId;

  if (!coreVaultAddr) {
    throw new Error("Missing CORE_VAULT address in deployment JSON");
  }
  if (!marketId) {
    throw new Error("Missing ALUMINUM_MARKET_ID in deployment JSON");
  }

  const user =
    process.env.QUERY_USER || "0xcB641417acE8281f4BC9c58775456Ea204979E9d";

  const coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);

  const [liqPrice, hasPosition] = await coreVault.getLiquidationPrice(
    user,
    marketId
  );
  const underLiq = await coreVault.isUnderLiquidationPosition(user, marketId);

  const fmt6 = (x) => {
    try {
      return ethers.formatUnits(x, 6);
    } catch {
      return x?.toString?.() ?? String(x);
    }
  };

  const net = await ethers.provider.getNetwork();
  console.log("Network:", net.name || net.chainId);
  console.log("CoreVault:", coreVaultAddr);
  console.log("MarketId:", marketId);
  console.log("User:", user);
  console.log("hasPosition:", hasPosition);
  console.log("liquidationPrice(6d):", liqPrice.toString());
  console.log("liquidationPrice($):", fmt6(liqPrice));
  console.log("isUnderLiquidationPosition:", underLiq);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
