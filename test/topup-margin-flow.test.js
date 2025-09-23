const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("../config/contracts");

describe("Top-up Position After Deploy (uses existing market)", function () {
  let deployer, user1, user2, user3;
  let coreVault, orderBook;
  let marketId;

  before(async function () {
    [deployer, user1, user2, user3] = await ethers.getSigners();
    coreVault = await getContract("CORE_VAULT");
    orderBook = await getContract("ALUMINUM_ORDERBOOK");

    // Get market ID from user3's actual position instead of config
    const positions = await coreVault.getUserPositions(user3.address);
    if (positions.length === 0) {
      throw new Error(
        "User3 has no positions. Run scripts/deploy.js on localhost first."
      );
    }
    marketId = positions[0].marketId; // Use actual market ID from user3's position
    console.log("Using market ID from user3's position:", marketId);
  });
  it("tops up user3's liquidatable short to postpone liquidation", async function () {
    // Ensure user3 has an existing position
    const [sizeBefore, entryPrice, marginLockedBefore] =
      await coreVault.getPositionSummary(user3.address, marketId);
    console.log("marketId", marketId);
    console.log("sizeBefore", sizeBefore);
    console.log("entryPrice", entryPrice);
    console.log("marginLockedBefore", marginLockedBefore);
    if (sizeBefore === 0n) {
      expect.fail(
        "User3 has no position. Run scripts/deploy.js on localhost before this test."
      );
    }

    // Set mark price to $5 which makes the short position liquidatable
    // (debug showed: at $5, equity = -$25 < maintenance = $5)
    const chosenPrice = ethers.parseUnits("5", 6);
    await coreVault.connect(deployer).updateMarkPrice(marketId, chosenPrice);

    const liquidatable = await coreVault.isLiquidatable(
      user3.address,
      marketId,
      chosenPrice
    );
    expect(liquidatable, "Position should be liquidatable at $5").to.equal(
      true
    );

    // Compute required top-up so equity >= maintenance (in 6 decimals)
    const TICK_PRECISION = 10n ** 6n;
    const DECIMAL_SCALE = 10n ** 12n;
    const MAINTENANCE_BPS = 1000n;

    const size = sizeBefore; // int256
    const absSize = size < 0n ? -size : size;
    const notional6 = (absSize * chosenPrice) / 10n ** 18n;
    const maintenance6 = (notional6 * MAINTENANCE_BPS) / 10000n;
    const pnl18 =
      ((BigInt(chosenPrice) - BigInt(entryPrice)) * size) / TICK_PRECISION;
    const pnl6 = pnl18 / DECIMAL_SCALE;
    const equity6 = BigInt(marginLockedBefore) + pnl6;

    expect(
      equity6 < maintenance6,
      "Precondition failed: position should be liquidatable"
    ).to.equal(true);

    const needed = maintenance6 - equity6 + 1n; // +1 wei to be safely above threshold
    const available = await coreVault.getAvailableCollateral(user3.address);
    expect(
      available >= needed,
      "Insufficient available collateral for top-up"
    ).to.equal(true);

    const totalLockedBefore = await coreVault.totalMarginLocked();

    // Top up and expect event
    await expect(coreVault.connect(user3).topUpPositionMargin(marketId, needed))
      .to.emit(coreVault, "MarginToppedUp")
      .withArgs(user3.address, marketId, needed);

    // Verify state updated
    const [sizeAfter, entryAfter, marginLockedAfter] =
      await coreVault.getPositionSummary(user3.address, marketId);
    const totalLockedAfter = await coreVault.totalMarginLocked();

    expect(sizeAfter).to.equal(sizeBefore);
    expect(entryAfter).to.equal(entryPrice);
    expect(marginLockedAfter - marginLockedBefore).to.equal(needed);
    expect(totalLockedAfter - totalLockedBefore).to.equal(needed);

    // Re-check liquidatability at the same price (should be false now)
    const liqAfter = await coreVault.isLiquidatable(
      user3.address,
      marketId,
      chosenPrice
    );
    expect(liqAfter).to.equal(false);
  });
});
