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

  const ob = await ethers.getContractAt("OBLiquidationFacet", orderBook);

  // Paginate in small windows to satisfy free-tier log limits
  const latest = await ethers.provider.getBlockNumber();
  const window = parseInt(process.env.LOG_WINDOW || "8", 10);
  const maxDepth = parseInt(process.env.MAX_SCAN_BLOCKS || "50000", 10);

  const filt = ob.filters.LiquidationConfigUpdated();
  let to = latest;
  let scanned = 0;
  let found = null;
  while (to >= 0 && scanned < maxDepth) {
    const from = Math.max(0, to - window);
    try {
      const chunk = await ob.queryFilter(filt, from, to);
      if (chunk.length) {
        found = chunk[chunk.length - 1];
        break;
      }
    } catch (e) {
      throw e;
    }
    scanned += to - from + 1;
    to = from > 0 ? from - 1 : -1;
  }

  if (!found) {
    console.log(
      "No LiquidationConfigUpdated events found within",
      scanned,
      "blocks."
    );
    console.log("Result indeterminate (default is false unless set).");
    console.log(
      "Tip: run npm run enable:scan-on-trade to emit event, then re-run."
    );
    return;
  }

  const scanOnTrade = found.args?.[0];
  const debug = found.args?.[1];
  console.log("OrderBook:", orderBook);
  console.log("scanOnTrade:", scanOnTrade);
  console.log("liquidationDebug:", debug);
  console.log("eventBlock:", found.blockNumber);
  console.log("tx:", found.transactionHash);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
