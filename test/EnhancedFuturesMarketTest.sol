// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import "../src/CentralizedVault.sol";
import "../src/FuturesMarketFactory.sol";
import "../src/OrderBook.sol";
import "../src/MockUSDC.sol";

/**
 * @title EnhancedFuturesMarketTest
 * @dev Test suite for enhanced futures market functionality with oracles and discovery
 */
contract EnhancedFuturesMarketTest is Test {
    // Contracts
    MockUSDC public usdc;
    CentralizedVault public vault;
    FuturesMarketFactory public factory;
    
    // Test addresses
    address public admin = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);
    address public charlie = address(0x4);
    address public oracleAdmin = address(0x5);
    address public feeRecipient = address(0x6);
    
    // Test constants
    uint256 public constant INITIAL_BALANCE = 10000 * 10**6; // 10k USDC
    uint256 public constant DEPOSIT_AMOUNT = 5000 * 10**6;   // 5k USDC
    
    function setUp() public {
        // Deploy core contracts
        usdc = new MockUSDC(admin);
        vault = new CentralizedVault(address(usdc), admin);
        factory = new FuturesMarketFactory(address(vault), admin, feeRecipient);
        
        // Setup roles
        vm.startPrank(admin);
        vault.grantRole(vault.FACTORY_ROLE(), address(factory));
        factory.updateOracleAdmin(oracleAdmin);
        vm.stopPrank();
        
        // Setup users with USDC and vault deposits
        address[] memory users = new address[](3);
        users[0] = alice;
        users[1] = bob;
        users[2] = charlie;
        
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(admin);
            usdc.mint(users[i], INITIAL_BALANCE);
            
            vm.startPrank(users[i]);
            usdc.approve(address(vault), type(uint256).max);
            vault.depositCollateral(DEPOSIT_AMOUNT);
            vm.stopPrank();
        }
    }
    
    function testEnhancedMarketCreation() public {
        string[] memory tags = new string[](3);
        tags[0] = "STOCKS";
        tags[1] = "TECH";
        tags[2] = "PREDICTION";
        
        vm.prank(alice);
        (address orderBook, bytes32 marketId) = factory.createFuturesMarket(
            "TESLA-EOY-STOCK-PRICE",
            "https://api.nasdaq.com/tesla/stock-price",
            block.timestamp + 365 days,
            250 * 10**6, // $250 start price
            "NASDAQ",
            tags,
            1000, // 10% margin
            20    // 0.2% fee
        );
        
        // Verify enhanced metadata
        assertEq(factory.getMarketMetricUrl(marketId), "https://api.nasdaq.com/tesla/stock-price");
        assertEq(factory.getMarketDataSource(marketId), "NASDAQ");
        assertEq(factory.getMarketStartPrice(marketId), 250 * 10**6);
        assertTrue(factory.getMarketSettlementDate(marketId) > block.timestamp);
        
        string[] memory retrievedTags = factory.getMarketTags(marketId);
        assertEq(retrievedTags.length, 3);
        assertEq(retrievedTags[0], "STOCKS");
        assertEq(retrievedTags[1], "TECH");
        assertEq(retrievedTags[2], "PREDICTION");
        
        // Verify mark price was set in vault
        assertEq(vault.marketMarkPrices(marketId), 250 * 10**6);
        
        console.log("Enhanced market creation test passed");
    }
    
    function testMarketDiscoveryByDataSource() public {
        // Create markets with different data sources
        string[] memory emptyTags = new string[](0);
        
        vm.prank(alice);
        factory.createFuturesMarket(
            "TESLA-PRICE", 
            "https://nasdaq.com/tesla", 
            block.timestamp + 30 days, 
            250 * 10**6, 
            "NASDAQ", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        factory.createFuturesMarket(
            "APPLE-PRICE", 
            "https://nasdaq.com/apple", 
            block.timestamp + 30 days, 
            180 * 10**6, 
            "NASDAQ", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(charlie);
        factory.createFuturesMarket(
            "BITCOIN-PRICE", 
            "https://coinbase.com/btc", 
            block.timestamp + 30 days, 
            65000 * 10**6, 
            "COINBASE", 
            emptyTags, 
            0, 
            0
        );
        
        // Test data source filtering
        bytes32[] memory nasdaqMarkets = factory.getMarketsByDataSource("NASDAQ");
        bytes32[] memory coinbaseMarkets = factory.getMarketsByDataSource("COINBASE");
        
        assertEq(nasdaqMarkets.length, 2);
        assertEq(coinbaseMarkets.length, 1);
        
        console.log("Market discovery by data source test passed");
        console.log("NASDAQ markets:", nasdaqMarkets.length);
        console.log("COINBASE markets:", coinbaseMarkets.length);
    }
    
    function testMarketDiscoveryByTags() public {
        // Create markets with different tags
        string[] memory stockTags = new string[](2);
        stockTags[0] = "STOCKS";
        stockTags[1] = "TECH";
        
        string[] memory cryptoTags = new string[](2);
        cryptoTags[0] = "CRYPTO";
        cryptoTags[1] = "BITCOIN";
        
        string[] memory sportsTags = new string[](2);
        sportsTags[0] = "SPORTS";
        sportsTags[1] = "NFL";
        
        vm.prank(alice);
        factory.createFuturesMarket(
            "TESLA-STOCK", 
            "https://nasdaq.com/tesla", 
            block.timestamp + 30 days, 
            250 * 10**6, 
            "NASDAQ", 
            stockTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        factory.createFuturesMarket(
            "BITCOIN-100K", 
            "https://coinbase.com/btc", 
            block.timestamp + 60 days, 
            65000 * 10**6, 
            "COINBASE", 
            cryptoTags, 
            0, 
            0
        );
        
        vm.prank(charlie);
        factory.createFuturesMarket(
            "SUPERBOWL-WINNER", 
            "https://nfl.com/superbowl", 
            block.timestamp + 90 days, 
            100 * 10**6, 
            "NFL", 
            sportsTags, 
            0, 
            0
        );
        
        // Test tag-based discovery
        bytes32[] memory stockMarkets = factory.getMarketsByTag("STOCKS");
        bytes32[] memory cryptoMarkets = factory.getMarketsByTag("CRYPTO");
        bytes32[] memory sportsMarkets = factory.getMarketsByTag("SPORTS");
        bytes32[] memory techMarkets = factory.getMarketsByTag("TECH");
        
        assertEq(stockMarkets.length, 1);
        assertEq(cryptoMarkets.length, 1);
        assertEq(sportsMarkets.length, 1);
        assertEq(techMarkets.length, 1); // Tesla has TECH tag
        
        console.log("Market discovery by tags test passed");
    }
    
    function testSettlementTimeRangeDiscovery() public {
        uint256 now = block.timestamp;
        string[] memory emptyTags = new string[](0);
        
        // Create markets with different settlement dates
        vm.prank(alice);
        factory.createFuturesMarket(
            "SHORT-TERM", 
            "https://example.com/short", 
            now + 7 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        factory.createFuturesMarket(
            "MEDIUM-TERM", 
            "https://example.com/medium", 
            now + 30 days, 
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(charlie);
        factory.createFuturesMarket(
            "LONG-TERM", 
            "https://example.com/long", 
            now + 365 days, 
            300 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Test settlement range filtering
        bytes32[] memory shortTermMarkets = factory.getMarketsBySettlementRange(now, now + 14 days);
        bytes32[] memory mediumTermMarkets = factory.getMarketsBySettlementRange(now + 15 days, now + 60 days);
        bytes32[] memory allMarkets = factory.getMarketsBySettlementRange(now, now + 400 days);
        
        assertEq(shortTermMarkets.length, 1);
        assertEq(mediumTermMarkets.length, 1);
        assertEq(allMarkets.length, 3);
        
        console.log("Settlement time range discovery test passed");
    }
    
    function testActiveAndSettlementReadyMarkets() public {
        uint256 now = block.timestamp;
        string[] memory emptyTags = new string[](0);
        
        // Create markets - some active, some ready for settlement
        vm.prank(alice);
        factory.createFuturesMarket(
            "ACTIVE-MARKET", 
            "https://example.com/active", 
            now + 30 days, // Future settlement
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        factory.createFuturesMarket(
            "READY-FOR-SETTLEMENT", 
            "https://example.com/ready", 
            now + 1, // Settlement in 1 second
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Check active markets
        bytes32[] memory activeMarkets = factory.getActiveMarkets();
        assertEq(activeMarkets.length, 2); // Both should be active initially
        
        // Fast forward time to make one ready for settlement
        vm.warp(now + 2);
        
        activeMarkets = factory.getActiveMarkets();
        bytes32[] memory readyMarkets = factory.getMarketsReadyForSettlement();
        
        assertEq(activeMarkets.length, 1); // Only future settlement remains active
        assertEq(readyMarkets.length, 1);  // One ready for settlement
        
        console.log("Active and settlement-ready markets test passed");
    }
    
    function testOracleHealthMonitoring() public {
        string[] memory emptyTags = new string[](0);
        
        // Create markets
        vm.prank(alice);
        (,bytes32 market1) = factory.createFuturesMarket(
            "MARKET-1", 
            "https://example.com/1", 
            block.timestamp + 30 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        (,bytes32 market2) = factory.createFuturesMarket(
            "MARKET-2", 
            "https://example.com/2", 
            block.timestamp + 60 days, 
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Assign custom oracle to one market
        vm.prank(alice);
        factory.assignCustomOracle(market1, address(0x999));
        
        // Check oracle health status
        (
            uint256 totalMarkets,
            uint256 activeMarkets,
            uint256 marketsWithCustomOracles,
            uint256 marketsWithUMARequests,
            uint256 settledMarkets
        ) = factory.getOracleHealthStatus();
        
        assertEq(totalMarkets, 2);
        assertEq(activeMarkets, 2);
        assertEq(marketsWithCustomOracles, 1);
        assertEq(marketsWithUMARequests, 0);
        assertEq(settledMarkets, 0);
        
        console.log("Oracle health monitoring test passed");
        console.log("Total markets:", totalMarkets);
        console.log("Markets with custom oracles:", marketsWithCustomOracles);
    }
    
    function testComprehensiveMarketMetadata() public {
        string[] memory tags = new string[](4);
        tags[0] = "STOCKS";
        tags[1] = "TECH";
        tags[2] = "EARNINGS";
        tags[3] = "Q4";
        
        vm.prank(alice);
        (address orderBook, bytes32 marketId) = factory.createFuturesMarket(
            "TESLA-Q4-EARNINGS-BEAT",
            "https://sec.gov/tesla/earnings/q4",
            block.timestamp + 90 days,
            250 * 10**6,
            "SEC",
            tags,
            1200, // 12% margin
            25    // 0.25% fee
        );
        
        // Test comprehensive market details
        (
            address retrievedOrderBook,
            address creator,
            string memory symbol,
            string memory metricUrl,
            uint256 settlementDate,
            uint256 startPrice,
            uint256 creationTimestamp,
            bool exists
        ) = factory.getMarketDetails(marketId);
        
        assertEq(retrievedOrderBook, orderBook);
        assertEq(creator, alice);
        assertEq(symbol, "TESLA-Q4-EARNINGS-BEAT");
        assertEq(metricUrl, "https://sec.gov/tesla/earnings/q4");
        assertEq(startPrice, 250 * 10**6);
        assertTrue(exists);
        assertTrue(settlementDate > block.timestamp);
        assertTrue(creationTimestamp <= block.timestamp);
        
        // Test market metadata function
        (
            string memory metaSymbol,
            string memory metaUrl,
            uint256 metaSettlement,
            uint256 metaStartPrice,
            bool settled
        ) = factory.getMarketMetadata(marketId);
        
        assertEq(metaSymbol, symbol);
        assertEq(metaUrl, metricUrl);
        assertEq(metaSettlement, settlementDate);
        assertEq(metaStartPrice, startPrice);
        assertFalse(settled);
        
        console.log("Comprehensive market metadata test passed");
    }
    
    function testCustomMetricMarketDiscovery() public {
        string[] memory emptyTags = new string[](0);
        
        // Create multiple custom metric markets
        vm.prank(alice);
        factory.createFuturesMarket(
            "CUSTOM-METRIC-1", 
            "https://custom1.com/data", 
            block.timestamp + 30 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        factory.createFuturesMarket(
            "CUSTOM-METRIC-2", 
            "https://custom2.com/data", 
            block.timestamp + 60 days, 
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Test custom metric discovery
        bytes32[] memory customMarkets = factory.getCustomMetricMarkets();
        assertEq(customMarkets.length, 2);
        
        // All user-created markets should be custom metrics
        bytes32[] memory standardMarkets = factory.getStandardMarkets();
        assertEq(standardMarkets.length, 0);
        
        console.log("Custom metric market discovery test passed");
        console.log("Custom markets found:", customMarkets.length);
    }
    
    function testOracleConfigurationAndManagement() public {
        // Test oracle configuration
        address mockUMAOracle = address(0x111);
        address mockDefaultOracle = address(0x222);
        
        vm.prank(admin);
        factory.configureOracles(mockUMAOracle, mockDefaultOracle, oracleAdmin);
        
        // Create a market to test oracle assignment
        string[] memory emptyTags = new string[](0);
        vm.prank(alice);
        (,bytes32 marketId) = factory.createFuturesMarket(
            "ORACLE-TEST-MARKET", 
            "https://example.com/oracle-test", 
            block.timestamp + 30 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Test custom oracle assignment
        address customOracle = address(0x333);
        vm.prank(alice); // Market creator can assign oracle
        factory.assignCustomOracle(marketId, customOracle);
        
        // Verify oracle configuration
        (
            address retrievedCustomOracle,
            bytes32 umaRequestId,
            bool hasUmaRequest
        ) = factory.getMarketOracleConfig(marketId);
        
        assertEq(retrievedCustomOracle, customOracle);
        assertEq(umaRequestId, bytes32(0));
        assertFalse(hasUmaRequest);
        
        console.log("Oracle configuration and management test passed");
    }
    
    function testMarketsBySettlementStatus() public {
        uint256 now = block.timestamp;
        string[] memory emptyTags = new string[](0);
        
        // Create markets with different settlement statuses
        vm.prank(alice);
        (,bytes32 activeMarketId) = factory.createFuturesMarket(
            "ACTIVE-MARKET", 
            "https://example.com/active", 
            now + 30 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        (,bytes32 expiredMarketId) = factory.createFuturesMarket(
            "EXPIRED-MARKET", 
            "https://example.com/expired", 
            now + 1, // Expires in 1 second
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Initially both should be active
        bytes32[] memory activeMarkets = factory.getActiveMarkets();
        assertEq(activeMarkets.length, 2);
        
        // Fast forward time
        vm.warp(now + 2);
        
        // Now one should be ready for settlement
        activeMarkets = factory.getActiveMarkets();
        bytes32[] memory readyMarkets = factory.getMarketsReadyForSettlement();
        
        assertEq(activeMarkets.length, 1);
        assertEq(readyMarkets.length, 1);
        
        // Test manual settlement
        vm.prank(oracleAdmin);
        factory.manualSettle(expiredMarketId, 220 * 10**6);
        
        // Check settlement status
        (bool settled, uint256 finalPrice) = factory.getMarketSettlementInfo(expiredMarketId);
        assertTrue(settled);
        assertEq(finalPrice, 220 * 10**6);
        
        console.log("Markets by settlement status test passed");
    }
    
    function testBatchPriceUpdates() public {
        string[] memory emptyTags = new string[](0);
        
        // Create multiple markets
        vm.prank(alice);
        (,bytes32 market1) = factory.createFuturesMarket(
            "MARKET-1", 
            "https://example.com/1", 
            block.timestamp + 30 days, 
            100 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        vm.prank(bob);
        (,bytes32 market2) = factory.createFuturesMarket(
            "MARKET-2", 
            "https://example.com/2", 
            block.timestamp + 60 days, 
            200 * 10**6, 
            "CUSTOM", 
            emptyTags, 
            0, 
            0
        );
        
        // Test batch price updates
        bytes32[] memory marketIds = new bytes32[](2);
        marketIds[0] = market1;
        marketIds[1] = market2;
        
        uint256[] memory newPrices = new uint256[](2);
        newPrices[0] = 110 * 10**6; // +10%
        newPrices[1] = 180 * 10**6; // -10%
        
        vm.prank(oracleAdmin);
        factory.batchUpdatePrices(marketIds, newPrices);
        
        // Verify prices were updated
        assertEq(vault.marketMarkPrices(market1), 110 * 10**6);
        assertEq(vault.marketMarkPrices(market2), 180 * 10**6);
        
        console.log("Batch price updates test passed");
    }
    
    function testUserMarketCreationTracking() public {
        string[] memory emptyTags = new string[](0);
        
        // Alice creates multiple markets
        vm.startPrank(alice);
        factory.createFuturesMarket("ALICE-MARKET-1", "https://alice1.com", block.timestamp + 30 days, 100 * 10**6, "CUSTOM", emptyTags, 0, 0);
        factory.createFuturesMarket("ALICE-MARKET-2", "https://alice2.com", block.timestamp + 60 days, 200 * 10**6, "CUSTOM", emptyTags, 0, 0);
        factory.createFuturesMarket("ALICE-MARKET-3", "https://alice3.com", block.timestamp + 90 days, 300 * 10**6, "CUSTOM", emptyTags, 0, 0);
        vm.stopPrank();
        
        // Bob creates one market
        vm.prank(bob);
        factory.createFuturesMarket("BOB-MARKET", "https://bob.com", block.timestamp + 45 days, 150 * 10**6, "CUSTOM", emptyTags, 0, 0);
        
        // Test user creation tracking
        bytes32[] memory aliceMarkets = factory.getUserCreatedMarkets(alice);
        bytes32[] memory bobMarkets = factory.getUserCreatedMarkets(bob);
        bytes32[] memory charlieMarkets = factory.getUserCreatedMarkets(charlie);
        
        assertEq(aliceMarkets.length, 3);
        assertEq(bobMarkets.length, 1);
        assertEq(charlieMarkets.length, 0);
        
        // Test total market count
        assertEq(factory.getOrderBookCount(), 4);
        
        console.log("User market creation tracking test passed");
        console.log("Alice created:", aliceMarkets.length, "markets");
        console.log("Bob created:", bobMarkets.length, "markets");
        console.log("Total markets:", factory.getOrderBookCount());
    }
}
