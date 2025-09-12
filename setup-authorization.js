const { ethers } = require("hardhat");
const {
  getContract,
  getCoreContracts,
  ADDRESSES,
  ROLES,
  checkAuthorization,
  displayFullConfig,
} = require("./config/contracts");

async function main() {
  console.log("🔒 Setting up Authorization for Production Deployment\n");

  const [deployer] = await ethers.getSigners();
  console.log("Using deployer account:", deployer.address);

  try {
    // Get all core contracts
    const { trading_router, centralized_vault, futures_market_factory } =
      await getCoreContracts();

    const orderBook = await getContract("ORDERBOOK");

    console.log("\n📋 Contract Addresses:");
    console.log("CentralizedVault:", await centralized_vault.getAddress());
    console.log(
      "FuturesMarketFactory:",
      await futures_market_factory.getAddress()
    );
    console.log("TradingRouter:", await trading_router.getAddress());
    console.log("OrderBook (BTC):", await orderBook.getAddress());

    // Check current authorization status
    console.log("\n🔍 Checking current authorization status...");
    const authStatus = await checkAuthorization();

    // Setup missing authorizations
    console.log("\n⚙️  Setting up authorizations...");

    // 1. Grant FACTORY_ROLE to FuturesMarketFactory if needed
    if (!authStatus.factoryHasRole) {
      console.log("Granting FACTORY_ROLE to FuturesMarketFactory...");
      await centralized_vault.grantRole(
        ROLES.FACTORY_ROLE,
        await futures_market_factory.getAddress()
      );
      console.log("✅ FACTORY_ROLE granted");
    } else {
      console.log("✅ FuturesMarketFactory already has FACTORY_ROLE");
    }

    // 2. Grant ORDERBOOK_ROLE to OrderBook if needed
    if (!authStatus.orderBookHasRole) {
      console.log("Granting ORDERBOOK_ROLE to OrderBook...");
      await centralized_vault.grantRole(
        ROLES.ORDERBOOK_ROLE,
        await orderBook.getAddress()
      );
      console.log("✅ ORDERBOOK_ROLE granted");
    } else {
      console.log("✅ OrderBook already has ORDERBOOK_ROLE");
    }

    // 3. Register OrderBook if needed
    if (!authStatus.isRegistered) {
      console.log("Registering OrderBook with Vault...");

      // Need FACTORY_ROLE to register
      const deployerHasFactoryRole = await centralized_vault.hasRole(
        ROLES.FACTORY_ROLE,
        deployer.address
      );

      if (!deployerHasFactoryRole) {
        console.log("Temporarily granting FACTORY_ROLE to deployer...");
        await centralized_vault.grantRole(ROLES.FACTORY_ROLE, deployer.address);
      }

      await centralized_vault.registerOrderBook(await orderBook.getAddress());
      console.log("✅ OrderBook registered");

      // Revoke temporary role
      if (!deployerHasFactoryRole) {
        await centralized_vault.revokeRole(
          ROLES.FACTORY_ROLE,
          deployer.address
        );
        console.log("✅ Temporary FACTORY_ROLE revoked");
      }
    } else {
      console.log("✅ OrderBook already registered");
    }

    // 4. Assign market to OrderBook if needed
    if (!authStatus.isAssigned) {
      console.log("Assigning BTC market to OrderBook...");

      // Need FACTORY_ROLE to assign
      const deployerHasFactoryRole = await centralized_vault.hasRole(
        ROLES.FACTORY_ROLE,
        deployer.address
      );

      if (!deployerHasFactoryRole) {
        console.log("Temporarily granting FACTORY_ROLE to deployer...");
        await centralized_vault.grantRole(ROLES.FACTORY_ROLE, deployer.address);
      }

      const marketId = ethers.keccak256(ethers.toUtf8Bytes("BTC-USD"));
      await centralized_vault.assignMarketToOrderBook(
        marketId,
        await orderBook.getAddress()
      );
      console.log("✅ Market assigned to OrderBook");

      // Revoke temporary role
      if (!deployerHasFactoryRole) {
        await centralized_vault.revokeRole(
          ROLES.FACTORY_ROLE,
          deployer.address
        );
        console.log("✅ Temporary FACTORY_ROLE revoked");
      }
    } else {
      console.log("✅ Market already assigned to OrderBook");
    }

    // 5. Setup additional permissions
    console.log("\n⚙️  Setting up additional permissions...");

    // Check if TradingRouter needs any special permissions
    // (Currently TradingRouter doesn't need roles, it uses user's permissions)
    console.log(
      "✅ TradingRouter uses delegated permissions (no roles needed)"
    );

    // 6. Verify final authorization status
    console.log("\n🔍 Verifying final authorization status...");
    const finalStatus = await checkAuthorization();

    const allGood =
      finalStatus.factoryHasRole &&
      finalStatus.orderBookHasRole &&
      finalStatus.isRegistered &&
      finalStatus.isAssigned;

    if (allGood) {
      console.log("\n✅ All authorizations successfully configured!");
    } else {
      console.log("\n❌ Some authorizations failed. Please check manually.");
    }

    // Display role configuration
    console.log("\n📊 Role Configuration Summary:");
    console.log("═".repeat(60));

    // Check all role members
    console.log("\nFACTORY_ROLE holders:");
    const factoryRoleCount = await centralized_vault.getRoleMemberCount(
      ROLES.FACTORY_ROLE
    );
    for (let i = 0; i < factoryRoleCount; i++) {
      const member = await centralized_vault.getRoleMember(
        ROLES.FACTORY_ROLE,
        i
      );
      console.log(`  - ${member}`);
    }

    console.log("\nORDERBOOK_ROLE holders:");
    const orderBookRoleCount = await centralized_vault.getRoleMemberCount(
      ROLES.ORDERBOOK_ROLE
    );
    for (let i = 0; i < orderBookRoleCount; i++) {
      const member = await centralized_vault.getRoleMember(
        ROLES.ORDERBOOK_ROLE,
        i
      );
      console.log(`  - ${member}`);
    }

    console.log("\nDEFAULT_ADMIN_ROLE holders:");
    const adminRoleCount = await centralized_vault.getRoleMemberCount(
      ROLES.DEFAULT_ADMIN_ROLE
    );
    for (let i = 0; i < adminRoleCount; i++) {
      const member = await centralized_vault.getRoleMember(
        ROLES.DEFAULT_ADMIN_ROLE,
        i
      );
      console.log(`  - ${member}`);
    }

    console.log("═".repeat(60));

    // Show full system configuration
    await displayFullConfig();
  } catch (error) {
    console.error("\n❌ Error setting up authorization:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
