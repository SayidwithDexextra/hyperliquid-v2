const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getContract } = require("../config/contracts");

const to6 = (n) => ethers.parseUnits(n.toString(), 6);
const to18 = (n) => ethers.parseUnits(n.toString(), 18);
const f6 = (v) => ethers.formatUnits(v, 6);
const f18 = (v) => ethers.formatUnits(v, 18);

describe("Mark Price Manipulation and Liquidation Test", function () {
  let admin, trader, counterparty, liquidator, manipulator;
  let usdc, vault, orderBook, marketId;
  let initialMarkPrice;

  beforeEach(async function () {
    [admin, , trader, counterparty, , liquidator, manipulator] =
      await ethers.getSigners();

    // Get contract configuration from deployment
    const deployment = require("../deployments/localhost-deployment.json");
    const MockUSDCArtifact = require("../artifacts/src/MockUSDC.sol/MockUSDC.json");
    const CentralizedVaultArtifact = require("../artifacts/src/CentralizedVault.sol/CentralizedVault.json");
    const OrderBookArtifact = require("../artifacts/src/OrderBook.sol/OrderBook.json");

    console.log("\n📋 Contract Configuration:");
    console.log("MOCK_USDC:", deployment.contracts.MOCK_USDC);
    console.log("CENTRALIZED_VAULT:", deployment.contracts.CENTRALIZED_VAULT);
    console.log("ALUMINUM_ORDERBOOK:", deployment.contracts.ALUMINUM_ORDERBOOK);
    console.log("Market ID:", deployment.aluminumMarket.marketId);

    // Connect to existing contracts
    console.log("\n🔌 Connecting to Existing Contracts...");
    try {
      usdc = new ethers.Contract(
        deployment.contracts.MOCK_USDC,
        MockUSDCArtifact.abi,
        admin
      );
      console.log("✅ Connected to MockUSDC");

      vault = new ethers.Contract(
        deployment.contracts.CENTRALIZED_VAULT,
        CentralizedVaultArtifact.abi,
        admin
      );
      console.log("✅ Connected to CentralizedVault");

      orderBook = new ethers.Contract(
        deployment.contracts.ALUMINUM_ORDERBOOK,
        OrderBookArtifact.abi,
        admin
      );
      console.log("✅ Connected to OrderBook");
    } catch (error) {
      console.error("❌ Error connecting to contracts:", error);
      throw error;
    }

    // Get market ID from deployment
    marketId = deployment.aluminumMarket.marketId;
    console.log("\n✅ Setup Complete");

    // Use standard funding amounts
    const fundAmount = to6(10000); // 10,000 USDC per user
    const collateralAmount = to6(1000); // 1,000 USDC collateral

    // Fund all accounts
    for (const account of [trader, counterparty, liquidator, manipulator]) {
      await usdc.mint(account.address, fundAmount);
      await usdc.connect(account).approve(vault.address, fundAmount);
      await vault.connect(account).depositCollateral(collateralAmount);
    }

    // Store initial mark price
    initialMarkPrice = await orderBook.calculateMarkPrice();
    console.log("Initial Mark Price:", f6(initialMarkPrice));
  });

  it("should manipulate mark price to trigger liquidation", async function () {
    console.log("\n🎯 STEP 1: Create initial short position");

    // Get market parameters from deployment
    const standardSize = to18(1); // Standard position size of 1 unit
    // Create a short position at current mark price
    console.log("Market parameters:", {
      symbol: "ALU-USD",
      longMarginRequirement: "100%",
      shortMarginRequirement: "150%",
      initialPrice: f6(initialMarkPrice),
    });

    // Place matching orders to create position
    await orderBook
      .connect(counterparty)
      .placeMarginLimitOrder(initialMarkPrice, standardSize, true);
    await orderBook
      .connect(trader)
      .placeMarginLimitOrder(initialMarkPrice, standardSize, false);

    // Get position details
    let positions = await vault.getUserPositions(trader.address);
    const position = positions.find((p) => p.marketId === marketId);
    expect(position).to.not.be.undefined;
    console.log("Position created:", {
      size: f18(position.size),
      entryPrice: f6(position.entryPrice),
      margin: f6(position.marginLocked),
    });

    // Get liquidation price
    const liquidationPrice = await orderBook.calculateLiquidationPrice(
      position.size,
      position.entryPrice,
      position.marginLocked,
      position.maintenanceMargin
    );
    console.log("Liquidation Price:", f6(liquidationPrice));

    console.log("\n🎯 STEP 2: Place strategic limit orders");

    // Calculate order sizes based on standard size
    const smallOrderSize = standardSize.div(5); // 0.2 units
    const priceSteps = 5;

    // Calculate price increments to reach liquidation
    const totalPriceRange = liquidationPrice.sub(initialMarkPrice);
    const priceIncrement = totalPriceRange.div(priceSteps);

    console.log("Order parameters:", {
      priceSteps,
      priceRange: `$${f6(totalPriceRange)}`,
      increment: `$${f6(priceIncrement)}`,
      orderSize: f18(smallOrderSize),
    });

    // Place orders at increasing prices
    for (let i = 1; i <= priceSteps; i++) {
      const price = initialMarkPrice.add(priceIncrement.mul(i));
      await orderBook
        .connect(manipulator)
        .placeMarginLimitOrder(price, smallOrderSize, true);
      console.log(
        `Placed buy order: ${f18(smallOrderSize)} units at $${f6(price)}`
      );
    }

    console.log("\n🎯 STEP 3: Execute market orders to push price");

    // Calculate final push parameters
    const finalOrderSize = standardSize.div(2); // 0.5 units
    const priceBuffer = 10; // 10% above liquidation price
    const finalPrice = liquidationPrice.mul(100 + priceBuffer).div(100);

    console.log("Final push parameters:", {
      size: f18(finalOrderSize),
      price: `$${f6(finalPrice)}`,
      buffer: `${priceBuffer}%`,
    });

    // Execute market buy to push price up
    await orderBook
      .connect(manipulator)
      .placeMarginLimitOrder(finalPrice, finalOrderSize, true);
    console.log(
      `Executed market buy: ${f18(finalOrderSize)} units at up to $${f6(
        finalPrice
      )}`
    );

    // Check new mark price
    const newMarkPrice = await orderBook.calculateMarkPrice();
    console.log("New Mark Price:", f6(newMarkPrice));

    console.log("\n🎯 STEP 4: Verify liquidation status");

    // Check if position can be liquidated
    const positionId = position.positionId;
    const canLiquidate = await orderBook.canLiquidate(
      trader.address,
      positionId
    );
    expect(canLiquidate).to.be.true;
    console.log("Position is liquidatable:", canLiquidate);

    // Execute liquidation
    await orderBook
      .connect(liquidator)
      .checkAndLiquidatePosition(trader.address, positionId);

    // Verify position is closed
    positions = await vault.getUserPositions(trader.address);
    const finalPosition = positions.find((p) => p.marketId === marketId);
    expect(finalPosition.isActive).to.be.false;
    console.log("Position successfully liquidated");

    // Check final balances
    const traderBalance = await vault.getAvailableBalance(trader.address);
    console.log("Final trader balance:", f6(traderBalance), "USDC");
  });
});
