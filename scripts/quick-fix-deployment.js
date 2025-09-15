#!/usr/bin/env node

// quick-fix-deployment.js - Quick Fix for Contract Deployment Issues
//
// 🎯 PURPOSE:
//   Quick fix for contract deployment and connection issues
//   Redeploys contracts if needed and updates configuration
//
// 🚀 USAGE:
//   node scripts/quick-fix-deployment.js
//   npx hardhat run scripts/quick-fix-deployment.js --network localhost

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Color palette
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  dim: "\x1b[2m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

async function quickFixDeployment() {
  console.log(colorText("\n🔧 QUICK FIX DEPLOYMENT", colors.brightYellow));
  console.log(colorText("═".repeat(60), colors.brightYellow));

  try {
    const [deployer] = await ethers.getSigners();
    console.log(
      colorText(`\n👤 Deployer: ${deployer.address}`, colors.brightCyan)
    );

    // Check if we need to deploy
    console.log(
      colorText(`\n🔍 Checking current deployment status...`, colors.brightCyan)
    );

    let needsDeployment = false;
    const contracts = {};

    // Check MockUSDC
    try {
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const mockUSDC = await MockUSDC.deploy(deployer.address);
      await mockUSDC.waitForDeployment();
      contracts.MOCK_USDC = await mockUSDC.getAddress();
      console.log(
        colorText(
          `   ✅ MockUSDC deployed at: ${contracts.MOCK_USDC}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ MockUSDC deployment failed: ${error.message}`,
          colors.red
        )
      );
      needsDeployment = true;
    }

    // Check CentralizedVault
    try {
      const CentralizedVault = await ethers.getContractFactory(
        "CentralizedVault"
      );
      const vault = await CentralizedVault.deploy(
        contracts.MOCK_USDC,
        deployer.address
      );
      await vault.waitForDeployment();
      contracts.CENTRALIZED_VAULT = await vault.getAddress();
      console.log(
        colorText(
          `   ✅ CentralizedVault deployed at: ${contracts.CENTRALIZED_VAULT}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ CentralizedVault deployment failed: ${error.message}`,
          colors.red
        )
      );
      needsDeployment = true;
    }

    // Check FuturesMarketFactory
    try {
      const FuturesMarketFactory = await ethers.getContractFactory(
        "FuturesMarketFactory"
      );
      const factory = await FuturesMarketFactory.deploy(
        contracts.CENTRALIZED_VAULT,
        deployer.address,
        deployer.address
      );
      await factory.waitForDeployment();
      contracts.FUTURES_MARKET_FACTORY = await factory.getAddress();
      console.log(
        colorText(
          `   ✅ FuturesMarketFactory deployed at: ${contracts.FUTURES_MARKET_FACTORY}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ FuturesMarketFactory deployment failed: ${error.message}`,
          colors.red
        )
      );
      needsDeployment = true;
    }

    // Check TradingRouter
    try {
      const TradingRouter = await ethers.getContractFactory("TradingRouter");
      const router = await TradingRouter.deploy(
        contracts.CENTRALIZED_VAULT,
        contracts.FUTURES_MARKET_FACTORY,
        deployer.address
      );
      await router.waitForDeployment();
      contracts.TRADING_ROUTER = await router.getAddress();
      console.log(
        colorText(
          `   ✅ TradingRouter deployed at: ${contracts.TRADING_ROUTER}`,
          colors.green
        )
      );
    } catch (error) {
      console.log(
        colorText(
          `   ❌ TradingRouter deployment failed: ${error.message}`,
          colors.red
        )
      );
      needsDeployment = true;
    }

    // Create ALUMINUM market if needed
    if (!needsDeployment) {
      console.log(
        colorText(`\n🏭 Creating ALUMINUM market...`, colors.brightCyan)
      );

      try {
        const factory = await ethers.getContractAt(
          "FuturesMarketFactory",
          contracts.FUTURES_MARKET_FACTORY
        );
        const vault = await ethers.getContractAt(
          "CentralizedVault",
          contracts.CENTRALIZED_VAULT
        );

        // Grant roles
        const FACTORY_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("FACTORY_ROLE")
        );
        const SETTLEMENT_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("SETTLEMENT_ROLE")
        );
        const ORDERBOOK_ROLE = ethers.keccak256(
          ethers.toUtf8Bytes("ORDERBOOK_ROLE")
        );

        await vault.grantRole(FACTORY_ROLE, contracts.FUTURES_MARKET_FACTORY);
        await vault.grantRole(
          SETTLEMENT_ROLE,
          contracts.FUTURES_MARKET_FACTORY
        );
        await vault.grantRole(SETTLEMENT_ROLE, deployer.address);

        // Create market
        const marketSymbol = "ALU-USD";
        const marketId = ethers.keccak256(ethers.toUtf8Bytes(marketSymbol));
        const metricUrl =
          "https://www.lme.com/en/metals/non-ferrous/lme-aluminium/";
        const settlementDate =
          Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
        const startPrice = ethers.parseUnits("1", 6); // $1 for testing
        const dataSource = "London Metal Exchange";
        const tags = ["COMMODITIES", "METALS", "ALUMINUM"];
        const marginRequirementBps = 10000; // 100% margin
        const tradingFee = 10; // 0.1%

        const creationFee = await factory.marketCreationFee();
        const mockUSDC = await ethers.getContractAt(
          "MockUSDC",
          contracts.MOCK_USDC
        );
        await mockUSDC.approve(contracts.FUTURES_MARKET_FACTORY, creationFee);

        const createTx = await factory.createFuturesMarket(
          marketSymbol,
          metricUrl,
          settlementDate,
          startPrice,
          dataSource,
          tags,
          marginRequirementBps,
          tradingFee
        );

        const receipt = await createTx.wait();
        const event = receipt.logs.find((log) => {
          try {
            const parsed = factory.interface.parseLog(log);
            return parsed.name === "FuturesMarketCreated";
          } catch {
            return false;
          }
        });

        if (event) {
          const parsedEvent = factory.interface.parseLog(event);
          contracts.ALUMINUM_ORDERBOOK = parsedEvent.args.orderBook;
          console.log(
            colorText(
              `   ✅ ALUMINUM OrderBook deployed at: ${contracts.ALUMINUM_ORDERBOOK}`,
              colors.green
            )
          );
        }

        // Set mark price
        await vault.updateMarkPrice(marketId, startPrice);
        console.log(colorText(`   ✅ Mark price set to $1.00`, colors.green));

        // Grant ORDERBOOK_ROLE
        await vault.grantRole(ORDERBOOK_ROLE, contracts.ALUMINUM_ORDERBOOK);
        console.log(colorText(`   ✅ ORDERBOOK_ROLE granted`, colors.green));
      } catch (error) {
        console.log(
          colorText(
            `   ❌ Market creation failed: ${error.message}`,
            colors.red
          )
        );
        needsDeployment = true;
      }
    }

    // Update contracts.js if we have new addresses
    if (Object.keys(contracts).length > 0) {
      console.log(
        colorText(`\n📝 Updating contracts.js...`, colors.brightCyan)
      );

      try {
        const configPath = path.join(__dirname, "../config/contracts.js");
        let content = fs.readFileSync(configPath, "utf8");

        // Update each contract address
        Object.entries(contracts).forEach(([name, address]) => {
          const regex = new RegExp(`${name}:\\s*"0x[a-fA-F0-9]+"`, "g");
          content = content.replace(regex, `${name}: "${address}"`);
        });

        fs.writeFileSync(configPath, content);
        console.log(
          colorText(
            `   ✅ Updated contracts.js with new addresses`,
            colors.green
          )
        );
      } catch (error) {
        console.log(
          colorText(
            `   ❌ Failed to update contracts.js: ${error.message}`,
            colors.red
          )
        );
      }
    }

    // Test the OrderBook
    if (contracts.ALUMINUM_ORDERBOOK) {
      console.log(
        colorText(`\n🧪 Testing OrderBook contract...`, colors.brightCyan)
      );

      try {
        const orderBook = await ethers.getContractAt(
          "OrderBook",
          contracts.ALUMINUM_ORDERBOOK
        );
        const bestBid = await orderBook.bestBid();
        const bestAsk = await orderBook.bestAsk();
        const markPrice = await orderBook.getMarkPrice();

        console.log(
          colorText(`   ✅ bestBid(): ${bestBid.toString()}`, colors.green)
        );
        console.log(
          colorText(`   ✅ bestAsk(): ${bestAsk.toString()}`, colors.green)
        );
        console.log(
          colorText(
            `   ✅ getMarkPrice(): ${markPrice.toString()}`,
            colors.green
          )
        );

        console.log(
          colorText(`\n🎉 OrderBook is working correctly!`, colors.brightGreen)
        );
        console.log(
          colorText(
            `   You can now run your liquidity filling scripts.`,
            colors.white
          )
        );
      } catch (error) {
        console.log(
          colorText(`   ❌ OrderBook test failed: ${error.message}`, colors.red)
        );
      }
    }

    if (needsDeployment) {
      console.log(
        colorText(`\n⚠️  Some contracts failed to deploy.`, colors.yellow)
      );
      console.log(
        colorText(`   Please run: node scripts/deploy.js`, colors.white)
      );
    }
  } catch (error) {
    console.log(
      colorText("❌ Error during quick fix: " + error.message, colors.red)
    );
    console.error(error);
  }
}

// Run the quick fix
quickFixDeployment().catch(console.error);
