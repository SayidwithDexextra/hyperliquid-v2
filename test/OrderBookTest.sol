// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/OrderBook.sol";

/**
 * @title OrderBookTest
 * @dev Comprehensive test suite for the OrderBook contract
 */
contract OrderBookTest is Test {
    OrderBook public orderBook;
    
    // Events for testing (must match contract events)
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy);
    event OrderMatched(address indexed buyer, address indexed seller, uint256 price, uint256 amount);
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 filledAmount, uint256 remainingAmount);
    
    // Test addresses
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);
    address public dave = address(0x4);
    
    // Test constants with 18 decimals
    uint256 constant PRICE_100 = 100 * 10**18;  // $100
    uint256 constant PRICE_95 = 95 * 10**18;    // $95
    uint256 constant PRICE_105 = 105 * 10**18;  // $105
    uint256 constant PRICE_90 = 90 * 10**18;    // $90
    uint256 constant PRICE_110 = 110 * 10**18;  // $110
    
    uint256 constant AMOUNT_10 = 10 * 10**18;   // 10 tokens
    uint256 constant AMOUNT_5 = 5 * 10**18;     // 5 tokens
    uint256 constant AMOUNT_15 = 15 * 10**18;   // 15 tokens
    uint256 constant AMOUNT_20 = 20 * 10**18;   // 20 tokens
    uint256 constant AMOUNT_3 = 3 * 10**18;     // 3 tokens
    
    function setUp() public {
        orderBook = new OrderBook();
    }
    
    // ============ Basic Order Placement Tests ============
    
    function testPlaceLimitBuyOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        assertEq(orderId, 1);
        assertEq(orderBook.bestBid(), PRICE_100);
        assertEq(orderBook.bestAsk(), type(uint256).max);
        
        OrderBook.Order memory order = orderBook.getOrder(orderId);
        assertEq(order.trader, alice);
        assertEq(order.price, PRICE_100);
        assertEq(order.amount, AMOUNT_10);
        assertTrue(order.isBuy);
    }
    
    function testPlaceLimitSellOrder() public {
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, false);
        
        assertEq(orderId, 1);
        assertEq(orderBook.bestBid(), 0);
        assertEq(orderBook.bestAsk(), PRICE_100);
        
        OrderBook.Order memory order = orderBook.getOrder(orderId);
        assertEq(order.trader, alice);
        assertEq(order.price, PRICE_100);
        assertEq(order.amount, AMOUNT_10);
        assertFalse(order.isBuy);
    }
    
    function testInvalidOrderParameters() public {
        vm.prank(alice);
        
        // Test zero price
        vm.expectRevert("Price must be greater than 0");
        orderBook.placeLimitOrder(0, AMOUNT_10, true);
        
        // Test zero amount
        vm.expectRevert("Amount must be greater than 0");
        orderBook.placeLimitOrder(PRICE_100, 0, true);
    }
    
    // ============ Order Matching Tests ============
    
    function testSimpleOrderMatching() public {
        // Alice places a sell order at $100
        vm.prank(alice);
        uint256 sellOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, false);
        
        // Bob places a buy order at $100 - should match immediately
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(bob, alice, PRICE_100, AMOUNT_10);
        
        uint256 buyOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        // Both orders should be fully filled and removed
        OrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderId);
        OrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderId);
        
        assertEq(sellOrder.trader, address(0)); // Order deleted
        assertEq(buyOrder.trader, address(0));  // Order deleted
        
        // Best bid/ask should be reset
        assertEq(orderBook.bestBid(), 0);
        assertEq(orderBook.bestAsk(), type(uint256).max);
    }
    
    function testLimitBuyCrossesAsk() public {
        // Alice places sell order at $100
        vm.prank(alice);
        uint256 sellOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, false);
        
        // Bob places buy order at $105 - should cross and execute at $100 (better price for buyer)
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(bob, alice, PRICE_100, AMOUNT_10);
        
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_10, true);
        
        // Sell order should be filled
        OrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderId);
        assertEq(sellOrder.trader, address(0));
    }
    
    function testLimitSellCrossesBid() public {
        // Alice places buy order at $100
        vm.prank(alice);
        uint256 buyOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        // Bob places sell order at $95 - should cross and execute at $100 (better price for seller)
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(alice, bob, PRICE_100, AMOUNT_10);
        
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_10, false);
        
        // Buy order should be filled
        OrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderId);
        assertEq(buyOrder.trader, address(0));
    }
    
    // ============ Partial Fill Tests ============
    
    function testPartialFillBuyOrder() public {
        // Alice places sell order for 10 tokens at $100
        vm.prank(alice);
        uint256 sellOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, false);
        
        // Bob places buy order for 15 tokens at $100 - should partially fill
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(bob, alice, PRICE_100, AMOUNT_10);
        
        uint256 buyOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_15, true);
        
        // Sell order should be fully filled and removed
        OrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderId);
        assertEq(sellOrder.trader, address(0));
        
        // Buy order should have 5 tokens remaining and rest in book
        OrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderId);
        assertEq(buyOrder.amount, AMOUNT_5);
        assertEq(orderBook.bestBid(), PRICE_100);
    }
    
    function testPartialFillSellOrder() public {
        // Alice places buy order for 10 tokens at $100
        vm.prank(alice);
        uint256 buyOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        // Bob places sell order for 15 tokens at $100 - should partially fill
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(alice, bob, PRICE_100, AMOUNT_10);
        
        uint256 sellOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_15, false);
        
        // Buy order should be fully filled and removed
        OrderBook.Order memory buyOrder = orderBook.getOrder(buyOrderId);
        assertEq(buyOrder.trader, address(0));
        
        // Sell order should have 5 tokens remaining and rest in book
        OrderBook.Order memory sellOrder = orderBook.getOrder(sellOrderId);
        assertEq(sellOrder.amount, AMOUNT_5);
        assertEq(orderBook.bestAsk(), PRICE_100);
    }
    
    // ============ Multi-Level Matching Tests ============
    
    function testMarketBuyMatchesMultipleLevels() public {
        // Setup sell book with multiple levels
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, false);  // 5 @ $100
        
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, false);  // 5 @ $105
        
        vm.prank(charlie);
        orderBook.placeLimitOrder(PRICE_110, AMOUNT_10, false); // 10 @ $110
        
        // Dave places market buy for 15 tokens - should match across levels
        vm.prank(dave);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(dave, alice, PRICE_100, AMOUNT_5);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(dave, bob, PRICE_105, AMOUNT_5);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(dave, charlie, PRICE_110, AMOUNT_5);
        
        uint256 filledAmount = orderBook.placeMarketOrder(AMOUNT_15, true);
        
        assertEq(filledAmount, AMOUNT_15);
        
        // Check remaining order at $110
        (uint256[] memory bidPrices, uint256[] memory bidAmounts, 
         uint256[] memory askPrices, uint256[] memory askAmounts) = orderBook.getOrderBookDepth(5);
        
        assertEq(askPrices.length, 1);
        assertEq(askPrices[0], PRICE_110);
        assertEq(askAmounts[0], AMOUNT_5); // 5 tokens remaining
    }
    
    function testMarketSellMatchesMultipleLevels() public {
        // Setup buy book with multiple levels
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_110, AMOUNT_5, true);  // 5 @ $110
        
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, true);  // 5 @ $105
        
        vm.prank(charlie);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true); // 10 @ $100
        
        // Dave places market sell for 15 tokens - should match across levels
        vm.prank(dave);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(alice, dave, PRICE_110, AMOUNT_5);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(bob, dave, PRICE_105, AMOUNT_5);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(charlie, dave, PRICE_100, AMOUNT_5);
        
        uint256 filledAmount = orderBook.placeMarketOrder(AMOUNT_15, false);
        
        assertEq(filledAmount, AMOUNT_15);
        
        // Check remaining order at $100
        (uint256[] memory bidPrices, uint256[] memory bidAmounts, 
         uint256[] memory askPrices, uint256[] memory askAmounts) = orderBook.getOrderBookDepth(5);
        
        assertEq(bidPrices.length, 1);
        assertEq(bidPrices[0], PRICE_100);
        assertEq(bidAmounts[0], AMOUNT_5); // 5 tokens remaining
    }
    
    // ============ FIFO Order Priority Tests ============
    
    function testFIFOOrderPriority() public {
        // Alice places first sell order at $100
        vm.prank(alice);
        uint256 aliceOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, false);
        
        // Bob places second sell order at $100
        vm.prank(bob);
        uint256 bobOrderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, false);
        
        // Charlie places buy order for 5 tokens - should match Alice first (FIFO)
        vm.prank(charlie);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(charlie, alice, PRICE_100, AMOUNT_5);
        
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, true);
        
        // Alice's order should be filled, Bob's should remain
        OrderBook.Order memory aliceOrder = orderBook.getOrder(aliceOrderId);
        OrderBook.Order memory bobOrder = orderBook.getOrder(bobOrderId);
        
        assertEq(aliceOrder.trader, address(0)); // Alice's order filled
        assertEq(bobOrder.trader, bob);          // Bob's order still exists
        assertEq(bobOrder.amount, AMOUNT_5);
    }
    
    // ============ Order Cancellation Tests ============
    
    function testCancelOrder() public {
        // Alice places buy order
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        assertEq(orderBook.bestBid(), PRICE_100);
        
        // Alice cancels order
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit OrderCancelled(orderId, alice);
        
        orderBook.cancelOrder(orderId);
        
        // Order should be removed
        OrderBook.Order memory order = orderBook.getOrder(orderId);
        assertEq(order.trader, address(0));
        
        // Best bid should be reset
        assertEq(orderBook.bestBid(), 0);
    }
    
    function testCannotCancelNonExistentOrder() public {
        vm.prank(alice);
        vm.expectRevert("Order does not exist");
        orderBook.cancelOrder(999);
    }
    
    function testCannotCancelOthersOrder() public {
        // Alice places order
        vm.prank(alice);
        uint256 orderId = orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        // Bob tries to cancel Alice's order
        vm.prank(bob);
        vm.expectRevert("Not order owner");
        orderBook.cancelOrder(orderId);
    }
    
    // ============ Market Order Edge Cases ============
    
    function testMarketOrderWithInsufficientLiquidity() public {
        // Alice places small sell order
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, false);
        
        // Bob tries to buy more than available
        vm.prank(bob);
        uint256 filledAmount = orderBook.placeMarketOrder(AMOUNT_10, true);
        
        // Should only fill 5 tokens
        assertEq(filledAmount, AMOUNT_5);
        
        // Ask should be reset since no more sell orders
        assertEq(orderBook.bestAsk(), type(uint256).max);
    }
    
    function testMarketOrderWithEmptyBook() public {
        // Try market order with empty book
        vm.prank(alice);
        uint256 filledAmount = orderBook.placeMarketOrder(AMOUNT_10, true);
        
        assertEq(filledAmount, 0);
    }
    
    // ============ Order Book Depth Tests ============
    
    function testOrderBookDepth() public {
        // Setup order book with multiple levels
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_5, true);   // Buy @ $95
        
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true); // Buy @ $100
        
        vm.prank(charlie);
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, false); // Sell @ $105
        
        vm.prank(dave);
        orderBook.placeLimitOrder(PRICE_110, AMOUNT_10, false); // Sell @ $110
        
        (uint256[] memory bidPrices, uint256[] memory bidAmounts,
         uint256[] memory askPrices, uint256[] memory askAmounts) = orderBook.getOrderBookDepth(5);
        
        // Bids should be sorted by price descending
        assertEq(bidPrices.length, 2);
        assertEq(bidPrices[0], PRICE_100); // Highest bid first
        assertEq(bidAmounts[0], AMOUNT_10);
        assertEq(bidPrices[1], PRICE_95);
        assertEq(bidAmounts[1], AMOUNT_5);
        
        // Asks should be sorted by price ascending
        assertEq(askPrices.length, 2);
        assertEq(askPrices[0], PRICE_105); // Lowest ask first
        assertEq(askAmounts[0], AMOUNT_5);
        assertEq(askPrices[1], PRICE_110);
        assertEq(askAmounts[1], AMOUNT_10);
    }
    
    // ============ Best Bid/Ask Update Tests ============
    
    function testBestBidAskUpdates() public {
        // Place buy orders at different prices
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_5, true);
        assertEq(orderBook.bestBid(), PRICE_95);
        
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, true);
        assertEq(orderBook.bestBid(), PRICE_100); // Higher bid becomes best
        
        // Place sell orders at different prices
        vm.prank(charlie);
        orderBook.placeLimitOrder(PRICE_110, AMOUNT_5, false);
        assertEq(orderBook.bestAsk(), PRICE_110);
        
        vm.prank(dave);
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, false);
        assertEq(orderBook.bestAsk(), PRICE_105); // Lower ask becomes best
        
        // Check spread
        uint256 spread = orderBook.getSpread();
        assertEq(spread, PRICE_105 - PRICE_100);
    }
    
    // ============ Complex Scenario Tests ============
    
    function testComplexTradingScenario() public {
        // Build initial order book
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_10, true);  // Buy @ $95
        
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, true);  // Buy @ $100
        
        vm.prank(charlie);
        orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, false); // Sell @ $105
        
        vm.prank(dave);
        orderBook.placeLimitOrder(PRICE_110, AMOUNT_10, false); // Sell @ $110
        
        // Verify initial state
        assertEq(orderBook.bestBid(), PRICE_100);
        assertEq(orderBook.bestAsk(), PRICE_105);
        assertEq(orderBook.getSpread(), PRICE_105 - PRICE_100);
        
        // Place aggressive buy order that crosses multiple levels
        vm.prank(alice);
        uint256 filledAmount = orderBook.placeMarketOrder(AMOUNT_15, true);
        
        // Should fill all sell orders (5 @ $105 + 10 @ $110)
        assertEq(filledAmount, AMOUNT_15);
        assertEq(orderBook.bestAsk(), type(uint256).max); // No more sell orders
        
        // Place new sell order
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_20, false);
        
        // Should immediately cross with remaining buy order at $100
        OrderBook.Order memory bobBuyOrder = orderBook.getOrder(2); // Bob's buy order
        assertEq(bobBuyOrder.trader, address(0)); // Should be filled
        
        // New sell order should rest in book with remaining amount
        assertEq(orderBook.bestAsk(), PRICE_95);
    }
    
    // ============ Edge Case Tests ============
    
    function testCrossedBookPrevention() public {
        // Place buy at $100
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        
        // Place sell at $95 - should immediately execute, not create crossed book
        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit OrderMatched(alice, bob, PRICE_100, AMOUNT_10);
        
        orderBook.placeLimitOrder(PRICE_95, AMOUNT_10, false);
        
        // Book should not be crossed
        assertFalse(orderBook.isBookCrossed());
        assertEq(orderBook.bestBid(), 0);
        assertEq(orderBook.bestAsk(), type(uint256).max);
    }
    
    function testUserOrdersTracking() public {
        // Alice places multiple orders
        vm.prank(alice);
        uint256 order1 = orderBook.placeLimitOrder(PRICE_95, AMOUNT_5, true);
        
        vm.prank(alice);
        uint256 order2 = orderBook.placeLimitOrder(PRICE_105, AMOUNT_5, false);
        
        uint256[] memory aliceOrders = orderBook.getUserOrders(alice);
        assertEq(aliceOrders.length, 2);
        assertEq(aliceOrders[0], order1);
        assertEq(aliceOrders[1], order2);
        
        // Bob should have no orders
        uint256[] memory bobOrders = orderBook.getUserOrders(bob);
        assertEq(bobOrders.length, 0);
    }
    
    // ============ Gas Optimization Tests ============
    
    function testGasOptimizationBenchmark() public {
        // Measure gas for various operations
        uint256 gasBefore;
        uint256 gasAfter;
        
        // Test limit order placement
        gasBefore = gasleft();
        vm.prank(alice);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_10, true);
        gasAfter = gasleft();
        console.log("Limit order placement gas:", gasBefore - gasAfter);
        
        // Test market order execution
        vm.prank(bob);
        orderBook.placeLimitOrder(PRICE_100, AMOUNT_5, false);
        
        gasBefore = gasleft();
        vm.prank(charlie);
        orderBook.placeMarketOrder(AMOUNT_5, true);
        gasAfter = gasleft();
        console.log("Market order execution gas:", gasBefore - gasAfter);
    }
}
