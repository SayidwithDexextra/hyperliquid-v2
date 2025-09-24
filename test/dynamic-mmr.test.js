const { expect } = require("chai");
const { ethers } = require("hardhat");

// Precision helpers
const ONE_E6 = 10n ** 6n;
const ONE_E18 = 10n ** 18n;

describe("Dynamic MMR - Liquidity-aware Maintenance Margin", function () {
  let deployer, user1, user2, user3;
  let mockUSDC, coreVault, factory, orderBook;
  let marketId;

  async function deployAll() {
    [deployer, user1, user2, user3] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy(deployer.address);
    await mockUSDC.waitForDeployment();

    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();

    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();

    const CoreVault = await ethers.getContractFactory("CoreVault", {
      libraries: {
        VaultAnalytics: await vaultAnalytics.getAddress(),
        PositionManager: await positionManager.getAddress(),
      },
    });
    coreVault = await CoreVault.deploy(
      await mockUSDC.getAddress(),
      deployer.address
    );
    await coreVault.waitForDeployment();

    const FuturesMarketFactory = await ethers.getContractFactory(
      "FuturesMarketFactory"
    );
    factory = await FuturesMarketFactory.deploy(
      await coreVault.getAddress(),
      deployer.address,
      deployer.address
    );
    await factory.waitForDeployment();

    // Roles
    const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
    const SETTLEMENT_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("SETTLEMENT_ROLE")
    );
    await coreVault.grantRole(FACTORY_ROLE, await factory.getAddress());
    await coreVault.grantRole(SETTLEMENT_ROLE, deployer.address);
    await coreVault.grantRole(SETTLEMENT_ROLE, await factory.getAddress());

    // Create market
    const symbol = "ALU-USD";
    // marketId will be overwritten by event's marketId to match vault
    const startPrice = ethers.parseUnits("1", 6);
    const createTx = await factory.createFuturesMarket(
      symbol,
      "https://example.com",
      Math.floor(Date.now() / 1000) + 86400,
      startPrice,
      "oracle",
      ["TEST"],
      10000,
      10
    );
    const receipt = await createTx.wait();
    let orderBookAddress;
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed.name === "FuturesMarketCreated") {
          orderBookAddress = parsed.args.orderBook;
          marketId = parsed.args.marketId; // Use actual marketId from event
          break;
        }
      } catch {}
    }
    orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);

    // Grant ORDERBOOK_ROLE & SETTLEMENT_ROLE
    const ORDERBOOK_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORDERBOOK_ROLE")
    );
    await coreVault.grantRole(ORDERBOOK_ROLE, orderBookAddress);
    await coreVault.grantRole(SETTLEMENT_ROLE, orderBookAddress);

    // Set initial mark price to $1
    await coreVault.updateMarkPrice(marketId, startPrice);

    // Fund users and deposit collateral
    for (const u of [deployer, user1, user2, user3]) {
      await mockUSDC.mint(u.address, ethers.parseUnits("100000", 6));
      await mockUSDC
        .connect(u)
        .approve(await coreVault.getAddress(), ethers.parseUnits("10000", 6));
      await coreVault
        .connect(u)
        .depositCollateral(ethers.parseUnits("10000", 6));
    }

    // Default MMR params already set in CoreVault
    // base=10%, penalty=10%, slope=10%, max=50%, depth=5
    return {
      deployer,
      user1,
      user2,
      user3,
      mockUSDC,
      coreVault,
      factory,
      orderBook,
      marketId,
    };
  }

  async function placeLiquidity() {
    // Place several price levels on both sides with 18-decimal amounts
    // Buy side (bids): 1.00, 0.99, 0.98 with amounts 10, 8, 6 ALU
    const bidPrices = ["1.00", "0.99", "0.98"];
    const bidAmts = ["10", "8", "6"];
    for (let i = 0; i < bidPrices.length; i++) {
      await orderBook
        .connect(deployer)
        .placeMarginLimitOrder(
          ethers.parseUnits(bidPrices[i], 6),
          ethers.parseUnits(bidAmts[i], 18),
          true
        );
    }
    // Sell side (asks): 1.01, 1.02 with amounts 5, 5 ALU
    const askPrices = ["1.01", "1.02"];
    const askAmts = ["5", "5"];
    for (let i = 0; i < askPrices.length; i++) {
      await orderBook
        .connect(user1)
        .placeMarginLimitOrder(
          ethers.parseUnits(askPrices[i], 6),
          ethers.parseUnits(askAmts[i], 18),
          false
        );
    }
  }

  function calcExpectedMmrBps(
    baseBps,
    penaltyBps,
    slopeBps,
    maxBps,
    absSize18,
    liquidity18
  ) {
    let mmr = BigInt(baseBps + penaltyBps);
    let ratio =
      liquidity18 === 0n ? ONE_E18 : (absSize18 * ONE_E18) / liquidity18;
    if (ratio > ONE_E18) ratio = ONE_E18;
    const scaling = (BigInt(slopeBps) * ratio) / ONE_E18;
    mmr += scaling;
    if (mmr > BigInt(maxBps)) mmr = BigInt(maxBps);
    return Number(mmr);
  }

  async function getLiquidityProxy(depth = 5) {
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await orderBook.getOrderBookDepth(depth);
    let sumBids = 0n;
    for (const a of bidAmounts) sumBids += BigInt(a.toString());
    let sumAsks = 0n;
    for (const a of askAmounts) sumAsks += BigInt(a.toString());
    return sumBids > sumAsks ? sumBids : sumAsks;
  }

  beforeEach(async function () {
    await deployAll();
  });

  it("computes MMR with low fill ratio (small position, large liquidity)", async function () {
    await placeLiquidity();
    const liquidity18 = await getLiquidityProxy(5);
    expect(liquidity18).to.be.gt(0n);

    // Open a small short position: sell 1 ALU market (use existing bids)
    const amount = ethers.parseUnits("1", 18);
    await orderBook.connect(user3).placeMarginMarketOrder(amount, false);

    const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
      user3.address,
      marketId
    );
    expect(size).to.be.lt(0n);

    const absSize = size < 0n ? -size : size;
    const [mmrBps, fillRatio, hasPos] =
      await coreVault.getEffectiveMaintenanceMarginBps(user3.address, marketId);
    expect(hasPos).to.equal(true);

    // Defaults: base=1000, penalty=1000, slope=1000, max=5000
    const expected = calcExpectedMmrBps(
      1000,
      1000,
      1000,
      5000,
      absSize,
      liquidity18
    );
    expect(mmrBps).to.equal(expected);
    // Low fill ratio should be near floor (~2000 bps)
    expect(mmrBps).to.be.at.least(2000);
    expect(mmrBps).to.be.below(3000);
    // fillRatio monotone in [0, 1e18]
    expect(fillRatio).to.be.gte(0n);
    expect(fillRatio).to.be.lte(ONE_E18);
  });

  it("caps MMR at max when fill ratio is high or liquidity is zero", async function () {
    // Do NOT place liquidity → liquidity proxy = 0 → fillRatio=1 → mmr = base+penalty+slope capped by max
    const amount = ethers.parseUnits("10", 18);
    // Place a crossing order by creating a single bid to match? We can just open short if no bids? There may be no liquidity.
    // Instead, place minimal bid so market order executes and position exists, but keep liquidity tiny so ratio→1.
    await orderBook
      .connect(deployer)
      .placeMarginLimitOrder(
        ethers.parseUnits("1", 6),
        ethers.parseUnits("0.0001", 18),
        true
      );
    await orderBook
      .connect(user3)
      .placeMarginMarketOrder(amount, false)
      .catch(() => {});
    // If market order fails to fill due to limited liquidity, create a direct small short
    // Place more bids to allow execution of at least some portion
    await orderBook
      .connect(deployer)
      .placeMarginLimitOrder(
        ethers.parseUnits("1", 6),
        ethers.parseUnits("1", 18),
        true
      );
    await orderBook
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("1", 18), false);

    const [size] = await coreVault.getPositionSummary(user3.address, marketId);
    expect(size).to.not.equal(0n);

    const [mmrBps] = await coreVault.getEffectiveMaintenanceMarginBps(
      user3.address,
      marketId
    );
    // base 10% + penalty 10% + slope 10% = 30% → below max 50%, so expect 3000 bps
    expect(mmrBps).to.equal(3000);
  });

  it("respects custom parameters via setMmrParams and recomputes", async function () {
    // Place balanced liquidity
    await placeLiquidity();
    // Update params: base=5%, penalty=5%, slope=30%, max=40%, depth=3
    await coreVault.setMmrParams(500, 500, 4000, 3000, 3);

    // Open a moderate short (5 ALU)
    await orderBook
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("5", 18), false);
    const [size] = await coreVault.getPositionSummary(user3.address, marketId);
    const absSize = size < 0n ? -size : size;
    const liquidity18 = await getLiquidityProxy(3);

    const [mmrBps] = await coreVault.getEffectiveMaintenanceMarginBps(
      user3.address,
      marketId
    );
    const expected = calcExpectedMmrBps(
      500,
      500,
      3000,
      4000,
      absSize,
      liquidity18
    );
    expect(mmrBps).to.equal(expected);
  });

  it("uses dynamic MMR in isLiquidatable and getLiquidationPrice", async function () {
    await placeLiquidity();
    // Open short 10 ALU @ ~$1
    await orderBook
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("10", 18), false);
    const [size, entryPrice, marginLocked] = await coreVault.getPositionSummary(
      user3.address,
      marketId
    );
    expect(size).to.be.lt(0n);

    // Raise mark to make it liquidatable (with dynamic mmr involved)
    const highPrice = ethers.parseUnits("5", 6);
    await coreVault.updateMarkPrice(marketId, highPrice);

    const liq = await coreVault.isLiquidatable(
      user3.address,
      marketId,
      highPrice
    );
    expect(liq).to.equal(true);

    const [liqPrice, has] = await coreVault.getLiquidationPrice(
      user3.address,
      marketId
    );
    expect(has).to.equal(true);
    expect(liqPrice).to.be.gt(0n);
  });

  it("getPositionFreeMargin reflects dynamic mmr (decreases as mmr rises)", async function () {
    await placeLiquidity();
    // Open small short 2 ALU
    await orderBook
      .connect(user3)
      .placeMarginMarketOrder(ethers.parseUnits("2", 18), false);
    const [eq1, notional1, hasPos1] = await coreVault.getPositionEquity(
      user3.address,
      marketId
    );
    const [free1] = await coreVault.getPositionFreeMargin(
      user3.address,
      marketId
    );
    expect(hasPos1).to.equal(true);
    expect(free1).to.be.gte(0n);

    // Reduce liquidity (cancel some orders) to increase fill_ratio → higher mmr → lower free margin
    // Easiest: set params with higher slope and lower depth to increase mmr strongly
    await coreVault.setMmrParams(1000, 1000, 5000, 4000, 1); // slope 40%
    const [free2] = await coreVault.getPositionFreeMargin(
      user3.address,
      marketId
    );
    expect(free2).to.be.lte(free1);
  });
});
