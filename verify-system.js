const { ethers } = require("hardhat");
const {
  getContract,
  getCoreContracts,
  ADDRESSES,
  ROLES,
  MARKET_INFO,
  checkAuthorization,
} = require("./config/contracts");

async function main() {
  console.log("🔍 Verifying System Configuration and Authorization\n");

  const [deployer] = await ethers.getSigners();

  try {
    // 1. Verify all contracts are deployed
    console.log("📋 VERIFYING CONTRACT DEPLOYMENT:");
    console.log("═".repeat(60));

    const contracts = {};
    let allDeployed = true;

    for (const [key, address] of Object.entries(ADDRESSES)) {
      try {
        const code = await ethers.provider.getCode(address);
        const isDeployed = code !== "0x";
        contracts[key] = isDeployed;

        console.log(
          `${key.padEnd(25)} │ ${address} │ ${isDeployed ? "✅" : "❌"}`
        );

        if (!isDeployed) allDeployed = false;
      } catch (error) {
        console.log(`${key.padEnd(25)} │ ${address} │ ❌ (Error)`);
        allDeployed = false;
      }
    }

    console.log("═".repeat(60));
    console.log(
      `Deployment Status: ${
        allDeployed ? "✅ All contracts deployed" : "❌ Some contracts missing"
      }`
    );

    // 2. Verify authorization
    console.log("\n📋 VERIFYING AUTHORIZATION:");
    console.log("═".repeat(60));

    const authStatus = await checkAuthorization();

    // 3. Verify contract connections
    console.log("\n📋 VERIFYING CONTRACT CONNECTIONS:");
    console.log("═".repeat(60));

    const vault = await getContract("CENTRALIZED_VAULT");
    const factory = await getContract("FUTURES_MARKET_FACTORY");
    const router = await getContract("TRADING_ROUTER");
    const orderBook = await getContract("ORDERBOOK");
    const usdc = await getContract("MOCK_USDC");

    // Check vault connections
    console.log("CentralizedVault:");
    const vaultCollateral = await vault.collateralToken();
    console.log(
      `  Collateral Token: ${
        vaultCollateral === (await usdc.getAddress()) ? "✅" : "❌"
      } (${vaultCollateral})`
    );

    // Check factory connections
    console.log("\nFuturesMarketFactory:");
    const factoryVault = await factory.vault();
    console.log(
      `  Vault: ${
        factoryVault === (await vault.getAddress()) ? "✅" : "❌"
      } (${factoryVault})`
    );

    // Check router connections
    console.log("\nTradingRouter:");
    const routerVault = await router.VAULT_ROUTER();
    console.log(
      `  Vault: ${
        routerVault === (await vault.getAddress()) ? "✅" : "❌"
      } (${routerVault})`
    );

    // Check orderbook connections
    console.log("\nOrderBook:");
    const orderBookVault = await orderBook.vault();
    console.log(
      `  Vault: ${
        orderBookVault === (await vault.getAddress()) ? "✅" : "❌"
      } (${orderBookVault})`
    );
    const orderBookMarket = await orderBook.marketId();
    console.log(`  Market ID: ${orderBookMarket}`);

    // 4. Check margin release feature
    console.log("\n📋 VERIFYING MARGIN RELEASE FEATURES:");
    console.log("═".repeat(60));

    // Check if cumulativeMarginUsed mapping exists by calling it with a test value
    try {
      const testMargin = await orderBook.cumulativeMarginUsed(0);
      console.log("Cumulative Margin Tracking: ✅ (mapping exists)");
    } catch (error) {
      console.log("Cumulative Margin Tracking: ❌ (not implemented)");
    }

    // 5. Check system parameters
    console.log("\n📋 SYSTEM PARAMETERS:");
    console.log("═".repeat(60));

    // OrderBook parameters
    const marginReqBps = await orderBook.marginRequirementBps();
    const tradingFee = await orderBook.tradingFee();
    const leverageEnabled = await orderBook.leverageEnabled();
    const maxLeverage = await orderBook.maxLeverage();

    console.log("OrderBook Settings:");
    console.log(
      `  Margin Requirement: ${marginReqBps.toString()} bps (${(
        Number(marginReqBps) / 100
      ).toFixed(2)}%)`
    );
    console.log(
      `  Trading Fee: ${tradingFee.toString()} bps (${(
        Number(tradingFee) / 100
      ).toFixed(2)}%)`
    );
    console.log(`  Leverage Enabled: ${leverageEnabled ? "✅" : "❌"}`);
    console.log(`  Max Leverage: ${maxLeverage.toString()}x`);

    // 6. Test basic functionality
    console.log("\n📋 TESTING BASIC FUNCTIONALITY:");
    console.log("═".repeat(60));

    // Check if user can deposit (requires approval first)
    console.log("Testing deposit flow:");
    try {
      // Check USDC balance of deployer
      const usdcBalance = await usdc.balanceOf(deployer.address);
      console.log(
        `  Deployer USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`
      );

      // Check vault collateral
      const vaultCollateral = await vault.userCollateral(deployer.address);
      console.log(
        `  Deployer Vault Collateral: ${ethers.formatUnits(
          vaultCollateral,
          6
        )} USDC`
      );

      console.log("  Deposit functionality: ✅ (contracts callable)");
    } catch (error) {
      console.log("  Deposit functionality: ❌", error.message);
    }

    // 7. Summary
    console.log("\n📊 SYSTEM STATUS SUMMARY:");
    console.log("═".repeat(60));

    const checksPass =
      allDeployed &&
      authStatus.factoryHasRole &&
      authStatus.orderBookHasRole &&
      authStatus.isRegistered &&
      authStatus.isAssigned;

    if (checksPass) {
      console.log("✅ System is fully configured and ready for use!");
      console.log("\n💡 Next steps:");
      console.log(
        "  1. Mint USDC to users: await usdc.mint(userAddress, amount)"
      );
      console.log(
        "  2. Approve vault: await usdc.approve(vaultAddress, amount)"
      );
      console.log(
        "  3. Deposit collateral: await vault.depositCollateral(amount)"
      );
      console.log(
        "  4. Place orders: await orderBook.placeMarginLimitOrder(price, amount, isBuy)"
      );
    } else {
      console.log(
        "❌ System needs configuration. Run: node setup-authorization.js"
      );
    }

    console.log("═".repeat(60));
  } catch (error) {
    console.error("\n❌ Error verifying system:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
