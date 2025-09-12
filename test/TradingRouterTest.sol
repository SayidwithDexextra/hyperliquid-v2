// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TradingRouter.sol";
import "../src/CentralizedVault.sol";
import "../src/OrderBookFactory.sol";
import "../src/MockUSDC.sol";

/**
 * @title TradingRouterTest
 * @dev Comprehensive test suite for TradingRouter functionality
 */
contract TradingRouterTest is Test {
    // Core contracts
    TradingRouter public tradingRouter;
    CentralizedVault public vault;
    FuturesMarketFactory public factory;
    MockUSDC public usdc;
    
    // Test accounts
    address public admin = address(0x1);
    address public feeRecipient = address(0x2);
    address public trader1 = address(0x3);
    address public trader2 = address(0x4);
    
    // Test market data
    bytes32 public marketId1;
    bytes32 public marketId2;
    address public orderBook1;
    address public orderBook2;
    
    // Constants
    uint256 public constant INITIAL_BALANCE = 100_000 * 1e6; // 100k USDC
    uint256 public constant DEPOSIT_AMOUNT = 10_000 * 1e6;   // 10k USDC
    
    function setUp() public {
        // Deploy mock USDC
        usdc = new MockUSDC();
        
        // Deploy core contracts
        vault = new CentralizedVault(address(usdc), admin);
        factory = new FuturesMarketFactory(address(vault), admin, feeRecipient);
        tradingRouter = new TradingRouter(address(vault), address(factory), admin);
        
        // Setup roles
        vm.startPrank(admin);
        vault.grantRole(vault.FACTORY_ROLE(), address(factory));
        vm.stopPrank();
        
        // Create test markets
        vm.startPrank(admin);
        (orderBook1, marketId1) = factory.createFuturesMarket("ALU/USDC", 1000, 10);
        (orderBook2, marketId2) = factory.createFuturesMarket("BTC/USDC", 1000, 10);
        
        // Authorize markets in vault
        vault.setMarketAuthorization(marketId1, true);
        vault.setMarketAuthorization(marketId2, true);
        
        // Grant UPDATER_ROLE to OrderBooks for statistics
        tradingRouter.grantUpdaterRole(orderBook1);
        tradingRouter.grantUpdaterRole(orderBook2);
        vm.stopPrank();
        
        // Setup trader balances
        usdc.mint(trader1, INITIAL_BALANCE);
        usdc.mint(trader2, INITIAL_BALANCE);
        
        // Approve and deposit collateral
        vm.startPrank(trader1);
        usdc.approve(address(vault), DEPOSIT_AMOUNT);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        usdc.approve(address(vault), DEPOSIT_AMOUNT);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        vm.stopPrank();
    }
    
    // ============ Basic Trading Tests ============
    
    function testPlaceLimitOrder() public {
        vm.startPrank(trader1);
        
        bytes32 orderId = tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            100e18,     // 100 ALU
            2_000_000,  // $2.00 price
            1,          // 1x leverage
            0           // No expiry
        );
        
        assertNotEq(orderId, bytes32(0), "Order ID should not be zero");
        vm.stopPrank();
    }
    
    function testPlaceLimitOrderWithLeverage() public {
        vm.startPrank(trader1);
        
        bytes32 orderId = tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            100e18,     // 100 ALU
            2_000_000,  // $2.00 price
            5,          // 5x leverage
            0           // No expiry
        );
        
        assertNotEq(orderId, bytes32(0), "Order ID should not be zero");
        vm.stopPrank();
    }
    
    function testMarketBuyOrder() public {
        // First, place a sell order to provide liquidity
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.SELL,
            50e18,      // 50 ALU
            2_100_000,  // $2.10 price
            1,          // 1x leverage
            0           // No expiry
        );
        vm.stopPrank();
        
        // Now execute market buy
        vm.startPrank(trader1);
        uint128 amountFilled = tradingRouter.marketBuy(
            marketId1,
            50e18,      // 50 ALU
            2_200_000   // Max $2.20 price
        );
        
        assertEq(amountFilled, 50e18, "Should fill entire order");
        vm.stopPrank();
    }
    
    function testMarketSellOrder() public {
        // First, place a buy order to provide liquidity
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            50e18,      // 50 ALU
            1_900_000,  // $1.90 price
            1,          // 1x leverage
            0           // No expiry
        );
        vm.stopPrank();
        
        // Now execute market sell
        vm.startPrank(trader1);
        uint128 amountFilled = tradingRouter.marketSell(
            marketId1,
            50e18,      // 50 ALU
            1_800_000   // Min $1.80 price
        );
        
        assertEq(amountFilled, 50e18, "Should fill entire order");
        vm.stopPrank();
    }
    
    function testMarketOrderWithLeverage() public {
        // Place sell order for liquidity
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.SELL,
            100e18,     // 100 ALU
            2_000_000,  // $2.00 price
            1,          // 1x leverage
            0           // No expiry
        );
        vm.stopPrank();
        
        // Execute leveraged market buy
        vm.startPrank(trader1);
        uint128 amountFilled = tradingRouter.marketBuyWithLeverage(
            marketId1,
            100e18,     // 100 ALU
            2_100_000,  // Max $2.10 price
            10          // 10x leverage
        );
        
        assertEq(amountFilled, 100e18, "Should fill entire order with leverage");
        vm.stopPrank();
    }
    
    // ============ Order Management Tests ============
    
    function testCancelOrder() public {
        vm.startPrank(trader1);
        
        bytes32 orderId = tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            100e18,     // 100 ALU
            2_000_000,  // $2.00 price
            1,          // 1x leverage
            0           // No expiry
        );
        
        // Cancel the order
        tradingRouter.cancelOrder(marketId1, orderId);
        vm.stopPrank();
    }
    
    function testBatchCancelOrders() public {
        vm.startPrank(trader1);
        
        bytes32 orderId1 = tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            100e18,     // 100 ALU
            2_000_000,  // $2.00 price
            1,          // 1x leverage
            0           // No expiry
        );
        
        bytes32 orderId2 = tradingRouter.placeLimitOrder(
            marketId2,
            TradingRouter.OrderSide.BUY,
            50e18,      // 50 BTC
            50_000_000_000, // $50,000 price
            1,          // 1x leverage
            0           // No expiry
        );
        
        // Batch cancel orders
        bytes32[] memory marketIds = new bytes32[](2);
        bytes32[] memory orderIds = new bytes32[](2);
        
        marketIds[0] = marketId1;
        marketIds[1] = marketId2;
        orderIds[0] = orderId1;
        orderIds[1] = orderId2;
        
        tradingRouter.batchCancelOrders(marketIds, orderIds);
        vm.stopPrank();
    }
    
    // ============ Portfolio Analytics Tests ============
    
    function testGetUserActiveOrders() public {
        vm.startPrank(trader1);
        
        // Place orders in both markets
        tradingRouter.placeLimitOrder(
            marketId1,
            TradingRouter.OrderSide.BUY,
            100e18,
            2_000_000,
            1,
            0
        );
        
        tradingRouter.placeLimitOrder(
            marketId2,
            TradingRouter.OrderSide.SELL,
            10e18,
            55_000_000_000,
            1,
            0
        );
        
        // Get active orders
        (
            bytes32[] memory marketIds,
            bytes32[][] memory orderIds,
            OrderBook.Order[][] memory orders
        ) = tradingRouter.getUserActiveOrders(trader1);
        
        assertEq(marketIds.length, 2, "Should have orders in 2 markets");
        assertEq(orderIds[0].length, 1, "Should have 1 order in first market");
        assertEq(orderIds[1].length, 1, "Should have 1 order in second market");
        
        vm.stopPrank();
    }
    
    function testGetMultiMarketData() public {
        // Place orders to establish prices
        vm.startPrank(trader1);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 1_900_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_100_000, 1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.BUY, 10e18, 49_000_000_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.SELL, 10e18, 51_000_000_000, 1, 0);
        vm.stopPrank();
        
        // Get multi-market data
        bytes32[] memory marketIds = new bytes32[](2);
        marketIds[0] = marketId1;
        marketIds[1] = marketId2;
        
        TradingRouter.MarketPriceData[] memory priceData = tradingRouter.getMultiMarketData(marketIds);
        
        assertEq(priceData.length, 2, "Should return data for 2 markets");
        assertTrue(priceData[0].isValid, "First market data should be valid");
        assertTrue(priceData[1].isValid, "Second market data should be valid");
        
        // Check spreads
        assertGt(priceData[0].spread, 0, "Should have positive spread");
        assertGt(priceData[1].spread, 0, "Should have positive spread");
    }
    
    function testGetUserPortfolioValue() public {
        // Create a position by matching orders
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_000_000, 1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader1);
        tradingRouter.marketBuy(marketId1, 100e18, 2_100_000);
        
        (uint256 totalValue, int256[] memory marketExposures) = tradingRouter.getUserPortfolioValue(trader1);
        
        assertGt(totalValue, 0, "Portfolio should have positive value");
        assertEq(marketExposures.length, 1, "Should have exposure in 1 market");
        assertEq(marketExposures[0], int256(100e18), "Should have long position of 100 ALU");
        
        vm.stopPrank();
    }
    
    // ============ Cross-Market Features Tests ============
    
    function testDetectArbitrage() public {
        // Create price difference between markets
        vm.startPrank(trader1);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 1_900_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_100_000, 1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.BUY, 100e18, 1_800_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.SELL, 100e18, 2_200_000, 1, 0);
        vm.stopPrank();
        
        (uint256 priceDifference, uint256 potentialProfit, bool direction) = 
            tradingRouter.detectArbitrage(marketId1, marketId2);
        
        assertGt(priceDifference, 0, "Should detect price difference");
        assertGt(potentialProfit, 0, "Should have potential profit");
    }
    
    function testGetMultiMarketSpreads() public {
        // Place orders to create spreads
        vm.startPrank(trader1);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 1_950_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_050_000, 1, 0);
        
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.BUY, 10e18, 49_500_000_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.SELL, 10e18, 50_500_000_000, 1, 0);
        vm.stopPrank();
        
        bytes32[] memory marketIds = new bytes32[](2);
        marketIds[0] = marketId1;
        marketIds[1] = marketId2;
        
        (uint256[] memory spreads, uint256[] memory spreadsBps) = 
            tradingRouter.getMultiMarketSpreads(marketIds);
        
        assertEq(spreads.length, 2, "Should return spreads for 2 markets");
        assertEq(spreadsBps.length, 2, "Should return spread bps for 2 markets");
        assertGt(spreads[0], 0, "First market should have positive spread");
        assertGt(spreads[1], 0, "Second market should have positive spread");
    }
    
    // ============ Statistics Tests ============
    
    function testTradingStatistics() public {
        // Execute some trades
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_000_000, 1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader1);
        tradingRouter.marketBuy(marketId1, 100e18, 2_100_000);
        vm.stopPrank();
        
        // Check statistics
        (uint256 totalTrades, uint256 totalVolume, uint256 totalFees) = tradingRouter.getTradingStats();
        
        assertGt(totalTrades, 0, "Should have recorded trades");
        assertGt(totalVolume, 0, "Should have recorded volume");
        
        uint256 marketVolume = tradingRouter.getMarketVolume(marketId1);
        assertGt(marketVolume, 0, "Should have market-specific volume");
        
        uint256 userTradeCount = tradingRouter.getUserTradeCount(trader1);
        assertGt(userTradeCount, 0, "Should have user-specific trade count");
    }
    
    // ============ Advanced Analytics Tests ============
    
    function testGetUserPositionBreakdowns() public {
        // Create positions
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 2_000_000, 1, 0);
        tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.SELL, 10e18, 50_000_000_000, 1, 0);
        vm.stopPrank();
        
        vm.startPrank(trader1);
        tradingRouter.marketBuy(marketId1, 100e18, 2_100_000);
        tradingRouter.marketBuy(marketId2, 10e18, 51_000_000_000);
        
        (
            TradingRouter.PositionBreakdown[] memory breakdowns,
            TradingRouter.PositionPortfolioSummary memory summary
        ) = tradingRouter.getUserPositionBreakdowns(trader1);
        
        assertEq(breakdowns.length, 2, "Should have 2 position breakdowns");
        assertEq(summary.totalPositions, 2, "Summary should show 2 positions");
        assertGt(summary.totalNotionalValue, 0, "Should have positive notional value");
        
        // Check individual breakdowns
        assertTrue(breakdowns[0].isLong, "First position should be long");
        assertTrue(breakdowns[1].isLong, "Second position should be long");
        assertGt(breakdowns[0].notionalValue, 0, "Should have positive notional");
        assertGt(breakdowns[1].notionalValue, 0, "Should have positive notional");
        
        vm.stopPrank();
    }
    
    function testGetUserTradingData() public {
        // Create comprehensive trading activity
        vm.startPrank(trader1);
        
        // Place some orders
        bytes32 orderId1 = tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 50e18, 1_900_000, 1, 0);
        bytes32 orderId2 = tradingRouter.placeLimitOrder(marketId2, TradingRouter.OrderSide.BUY, 5e18, 49_000_000_000, 1, 0);
        
        vm.stopPrank();
        
        // Create a position
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 25e18, 1_900_000, 1, 0);
        vm.stopPrank();
        
        // Get comprehensive trading data
        (
            CentralizedVault.Position[] memory positions,
            bytes32[] memory activeOrderMarkets,
            bytes32[][] memory activeOrderIds,
            OrderBook.Order[][] memory activeOrders,
            uint256 portfolioValue,
            int256[] memory marketExposures,
            CentralizedVault.MarginSummary memory marginSummary
        ) = tradingRouter.getUserTradingData(trader1);
        
        // Verify data completeness
        assertEq(positions.length, 1, "Should have 1 position");
        assertEq(activeOrderMarkets.length, 2, "Should have active orders in 2 markets");
        assertGt(portfolioValue, 0, "Should have positive portfolio value");
        assertGt(marginSummary.totalCollateral, 0, "Should have collateral");
    }
    
    // ============ Access Control Tests ============
    
    function testOnlyAdminCanPause() public {
        vm.startPrank(trader1);
        vm.expectRevert();
        tradingRouter.pause();
        vm.stopPrank();
        
        vm.startPrank(admin);
        tradingRouter.pause();
        assertTrue(tradingRouter.paused(), "Contract should be paused");
        vm.stopPrank();
    }
    
    function testPausedContractRejectsOrders() public {
        vm.startPrank(admin);
        tradingRouter.pause();
        vm.stopPrank();
        
        vm.startPrank(trader1);
        vm.expectRevert();
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 2_000_000, 1, 0);
        vm.stopPrank();
    }
    
    function testRoleManagement() public {
        vm.startPrank(admin);
        
        // Grant and revoke updater role
        tradingRouter.grantUpdaterRole(trader1);
        assertTrue(tradingRouter.hasRole(tradingRouter.UPDATER_ROLE(), trader1), "Should have updater role");
        
        tradingRouter.revokeUpdaterRole(trader1);
        assertFalse(tradingRouter.hasRole(tradingRouter.UPDATER_ROLE(), trader1), "Should not have updater role");
        
        vm.stopPrank();
    }
    
    // ============ Edge Cases Tests ============
    
    function testInvalidLeverageRejected() public {
        vm.startPrank(trader1);
        
        vm.expectRevert("TradingRouter: invalid leverage");
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 2_000_000, 0, 0);
        
        vm.expectRevert("TradingRouter: invalid leverage");
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 100e18, 2_000_000, 101, 0);
        
        vm.stopPrank();
    }
    
    function testZeroAmountRejected() public {
        vm.startPrank(trader1);
        
        vm.expectRevert("TradingRouter: amount must be greater than 0");
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.BUY, 0, 2_000_000, 1, 0);
        
        vm.stopPrank();
    }
    
    function testInvalidMarketRejected() public {
        bytes32 invalidMarketId = keccak256("INVALID_MARKET");
        
        vm.startPrank(trader1);
        vm.expectRevert("TradingRouter: market not found");
        tradingRouter.placeLimitOrder(invalidMarketId, TradingRouter.OrderSide.BUY, 100e18, 2_000_000, 1, 0);
        vm.stopPrank();
    }
    
    function testSlippageProtection() public {
        // Place a high-priced sell order
        vm.startPrank(trader2);
        tradingRouter.placeLimitOrder(marketId1, TradingRouter.OrderSide.SELL, 100e18, 3_000_000, 1, 0);
        vm.stopPrank();
        
        // Try to buy with low max price - should revert
        vm.startPrank(trader1);
        vm.expectRevert("TradingRouter: price exceeds maximum");
        tradingRouter.marketBuy(marketId1, 100e18, 2_500_000);
        vm.stopPrank();
    }
}
