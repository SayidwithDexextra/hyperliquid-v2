const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

const to6 = (n) => ethers.parseUnits(n.toString(), 6);
const to18 = (n) => ethers.parseUnits(n.toString(), 18);
const f6 = (v) => ethers.formatUnits(v, 6);
const f18 = (v) => ethers.formatUnits(v, 18);

describe("Liquidation with Liquidity Test", function () {
  let admin, trader, counterparty, liquidator;
  let usdc, vault, orderBook, marketId;

  beforeEach(async function () {
    [admin, , trader, counterparty, , liquidator] = await ethers.getSigners();

    // Get contracts
    usdc = await getContract("MOCK_USDC", { signer: admin });
    vault = await getContract("CENTRALIZED_VAULT", { signer: admin });
    orderBook = await getContract("ALUMINUM_ORDERBOOK", { signer: admin });
    // Get market ID from config
    const { MARKET_INFO } = require("../config/contracts");
    marketId = MARKET_INFO.ALUMINUM.marketId;

    // Get funding amounts from config
    const { USDC_PER_USER, COLLATERAL_PER_USER } = require("../scripts/deploy");
    const fundAmount = to6(USDC_PER_USER); // Default funding amount
    const collateralAmount = to6(COLLATERAL_PER_USER); // Default collateral amount
    await usdc.mint(trader.address, fundAmount);
    await usdc.mint(counterparty.address, fundAmount);
    await usdc.mint(liquidator.address, fundAmount);

    // Approve USDC spending
    await usdc.connect(trader).approve(vault.address, fundAmount);
    await usdc.connect(counterparty).approve(vault.address, fundAmount);
    await usdc.connect(liquidator).approve(vault.address, fundAmount);

    // Deposit USDC to vault
    await vault.connect(trader).depositCollateral(collateralAmount);
    await vault.connect(counterparty).depositCollateral(collateralAmount);
    await vault.connect(liquidator).depositCollateral(collateralAmount);
  });

  it("should liquidate a short position when price rises above liquidation price", async function () {
    console.log("🏗️ Setting up test scenario...");

    // Get initial mark price from config
    const initialMarkPrice = await orderBook.calculateMarkPrice();
    const positionSize = to18(1); // 1 unit standard size
    const isBuy = false; // short position

    console.log("📊 Creating short position:");
    console.log("- Entry Price:", f6(initialMarkPrice));
    console.log("- Size: 1 unit");

    // Place and match orders to create the position
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(initialMarkPrice, positionSize, true); // Buy order
    await orderBook
      .connect(trader)
      .placeMarginLimitOrder(initialMarkPrice, positionSize, false); // Sell order

    // Get position details
    const positions = await vault.getUserPositions(trader.address);
    const position = positions.find((p) => p.marketId === marketId);
    expect(position).to.not.be.undefined;
    console.log("✅ Position created successfully");

    // Calculate liquidation price using contract's function
    const liquidationPrice = await orderBook.calculateLiquidationPrice(
      position.size,
      position.entryPrice,
      position.marginLocked,
      position.maintenanceMargin
    );

    console.log("🎯 Target liquidation price: $" + f6(liquidationPrice));

    // Place orders around liquidation price
    console.log("\n📈 Adding liquidity around liquidation price...");

    // Calculate prices around liquidation price
    const priceBelowLiq = liquidationPrice.mul(95).div(100); // 5% below
    const priceNearLiq = liquidationPrice.mul(98).div(100); // 2% below
    const priceAboveLiq = liquidationPrice.mul(102).div(100); // 2% above
    const priceFarAbove = liquidationPrice.mul(105).div(100); // 5% above

    // Orders below liquidation price
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(priceBelowLiq, to18(0.2), true);
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(priceNearLiq, to18(0.3), true);

    // Orders above liquidation price
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(priceAboveLiq, to18(0.3), true);
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(priceFarAbove, to18(0.2), true);

    console.log("✅ Liquidity added successfully");

    // Attempt liquidation (should fail as price is still below liquidation)
    const positionId = position.positionId;
    let canLiquidate = await orderBook.canLiquidate(trader.address, positionId);
    expect(canLiquidate).to.be.false;
    console.log("✅ Position not liquidatable at current price");

    // Place a large market buy order to push price above liquidation
    console.log("\n🚀 Pushing price above liquidation threshold...");
    const priceFarAboveLiq = liquidationPrice.mul(110).div(100); // 10% above liquidation
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(priceFarAboveLiq, to18(1), true);

    // Now position should be liquidatable
    canLiquidate = await orderBook.canLiquidate(trader.address, positionId);
    expect(canLiquidate).to.be.true;
    console.log("✅ Position is now liquidatable");

    // Execute liquidation
    console.log("\n💥 Executing liquidation...");
    await orderBook
      .connect(liquidator)
      .checkAndLiquidatePosition(trader.address, positionId);

    // Verify position is closed
    const finalPositions = await vault.getUserPositions(trader.address);
    const finalPosition = finalPositions.find((p) => p.marketId === marketId);
    expect(finalPosition.isActive).to.be.false;
    console.log("✅ Position successfully liquidated");

    // Check final balances
    const traderBalance = await vault.getAvailableBalance(trader.address);
    console.log("Final trader balance:", f6(traderBalance), "USDC");
  });
});
