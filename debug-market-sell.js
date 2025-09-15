const { ethers } = require("hardhat");

async function debugMarketSell() {
  console.log("🔍 Debugging Market Sell Order...");

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

    // Check current order book state
    const bestBid = await orderBook.bestBid();
    const bestAsk = await orderBook.bestAsk();
    console.log(`\n📊 Current Order Book:`);
    console.log(`Best Bid: ${ethers.formatEther(bestBid)}`);
    console.log(`Best Ask: ${ethers.formatEther(bestAsk)}`);

    // Check user1's collateral
    const marginSummary = await vault.getMarginSummary(user1.address);
    console.log(`\n💰 User1 Collateral:`);
    console.log(
      `Total: ${ethers.formatUnits(marginSummary.totalCollateral, 6)} USDC`
    );
    console.log(
      `Available: ${ethers.formatUnits(
        marginSummary.availableCollateral,
        6
      )} USDC`
    );

    // Try a small market sell order
    const sellAmount = ethers.parseEther("0.1"); // Very small amount
    console.log(
      `\n🎯 Attempting market sell: ${ethers.formatEther(sellAmount)} ALU`
    );

    try {
      // Try with slippage protection
      const slippageBps = 1000; // 10% slippage
      console.log(`Using slippage: ${slippageBps} bps (${slippageBps / 100}%)`);

      // First try a static call to see what would happen
      try {
        const staticResult = await orderBook
          .connect(user1)
          .placeMarginMarketOrderWithSlippage.staticCall(
            sellAmount,
            false,
            slippageBps
          );
        console.log(
          `Static call result: ${ethers.formatEther(staticResult)} ALU`
        );
      } catch (staticError) {
        console.log(`Static call failed: ${staticError.message}`);
      }

      const tx = await orderBook
        .connect(user1)
        .placeMarginMarketOrderWithSlippage(sellAmount, false, slippageBps);

      console.log("⏳ Transaction submitted...");
      const receipt = await tx.wait();
      console.log("✅ Market sell successful!");
      console.log(`Gas used: ${receipt.gasUsed}`);
    } catch (error) {
      console.log(`❌ Market sell failed: ${error.message}`);

      // Try to get more details about the error
      if (error.message.includes("amount must be positive")) {
        console.log("\n🔍 Debugging amount issue...");

        // Check if the issue is with the amount calculation
        console.log(`Sell amount (wei): ${sellAmount.toString()}`);
        console.log(`Sell amount (ether): ${ethers.formatEther(sellAmount)}`);

        // Check if there are any orders in the book
        const depth = await orderBook.getOrderBookDepth(5);
        console.log(`\n📊 Order Book Depth:`);
        console.log(
          `Bid prices: ${depth.bidPrices.map((p) => ethers.formatEther(p))}`
        );
        console.log(
          `Bid amounts: ${depth.bidAmounts.map((a) => ethers.formatEther(a))}`
        );
        console.log(
          `Ask prices: ${depth.askPrices.map((p) => ethers.formatEther(p))}`
        );
        console.log(
          `Ask amounts: ${depth.askAmounts.map((a) => ethers.formatEther(a))}`
        );

        // Check if the issue is with price calculation
        if (bestBid > 0) {
          console.log(`\n🔍 Price analysis:`);
          console.log(`Best bid (wei): ${bestBid.toString()}`);
          console.log(`Best bid (ether): ${ethers.formatEther(bestBid)}`);
          console.log(
            `Best bid (6 decimals): ${ethers.formatUnits(bestBid, 6)}`
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
  }
}

// Run the debug
debugMarketSell()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
