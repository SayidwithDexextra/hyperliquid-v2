const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getContract, MARKET_INFO } = require("../config/contracts");

const to6 = (n) => ethers.parseUnits(n.toString(), 6);
const to18 = (n) => ethers.parseUnits(n.toString(), 18);
const f6 = (v) => ethers.formatUnits(v, 6);

describe("Liquidation behavior - collateral and margin handling", function () {
  it("margin orders execute successfully and handle collateral correctly", async function () {
    const [admin, , trader, counterparty, , liquidator] =
      await ethers.getSigners();
    const usdc = await getContract("MOCK_USDC", { signer: admin });
    const vault = await getContract("CENTRALIZED_VAULT", { signer: admin });
    const orderBook = await getContract("ALUMINUM_ORDERBOOK", {
      signer: admin,
    });
    // Get the actual market ID from the deployed OrderBook
    const marketId = await orderBook.marketId();

    // Fund and approve all users
    for (const user of [trader, counterparty, liquidator]) {
      await usdc.mint(user.address, to6(100000));
      await usdc.connect(user).approve(vault.target, to6(100000));
      await vault.connect(user).depositCollateral(to6(100000));
    }

    // Baseline vault state
    const base = async (user) => ({
      avail: f6(await vault.getAvailableCollateral(user)),
      locked: f6(await vault.userMarginByMarket(user, marketId)),
      bal: f6(await vault.userCollateral(user)),
    });
    console.log("STATE before:", {
      trader: await base(trader.address),
      counterparty: await base(counterparty.address),
      liquidator: await base(liquidator.address),
    });

    // Open a short position for the trader
    const positionSize = to18(1); // 1 unit
    const positionPrice = to6(1.5); // 1.5 USDC
    const ONE_18 = to18(1);

    // Counterparty order debug + placement
    const cpMargin = (positionPrice * positionSize) / ONE_18;
    console.log("CP calcMargin (USDC):", f6(cpMargin));
    try {
      const tx = await orderBook
        .connect(counterparty)
        .placeMarginLimitOrder(positionPrice, positionSize, true);
      const rc = await tx.wait();
      try {
        const evs = await orderBook.queryFilter(
          orderBook.filters.DebugMarginCalculation?.() || {},
          rc.blockNumber,
          rc.blockNumber
        );
        if (evs && evs.length) {
          const e = evs[0];
          console.log("CP DebugMarginCalculation:", {
            amount: ethers.formatUnits(e.args?.amount ?? 0n, 18),
            price: f6(e.args?.price ?? 0n),
            isBuy: e.args?.isBuy,
            marginRequired: f6(e.args?.marginRequired ?? 0n),
          });
        }
      } catch (_) {}
    } catch (e) {
      console.log("CP placeMarginLimitOrder reverted:", e.message);
      throw e;
    }

    console.log("STATE after CP:", {
      counterparty: await base(counterparty.address),
    });

    // Trader order debug + placement
    const trMargin = (positionPrice * positionSize) / ONE_18;
    console.log("TR calcMargin (USDC):", f6(trMargin));
    try {
      const tx2 = await orderBook
        .connect(trader)
        .placeMarginLimitOrder(positionPrice, positionSize, false);
      const rc2 = await tx2.wait();
      try {
        const evs2 = await orderBook.queryFilter(
          orderBook.filters.DebugMarginCalculation?.() || {},
          rc2.blockNumber,
          rc2.blockNumber
        );
        if (evs2 && evs2.length) {
          const e2 = evs2[0];
          console.log("TR DebugMarginCalculation:", {
            amount: ethers.formatUnits(e2.args?.amount ?? 0n, 18),
            price: f6(e2.args?.price ?? 0n),
            isBuy: e2.args?.isBuy,
            marginRequired: f6(e2.args?.marginRequired ?? 0n),
          });
        }
      } catch (_) {}
    } catch (e) {
      console.log("TR placeMarginLimitOrder reverted:", e.message);
      throw e;
    }

    // Check position in vault
    const vaultPositions = await vault.getUserPositions(trader.address);
    console.log("Vault positions after match:", vaultPositions.length);
    console.log("Expected marketId:", marketId);

    // Debug: show all positions
    for (let i = 0; i < vaultPositions.length; i++) {
      console.log(`Position ${i}:`, {
        marketId: vaultPositions[i].marketId,
        size: ethers.formatUnits(vaultPositions[i].size, 18),
        entryPrice: f6(vaultPositions[i].entryPrice),
        marginLocked: f6(vaultPositions[i].marginLocked),
      });
    }

    // Find the position for this market
    let position = null;
    for (let i = 0; i < vaultPositions.length; i++) {
      if (vaultPositions[i].marketId === marketId) {
        position = vaultPositions[i];
        break;
      }
    }

    console.log("Position after match:", {
      found: position !== null,
      size: position ? ethers.formatUnits(position.size, 18) : "0",
      entryPrice: position ? f6(position.entryPrice) : "0",
      marginLocked: position ? f6(position.marginLocked) : "0",
    });

    if (position) {
      // Check that position exists and has the correct direction (negative for sell)
      expect(position.size).to.be.lt(0);
      console.log(
        "✅ Initial position check passed. Size:",
        ethers.formatUnits(position.size, 18)
      );
    }

    // Liquidator order to move mark price
    let liqPrice = to6(2);
    let liqSize = to18(1);
    let liqCalc = (liqPrice * liqSize) / ONE_18;
    if (liqCalc === 0n) {
      liqPrice = to6(100); // bump price to ensure > 0 margin
      liqCalc = (liqPrice * liqSize) / ONE_18;
    }
    if (liqCalc === 0n) {
      liqSize = to18(10); // as a fallback, bump size
      liqCalc = (liqPrice * liqSize) / ONE_18;
    }
    console.log("LIQ calcMargin (USDC):", f6(liqCalc));
    console.log("STATE before LIQ:", await base(liquidator.address));
    try {
      const tx3 = await orderBook
        .connect(liquidator)
        .placeMarginLimitOrder(liqPrice, liqSize, true);
      const rc3 = await tx3.wait();
      try {
        const evs3 = await orderBook.queryFilter(
          orderBook.filters.DebugMarginCalculation?.() || {},
          rc3.blockNumber,
          rc3.blockNumber
        );
        if (evs3 && evs3.length) {
          const e3 = evs3[0];
          console.log("LIQ DebugMarginCalculation:", {
            amount: ethers.formatUnits(e3.args?.amount ?? 0n, 18),
            price: f6(e3.args?.price ?? 0n),
            isBuy: e3.args?.isBuy,
            marginRequired: f6(e3.args?.marginRequired ?? 0n),
          });
        }
      } catch (_) {}
    } catch (e) {
      console.log("LIQ placeMarginLimitOrder reverted:", e.message);
      throw e;
    }

    // Check final state - verify the trade executed successfully
    const finalVaultPositions = await vault.getUserPositions(trader.address);
    console.log("Final vault positions:", finalVaultPositions.length);

    // Find the final position for this market
    let finalPosition = null;
    for (let i = 0; i < finalVaultPositions.length; i++) {
      if (finalVaultPositions[i].marketId === marketId) {
        finalPosition = finalVaultPositions[i];
        break;
      }
    }

    console.log("Final position:", {
      found: finalPosition !== null,
      size: finalPosition ? ethers.formatUnits(finalPosition.size, 18) : "0",
      entryPrice: finalPosition ? f6(finalPosition.entryPrice) : "0",
      marginLocked: finalPosition ? f6(finalPosition.marginLocked) : "0",
    });

    // Check margin state
    const lockedMargin = await vault.userMarginByMarket(
      trader.address,
      marketId
    );
    console.log("Locked margin after trade (USDC):", f6(lockedMargin));

    const finalCollateral = await vault.userCollateral(trader.address);
    console.log("Final collateral trader (USDC):", f6(finalCollateral));

    // Verify that the trade was successful
    if (finalPosition) {
      // Check that position exists and has the correct direction (negative for sell)
      expect(finalPosition.size).to.be.lt(0);
      expect(finalPosition.entryPrice).to.be.gt(0);
      console.log(
        "✅ Position created successfully with size:",
        ethers.formatUnits(finalPosition.size, 18)
      );
    } else {
      throw new Error("No position found after trade");
    }

    // Verify margin is locked appropriately
    expect(lockedMargin).to.be.gt(0);
    console.log("✅ Margin locked successfully:", f6(lockedMargin), "USDC");
  });
});

describe("OrderBook margin calculation debug", function () {
  it("should print calculated margin and catch reverts for various values", async function () {
    const [admin, , user] = await ethers.getSigners();
    const usdc = await getContract("MOCK_USDC", { signer: admin });
    const vault = await getContract("CENTRALIZED_VAULT", { signer: admin });
    const orderBook = await getContract("ALUMINUM_ORDERBOOK", {
      signer: admin,
    });
    // Get the actual market ID from the deployed OrderBook
    const marketId = await orderBook.marketId();

    await usdc.mint(user.address, to6(100000));
    await usdc.connect(user).approve(vault.target, to6(100000));
    await vault.connect(user).depositCollateral(to6(100000));

    const testCases = [
      { price: to6(1), size: to18(1) },
      { price: to6(10), size: to18(1) },
      { price: to6(100), size: to18(1) },
      { price: to6(1), size: to18(10) },
      { price: to6(100), size: to18(10) },
      { price: to6(0.5), size: to18(1) },
    ];

    const ONE_18 = to18(1);

    for (const { price, size } of testCases) {
      const avail = await vault.getAvailableCollateral(user.address);
      const locked = await vault.userMarginByMarket(user.address, marketId);
      const margin = (price * size) / ONE_18;
      console.log(
        `Trying price=${f6(price)} size=${ethers.formatUnits(
          size,
          18
        )} margin=${f6(margin)} avail=${f6(avail)} locked=${f6(locked)}`
      );
      try {
        const txx = await orderBook
          .connect(user)
          .placeMarginLimitOrder(price, size, true);
        const rxx = await txx.wait();
        try {
          const evsx = await orderBook.queryFilter(
            orderBook.filters.DebugMarginCalculation?.() || {},
            rxx.blockNumber,
            rxx.blockNumber
          );
          if (evsx && evsx.length) {
            const ex = evsx[0];
            console.log("DBG DebugMarginCalculation:", {
              amount: ethers.formatUnits(ex.args?.amount ?? 0n, 18),
              price: f6(ex.args?.price ?? 0n),
              isBuy: ex.args?.isBuy,
              marginRequired: f6(ex.args?.marginRequired ?? 0n),
            });
          }
        } catch (_) {}
        console.log("Order placed successfully");
      } catch (e) {
        console.log("Order reverted:", e.message);
      }
    }
  });
});
