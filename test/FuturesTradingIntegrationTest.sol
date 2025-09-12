// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import "../src/CentralizedVault.sol";
import "../src/FuturesMarketFactory.sol";
import "../src/OrderBook.sol";
import "../src/MockUSDC.sol";

/**
 * @title FuturesTradingIntegrationTest
 * @dev Integration test for the complete futures trading platform
 */
contract FuturesTradingIntegrationTest is Test {
    // Contracts
    MockUSDC public usdc;
    CentralizedVault public vault;
    FuturesMarketFactory public factory;
    
    // Test addresses
    address public admin = address(0x1);
    address public alice = address(0x2); // Market creator
    address public bob = address(0x3);   // Trader 1
    address public charlie = address(0x4); // Trader 2
    address public feeRecipient = address(0x5);
    
    // Test constants
    uint256 public constant INITIAL_BALANCE = 10000 * 10**6; // 10k USDC
    uint256 public constant DEPOSIT_AMOUNT = 5000 * 10**6;   // 5k USDC
    
    // Market data
    string public constant MARKET_SYMBOL = "TESLA-EOY-STOCK-PRICE";
    bytes32 public marketId;
    OrderBook public teslaOrderBook;
    
    function setUp() public {
        // Deploy core contracts
        usdc = new MockUSDC(admin);
        vault = new CentralizedVault(address(usdc), admin);
        factory = new FuturesMarketFactory(address(vault), admin, feeRecipient);
        
        // Setup roles
        vm.startPrank(admin);
        vault.grantRole(vault.FACTORY_ROLE(), address(factory));
        vm.stopPrank();
        
        // Give users USDC
        vm.startPrank(admin);
        usdc.mint(alice, INITIAL_BALANCE);
        usdc.mint(bob, INITIAL_BALANCE);
        usdc.mint(charlie, INITIAL_BALANCE);
        vm.stopPrank();
        
        // Users approve vault for transfers
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
        
        vm.prank(charlie);
        usdc.approve(address(vault), type(uint256).max);
        
        // Users deposit collateral
        vm.prank(alice);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(bob);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(charlie);
        vault.depositCollateral(DEPOSIT_AMOUNT);
    }
    
    function testCreateCustomFuturesMarket() public {
        // Alice creates a custom futures market for Tesla stock price
        vm.prank(alice);
        (address orderBookAddr, bytes32 createdMarketId) = factory.createFuturesMarket(
            MARKET_SYMBOL,
            "https://api.nasdaq.com/tesla/stock-price", // Metric URL
            block.timestamp + 365 days, // Settlement in 1 year
            250 * 10**6, // Start price: $250
            1500, // 15% margin requirement
            20    // 0.2% trading fee
        );
        
        marketId = createdMarketId;
        teslaOrderBook = OrderBook(orderBookAddr);
        
        // Verify market creation
        assertTrue(factory.doesMarketExist(marketId));
        assertEq(factory.getMarketCreator(marketId), alice);
        assertEq(factory.getMarketSymbol(marketId), MARKET_SYMBOL);
        assertEq(factory.getMarketMetricUrl(marketId), "https://api.nasdaq.com/tesla/stock-price");
        assertEq(factory.getMarketStartPrice(marketId), 250 * 10**6);
        assertEq(factory.getOrderBookForMarket(marketId), orderBookAddr);
        assertTrue(factory.getMarketSettlementDate(marketId) > block.timestamp);
        
        // Verify vault registration
        assertTrue(vault.isOrderBookRegistered(orderBookAddr));
        assertTrue(vault.authorizedMarkets(marketId));
        assertEq(vault.getMarketOrderBook(marketId), orderBookAddr);
        
        // Verify trading parameters
        (uint256 marginReq, uint256 fee, address recipient) = teslaOrderBook.getTradingParameters();
        assertEq(marginReq, 1500);
        assertEq(fee, 20);
        assertEq(recipient, feeRecipient);
        
        console.log("✅ Custom futures market created successfully");
        console.log("Market Symbol:", MARKET_SYMBOL);
        console.log("OrderBook Address:", orderBookAddr);
        console.log("Market Creator:", alice);
    }
    
    function testMarginTradingWorkflow() public {
        // Setup: Create market
        vm.prank(alice);
        (address orderBookAddr,) = factory.createFuturesMarket(
            MARKET_SYMBOL,
            "https://api.nasdaq.com/tesla/stock-price",
            block.timestamp + 30 days,
            300 * 10**6, // $300 start price
            0, 
            0
        );
        teslaOrderBook = OrderBook(orderBookAddr);
        
        // Set mark price for P&L calculations
        vm.prank(admin);
        vault.updateMarkPrice(marketId, 300 * 10**6); // $300 initial price
        
        // Bob places a margin buy order (long position)
        uint256 price = 300 * 10**18; // $300 with 18 decimals
        uint256 amount = 10 * 10**18;  // 10 units
        
        vm.prank(bob);
        uint256 bobOrderId = teslaOrderBook.placeMarginLimitOrder(price, amount, true);
        
        // Check that margin was reserved
        CentralizedVault.MarginSummary memory bobSummary = vault.getMarginSummary(bob);
        assertTrue(bobSummary.marginReserved > 0);
        console.log("Bob's reserved margin:", bobSummary.marginReserved / 10**6, "USDC");
        
        // Charlie places a margin sell order (short position) that matches
        vm.prank(charlie);
        uint256 charlieOrderId = teslaOrderBook.placeMarginLimitOrder(price, amount, false);
        
        // Orders should match and create positions
        assertEq(teslaOrderBook.getUserPosition(bob), int256(amount)); // Bob long
        assertEq(teslaOrderBook.getUserPosition(charlie), -int256(amount)); // Charlie short
        
        // Check positions in vault
        CentralizedVault.Position[] memory bobPositions = vault.getUserPositions(bob);
        CentralizedVault.Position[] memory charliePositions = vault.getUserPositions(charlie);
        
        assertEq(bobPositions.length, 1);
        assertEq(charliePositions.length, 1);
        assertEq(bobPositions[0].size, int256(amount));
        assertEq(charliePositions[0].size, -int256(amount));
        
        console.log("✅ Margin trading executed successfully");
        console.log("Bob's position:", uint256(bobPositions[0].size) / 10**18, "units (long)");
        console.log("Charlie's position:", uint256(-charliePositions[0].size) / 10**18, "units (short)");
    }
    
    function testMultipleMarketsIndependent() public {
        // Alice creates Tesla market
        vm.prank(alice);
        (address teslaOrderBookAddr, bytes32 teslaMarketId) = factory.createFuturesMarket(
            "TESLA-EOY-STOCK-PRICE",
            "https://api.nasdaq.com/tesla/eoy-price",
            block.timestamp + 365 days,
            250 * 10**6, // $250 start price
            1000, // 10% margin
            10    // 0.1% fee
        );
        
        // Bob creates Apple market
        vm.prank(bob);
        (address appleOrderBookAddr, bytes32 appleMarketId) = factory.createFuturesMarket(
            "APPLE-EOY-STOCK-PRICE",
            "https://api.nasdaq.com/apple/eoy-price",
            block.timestamp + 365 days,
            180 * 10**6, // $180 start price
            1500, // 15% margin
            15    // 0.15% fee
        );
        
        // Verify both markets exist independently
        assertTrue(factory.doesMarketExist(teslaMarketId));
        assertTrue(factory.doesMarketExist(appleMarketId));
        assertEq(factory.getMarketCreator(teslaMarketId), alice);
        assertEq(factory.getMarketCreator(appleMarketId), bob);
        
        // Verify different trading parameters
        OrderBook teslaOB = OrderBook(teslaOrderBookAddr);
        OrderBook appleOB = OrderBook(appleOrderBookAddr);
        
        (uint256 teslaMargin,,) = teslaOB.getTradingParameters();
        (uint256 appleMargin,,) = appleOB.getTradingParameters();
        
        assertEq(teslaMargin, 1000);
        assertEq(appleMargin, 1500);
        
        console.log("✅ Multiple independent markets created");
        console.log("Tesla market creator:", alice);
        console.log("Apple market creator:", bob);
        console.log("Total markets:", factory.getOrderBookCount());
    }
    
    function testUserMarketCreationTracking() public {
        // Alice creates multiple markets
        vm.startPrank(alice);
        factory.createFuturesMarket("TESLA-Q1-EARNINGS", 0, 0);
        factory.createFuturesMarket("TESLA-Q2-EARNINGS", 0, 0);
        factory.createFuturesMarket("TESLA-STOCK-SPLIT", 0, 0);
        vm.stopPrank();
        
        // Check Alice's created markets
        bytes32[] memory aliceMarkets = factory.getUserCreatedMarkets(alice);
        assertEq(aliceMarkets.length, 3);
        
        // Bob creates one market
        vm.prank(bob);
        factory.createFuturesMarket("BITCOIN-100K", 0, 0);
        
        bytes32[] memory bobMarkets = factory.getUserCreatedMarkets(bob);
        assertEq(bobMarkets.length, 1);
        
        // Charlie has no markets
        bytes32[] memory charlieMarkets = factory.getUserCreatedMarkets(charlie);
        assertEq(charlieMarkets.length, 0);
        
        console.log("✅ User market creation tracking works");
        console.log("Alice created markets:", aliceMarkets.length);
        console.log("Bob created markets:", bobMarkets.length);
    }
    
    function testMarketCreationFee() public {
        // Set market creation fee
        vm.prank(admin);
        factory.updateMarketCreationFee(50 * 10**6); // 50 USDC
        
        uint256 bobBalanceBefore = vault.userCollateral(bob);
        
        // Bob creates market and pays fee
        vm.prank(bob);
        factory.createFuturesMarket("CUSTOM-METRIC-MARKET", 0, 0);
        
        uint256 bobBalanceAfter = vault.userCollateral(bob);
        assertEq(bobBalanceBefore - bobBalanceAfter, 50 * 10**6);
        
        // Check fee recipient received the fee
        assertEq(usdc.balanceOf(feeRecipient), 50 * 10**6);
        
        console.log("✅ Market creation fee system works");
        console.log("Fee deducted:", (bobBalanceBefore - bobBalanceAfter) / 10**6, "USDC");
    }
    
    function testPublicMarketCreationToggle() public {
        // Disable public market creation
        vm.prank(admin);
        factory.togglePublicMarketCreation(false);
        
        // Non-admin should not be able to create markets
        vm.prank(bob);
        vm.expectRevert("FuturesMarketFactory: market creation restricted");
        factory.createFuturesMarket("RESTRICTED-MARKET", 0, 0);
        
        // Admin should still be able to create markets
        vm.prank(admin);
        factory.createFuturesMarket("ADMIN-ONLY-MARKET", 0, 0);
        
        // Re-enable public creation
        vm.prank(admin);
        factory.togglePublicMarketCreation(true);
        
        // Now Bob can create markets again
        vm.prank(bob);
        factory.createFuturesMarket("PUBLIC-MARKET-AGAIN", 0, 0);
        
        console.log("✅ Public market creation toggle works");
    }
    
    function testMarketCreatorCanDeactivate() public {
        // Alice creates a market
        vm.prank(alice);
        (address orderBookAddr, bytes32 createdMarketId) = factory.createFuturesMarket("ALICE-MARKET", 0, 0);
        
        assertTrue(factory.doesMarketExist(createdMarketId));
        
        // Alice can deactivate her own market
        vm.prank(alice);
        factory.deactivateFuturesMarket(orderBookAddr);
        
        assertFalse(factory.doesMarketExist(createdMarketId));
        assertFalse(vault.isOrderBookRegistered(orderBookAddr));
        
        console.log("✅ Market creator can deactivate their market");
    }
    
    function testComplexTradingScenario() public {
        // Setup: Create multiple markets
        vm.prank(alice);
        (address teslaOBAddr,) = factory.createFuturesMarket("TESLA-PRICE", 1000, 10);
        
        vm.prank(bob);
        (address appleOBAddr,) = factory.createFuturesMarket("APPLE-PRICE", 1200, 15);
        
        OrderBook teslaOB = OrderBook(teslaOBAddr);
        OrderBook appleOB = OrderBook(appleOBAddr);
        
        // Bob trades Tesla (long position)
        vm.prank(bob);
        teslaOB.placeMarginLimitOrder(250 * 10**18, 5 * 10**18, true); // Buy 5 units at $250
        
        // Charlie trades Tesla (short position)
        vm.prank(charlie);
        teslaOB.placeMarginLimitOrder(250 * 10**18, 5 * 10**18, false); // Sell 5 units at $250
        
        // Alice trades Apple (long position)
        vm.prank(alice);
        appleOB.placeMarginLimitOrder(180 * 10**18, 10 * 10**18, true); // Buy 10 units at $180
        
        // Bob also trades Apple (short position)
        vm.prank(bob);
        appleOB.placeMarginLimitOrder(180 * 10**18, 10 * 10**18, false); // Sell 10 units at $180
        
        // Check positions across markets
        assertEq(teslaOB.getUserPosition(bob), 5 * 10**18);     // Bob long Tesla
        assertEq(teslaOB.getUserPosition(charlie), -5 * 10**18); // Charlie short Tesla
        assertEq(appleOB.getUserPosition(alice), 10 * 10**18);   // Alice long Apple
        assertEq(appleOB.getUserPosition(bob), -10 * 10**18);    // Bob short Apple
        
        // Check vault positions
        CentralizedVault.Position[] memory bobPositions = vault.getUserPositions(bob);
        assertEq(bobPositions.length, 2); // Bob has positions in both markets
        
        // Get portfolio summaries
        CentralizedVault.MarginSummary memory bobSummary = vault.getMarginSummary(bob);
        CentralizedVault.MarginSummary memory charlieSummary = vault.getMarginSummary(charlie);
        
        assertTrue(bobSummary.marginUsed > 0);
        assertTrue(charlieSummary.marginUsed > 0);
        
        console.log("✅ Complex multi-market trading scenario completed");
        console.log("Bob's total margin used:", bobSummary.marginUsed / 10**6, "USDC");
        console.log("Bob's available collateral:", bobSummary.availableCollateral / 10**6, "USDC");
        console.log("Total active markets:", factory.getOrderBookCount());
    }
    
    function testMarketCreationWithCustomMetrics() public {
        // Create various custom metric markets
        string[] memory customMarkets = new string[](5);
        customMarkets[0] = "BITCOIN-100K-BY-EOY";
        customMarkets[1] = "ETHEREUM-10K-BY-Q2";
        customMarkets[2] = "TESLA-STOCK-SPLIT-2024";
        customMarkets[3] = "US-ELECTION-OUTCOME";
        customMarkets[4] = "SUPERBOWL-WINNER-ODDS";
        
        address[] memory creators = new address[](5);
        creators[0] = alice;
        creators[1] = bob;
        creators[2] = charlie;
        creators[3] = alice;
        creators[4] = bob;
        
        // Create all markets
        for (uint256 i = 0; i < customMarkets.length; i++) {
            vm.prank(creators[i]);
            factory.createFuturesMarket(customMarkets[i], 0, 0);
        }
        
        // Verify all markets exist
        assertEq(factory.getOrderBookCount(), 5);
        
        // Check user creation tracking
        assertEq(factory.getUserCreatedMarkets(alice).length, 2);
        assertEq(factory.getUserCreatedMarkets(bob).length, 2);
        assertEq(factory.getUserCreatedMarkets(charlie).length, 1);
        
        console.log("✅ Multiple custom metric markets created");
        console.log("Total markets:", factory.getOrderBookCount());
        console.log("Alice created:", factory.getUserCreatedMarkets(alice).length, "markets");
        console.log("Bob created:", factory.getUserCreatedMarkets(bob).length, "markets");
        console.log("Charlie created:", factory.getUserCreatedMarkets(charlie).length, "markets");
    }
    
    function testVaultIntegrationAcrossMarkets() public {
        // Create two markets
        vm.prank(alice);
        (address market1Addr,) = factory.createFuturesMarket("MARKET-1", 0, 0);
        
        vm.prank(bob);
        (address market2Addr,) = factory.createFuturesMarket("MARKET-2", 0, 0);
        
        OrderBook market1 = OrderBook(market1Addr);
        OrderBook market2 = OrderBook(market2Addr);
        
        // Bob trades in both markets
        vm.prank(bob);
        market1.placeMarginLimitOrder(100 * 10**18, 5 * 10**18, true); // Long in market 1
        
        vm.prank(charlie);
        market1.placeMarginLimitOrder(100 * 10**18, 5 * 10**18, false); // Match Bob's order
        
        vm.prank(bob);
        market2.placeMarginLimitOrder(200 * 10**18, 3 * 10**18, false); // Short in market 2
        
        vm.prank(alice);
        market2.placeMarginLimitOrder(200 * 10**18, 3 * 10**18, true); // Match Bob's order
        
        // Check Bob's positions across markets
        assertEq(market1.getUserPosition(bob), 5 * 10**18);   // Long position
        assertEq(market2.getUserPosition(bob), -3 * 10**18);  // Short position
        
        // Check vault shows both positions
        CentralizedVault.Position[] memory bobPositions = vault.getUserPositions(bob);
        assertEq(bobPositions.length, 2);
        
        // Check margin usage
        CentralizedVault.MarginSummary memory bobSummary = vault.getMarginSummary(bob);
        assertTrue(bobSummary.marginUsed > 0);
        
        console.log("✅ Vault integration across multiple markets works");
        console.log("Bob's positions in vault:", bobPositions.length);
        console.log("Bob's total margin used:", bobSummary.marginUsed / 10**6, "USDC");
    }
    
    function testFactoryViewFunctions() public {
        // Create some markets for testing
        vm.prank(alice);
        factory.createFuturesMarket("TEST-MARKET-1", 0, 0);
        
        vm.prank(bob);
        factory.createFuturesMarket("TEST-MARKET-2", 0, 0);
        
        // Test view functions
        address[] memory allOrderBooks = factory.getAllOrderBooks();
        bytes32[] memory allMarkets = factory.getAllMarkets();
        
        assertEq(allOrderBooks.length, 2);
        assertEq(allMarkets.length, 2);
        assertEq(factory.getOrderBookCount(), 2);
        
        // Test market creation settings
        (uint256 creationFee, bool publicCreation) = factory.getMarketCreationSettings();
        assertTrue(publicCreation);
        
        // Test default parameters
        (uint256 marginReq, uint256 fee) = factory.getDefaultParameters();
        assertEq(marginReq, 1000); // 10%
        assertEq(fee, 10);         // 0.1%
        
        console.log("✅ Factory view functions work correctly");
        console.log("Total OrderBooks:", allOrderBooks.length);
        console.log("Public creation enabled:", publicCreation);
    }
    
    function testGasOptimization() public {
        uint256 gasBefore;
        uint256 gasAfter;
        
        // Test market creation gas
        gasBefore = gasleft();
        vm.prank(alice);
        factory.createFuturesMarket("GAS-TEST-MARKET", 0, 0);
        gasAfter = gasleft();
        console.log("Market creation gas:", gasBefore - gasAfter);
        
        // Test margin order placement gas
        address orderBookAddr = factory.getOrderBookForMarket(
            keccak256(abi.encodePacked("GAS-TEST-MARKET", alice, block.timestamp, block.number))
        );
        
        if (orderBookAddr != address(0)) {
            OrderBook testOB = OrderBook(orderBookAddr);
            
            gasBefore = gasleft();
            vm.prank(bob);
            testOB.placeMarginLimitOrder(100 * 10**18, 1 * 10**18, true);
            gasAfter = gasleft();
            console.log("Margin order placement gas:", gasBefore - gasAfter);
        }
        
        console.log("✅ Gas optimization benchmarks completed");
    }
}
