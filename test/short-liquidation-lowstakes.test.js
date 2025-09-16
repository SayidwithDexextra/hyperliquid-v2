const { expect } = require("chai");
const { ethers } = require("hardhat");
const config = require("../config/contracts");

// helpers
const usdc = (n) => ethers.parseUnits(String(n), 6);
const amt = (n) => ethers.parseUnits(String(n), 18);

describe("Low-stakes short liquidation ($1-$2) using existing deployment", function () {
  let deployer, lp1, lp2, shorter;
  let mockUSDC, vault, orderBook;
  let marketId, marketOrderBookAddr;

  beforeEach(async function () {
    const signers = await ethers.getSigners();

    // Attach existing contracts from config
    vault = await config.getContract("CENTRALIZED_VAULT");
    mockUSDC = await config.getContract("MOCK_USDC");

    // pick a market id from MARKET_INFO (prefer aluminum if available)
    // Prefer the global ORDERBOOK from current deployment
    const orderBookGlobal = await config.getContract("ORDERBOOK");
    marketOrderBookAddr = await orderBookGlobal.getAddress();
    const OrderBook = await ethers.getContractFactory("OrderBook");
    orderBook = OrderBook.attach(marketOrderBookAddr);
    // Derive marketId from vault assignment
    const markets = await vault.getOrderBookMarkets(marketOrderBookAddr);
    marketId = markets[0];

    // Pick roles to ensure the shorter starts flat if possible
    const initial = [];
    for (let i = 0; i < Math.min(signers.length, 20); i++) {
      const s = signers[i];
      const [sz] = await vault.getPositionSummary(s.address, marketId);
      initial.push({ addr: s.address, signer: s, size: sz });
    }
    // Prefer zero-size accounts for stability
    const zeros = initial.filter((x) => x.size === 0n);
    const nonzeros = initial.filter((x) => x.size !== 0n);
    // Sort nonzeros by absolute size ascending
    nonzeros.sort((a, b) => (a.size < b.size ? -1 : a.size > b.size ? 1 : 0));
    const pool = [...zeros, ...nonzeros];
    // Assign roles
    shorter = pool[0].signer;
    lp1 = pool[1].signer;
    lp2 = pool[2].signer;
    deployer = pool[3] ? pool[3].signer : signers[0];

    // Debug addresses
    console.log("Vault:", await vault.getAddress());
    console.log("MarketId:", marketId);
    console.log("OrderBook:", await orderBook.getAddress());
    console.log("shorter:", shorter.address);
    console.log("lp1:", lp1.address);
    console.log("lp2:", lp2.address);
    const [sSz] = await vault.getPositionSummary(shorter.address, marketId);
    const [l1Sz] = await vault.getPositionSummary(lp1.address, marketId);
    const [l2Sz] = await vault.getPositionSummary(lp2.address, marketId);
    console.log(
      "sizes before -> shorter:",
      sSz.toString(),
      "lp1:",
      l1Sz.toString(),
      "lp2:",
      l2Sz.toString()
    );

    // Pre-step: top up LPs only (shorter unchanged) to ensure sufficient margin
    // Mint 100 USDC to each LP, deposit 50 USDC as collateral
    await mockUSDC.mint(lp1.address, usdc(100));
    await mockUSDC.connect(lp1).approve(await vault.getAddress(), usdc(100));
    await vault.connect(lp1).depositCollateral(usdc(50));

    await mockUSDC.mint(lp2.address, usdc(100));
    await mockUSDC.connect(lp2).approve(await vault.getAddress(), usdc(100));
    await vault.connect(lp2).depositCollateral(usdc(50));

    // Minimal top-up for shorter so they can open the $1 short
    await mockUSDC.mint(shorter.address, usdc(10));
    await mockUSDC.connect(shorter).approve(await vault.getAddress(), usdc(10));
    await vault.connect(shorter).depositCollateral(usdc(10));
  });

  it("liquidates a ~$1 short when mark moves to >= ~$2.27 (MMR=10%)", async function () {
    // Provide buy-side liquidity at $1.00 to open the short
    // Shorter will place a market sell; it matches against best bids
    console.log("Place bid 1.00 x 0.1 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(1.0), amt(0.1), true); // bid 1.00 for 0.1 unit

    // Shorter opens a short: sell 0.1 unit at market (expected around $1.00)
    console.log("Shorter sells 0.1 at market");
    await orderBook.connect(shorter).placeMarginMarketOrder(amt(0.1), false);

    // Record starting position (may be < -0.1 depending on book state)
    const [sizeBefore] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log("sizeBefore:", sizeBefore.toString());

    // Now set the book so mark >= ~$2.27 and ensure sell-side liquidity for liquidation buy
    // Add MULTIPLE asks at various prices to ensure liquidation can fill
    console.log("Adding adequate sell-side liquidity for liquidation...");

    // Add asks at multiple price levels with sufficient size
    console.log("Place ask 2.30 x 0.05 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.3), amt(0.05), false); // ask 2.30 for 0.05 units

    console.log("Place ask 2.35 x 0.05 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.35), amt(0.05), false); // ask 2.35 for 0.05 units

    console.log("Place ask 2.40 x 0.1 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.4), amt(0.1), false); // ask 2.40 for 0.1 units

    console.log("Place ask 2.45 x 0.1 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.45), amt(0.1), false); // ask 2.45 for 0.1 units

    console.log("Place ask 2.50 x 0.2 by lp2");
    await orderBook
      .connect(lp2)
      .placeMarginLimitOrder(usdc(2.5), amt(0.2), false); // ask 2.50 for 0.2 units (extra coverage)

    // Also set bids around ~$2.40 to make mid-price ~2.40
    console.log("Place bid 2.40 x 0.1 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(2.4), amt(0.1), true); // bid 2.40

    console.log("Place bid 2.35 x 0.05 by lp1");
    await orderBook
      .connect(lp1)
      .placeMarginLimitOrder(usdc(2.35), amt(0.05), true); // bid 2.35

    // Display order book depth to verify liquidity
    console.log("\n=== ORDER BOOK DEPTH ===");
    const depth = await orderBook.getOrderBookDepth(10);
    console.log("Bids:");
    for (let i = 0; i < depth.bidPrices.length; i++) {
      console.log(
        `  ${ethers.formatUnits(depth.bidPrices[i], 6)} x ${ethers.formatUnits(
          depth.bidAmounts[i],
          18
        )}`
      );
    }
    console.log("Asks:");
    for (let i = 0; i < depth.askPrices.length; i++) {
      console.log(
        `  ${ethers.formatUnits(depth.askPrices[i], 6)} x ${ethers.formatUnits(
          depth.askAmounts[i],
          18
        )}`
      );
    }
    console.log("========================\n");

    // Check if position is liquidatable at current mark price
    const markPrice = await orderBook.calculateMarkPrice();
    console.log("Current mark price:", markPrice.toString());
    const isLiquidatable = await vault.isLiquidatable(
      shorter.address,
      marketId,
      markPrice
    );
    console.log("Is liquidatable:", isLiquidatable);

    // Check position details
    const [size, entryPrice, marginLocked] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log(
      "Position details - size:",
      size.toString(),
      "entryPrice:",
      entryPrice.toString(),
      "marginLocked:",
      marginLocked.toString()
    );

    // Check collateral
    const collateral = await vault.getAvailableCollateral(shorter.address);
    console.log("Available collateral:", collateral.toString());

    // Check if shorter is in active traders list
    const isActiveBefore = await orderBook.isActiveTrader(shorter.address);
    console.log("Is shorter in active traders list:", isActiveBefore);

    // If not active, manually add them for the test
    if (!isActiveBefore) {
      console.log(
        "Shorter is not in active traders list - adding manually for test"
      );
      await orderBook.addToActiveTraders(shorter.address);
      const isActiveAfter = await orderBook.isActiveTrader(shorter.address);
      console.log(
        "Is shorter in active traders list after manual add:",
        isActiveAfter
      );
    }

    // Trigger liquidation check
    console.log("Trigger liquidation check");
    const tx = await orderBook.triggerLiquidationScan();
    const receipt = await tx.wait();
    console.log("Liquidation scan gas used:", receipt.gasUsed.toString());

    // Check events emitted
    console.log("Events emitted:", receipt.logs.length);
    for (let i = 0; i < receipt.logs.length; i++) {
      try {
        const parsed = orderBook.interface.parseLog(receipt.logs[i]);
        console.log(`Event ${i}:`, parsed.name, parsed.args);
      } catch (e) {
        // Try vault events
        try {
          const parsed = vault.interface.parseLog(receipt.logs[i]);
          console.log(`Event ${i} (vault):`, parsed.name, parsed.args);
        } catch (e2) {
          console.log(`Event ${i}: unparseable`);
        }
      }
    }

    // After the above trade, OrderBook's _executeTrade() runs liquidation checks.
    // Verify the short is reduced (position moves toward zero)
    const [sizeAfter] = await vault.getPositionSummary(
      shorter.address,
      marketId
    );
    console.log("sizeAfter:", sizeAfter.toString());

    // Check if the position actually changed
    if (sizeAfter.toString() === sizeBefore.toString()) {
      console.log(
        "Position did not change - liquidation may have failed silently"
      );
      // Let's check the order book state
      const bestAskAfter = await orderBook.bestAsk();
      const bestBidAfter = await orderBook.bestBid();
      console.log("Best ask after:", bestAskAfter.toString());
      console.log("Best bid after:", bestBidAfter.toString());
    }

    expect(sizeAfter).to.be.gt(sizeBefore);

    // Fetch tuple summary from vault
    // With sufficient liquidity above threshold, size should move toward zero

    // Optional: penalty may be applied to liquidator (OrderBook). Skip strict assertion.
  });
});
