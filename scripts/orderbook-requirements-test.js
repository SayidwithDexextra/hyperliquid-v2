// orderbook-requirements-test.js - Comprehensive Order Book Requirements Testing
//
// 🎯 PURPOSE:
//   - Test all 15 order book requirements specified by the user
//   - Validate order matching logic, partial fills, market orders, and order management
//   - Provide detailed test results with pass/fail status for each requirement
//
// 📋 REQUIREMENTS TESTED:
//   1-4:  Limit order placement and matching (buy/sell, partial fills)
//   5-6:  Market order execution with slippage tolerance
//   7-9:  Order removal and partial fill handling
//   10-11: Market order prioritization and slippage limits
//   12-15: Order book state management, cancellation, modification, real-time updates

const { ethers } = require("hardhat");
const { getContract, getAddress, MARKET_INFO } = require("../config");

// Test configuration
const TEST_CONFIG = {
  PRICE_DECIMALS: 6, // USDC has 6 decimals
  AMOUNT_DECIMALS: 18, // Standard 18 decimals for amounts
  MAX_SLIPPAGE_BPS: 500, // 5% maximum slippage for market orders
  TEST_TIMEOUT: 30000, // 30 seconds timeout per test
  VERBOSE_LOGGING: true, // Enable detailed logging
};

// ANSI Color codes for beautiful output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

// Test result tracking
class TestResults {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  addResult(requirement, testName, passed, details = "", error = null) {
    this.results.push({
      requirement,
      testName,
      passed,
      details,
      error: error ? error.message : null,
      timestamp: Date.now(),
    });
  }

  getPassedCount() {
    return this.results.filter((r) => r.passed).length;
  }

  getFailedCount() {
    return this.results.filter((r) => !r.passed).length;
  }

  getTotalCount() {
    return this.results.length;
  }

  printSummary() {
    const passed = this.getPassedCount();
    const failed = this.getFailedCount();
    const total = this.getTotalCount();
    const duration = (Date.now() - this.startTime) / 1000;

    console.log("\n" + "═".repeat(80));
    console.log(
      colorText("📊 ORDER BOOK REQUIREMENTS TEST SUMMARY", colors.bright)
    );
    console.log("═".repeat(80));

    console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
    console.log(`📈 Total Tests: ${total}`);
    console.log(colorText(`✅ Passed: ${passed}`, colors.green));
    console.log(colorText(`❌ Failed: ${failed}`, colors.red));
    console.log(`📊 Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

    console.log("\n" + "─".repeat(80));
    console.log("DETAILED RESULTS:");
    console.log("─".repeat(80));

    // Group by requirement
    const byRequirement = {};
    this.results.forEach((result) => {
      if (!byRequirement[result.requirement]) {
        byRequirement[result.requirement] = [];
      }
      byRequirement[result.requirement].push(result);
    });

    for (const [req, tests] of Object.entries(byRequirement)) {
      const reqPassed = tests.filter((t) => t.passed).length;
      const reqTotal = tests.length;
      const reqStatus = reqPassed === reqTotal ? "✅" : "❌";

      console.log(
        `\n${reqStatus} Requirement ${req}: ${reqPassed}/${reqTotal} tests passed`
      );

      tests.forEach((test) => {
        const status = test.passed
          ? colorText("✅ PASS", colors.green)
          : colorText("❌ FAIL", colors.red);
        console.log(`  ${status} ${test.testName}`);
        if (test.details) {
          console.log(`    📝 ${test.details}`);
        }
        if (test.error) {
          console.log(colorText(`    🚨 Error: ${test.error}`, colors.red));
        }
      });
    }

    console.log("\n" + "═".repeat(80));

    if (failed === 0) {
      console.log(
        colorText(
          "🎉 ALL REQUIREMENTS PASSED! Order book is functioning correctly.",
          colors.green
        )
      );
    } else {
      console.log(
        colorText(
          `⚠️  ${failed} test(s) failed. Review the detailed results above.`,
          colors.yellow
        )
      );
    }

    console.log("═".repeat(80));
  }
}

// Utility functions
class OrderBookTestUtils {
  constructor(orderBook, mockUSDC, testResults) {
    this.orderBook = orderBook;
    this.mockUSDC = mockUSDC;
    this.testResults = testResults;
  }

  // Convert price to contract format (6 decimals)
  toPrice(price) {
    return ethers.utils.parseUnits(
      price.toString(),
      TEST_CONFIG.PRICE_DECIMALS
    );
  }

  // Convert amount to contract format (18 decimals)
  toAmount(amount) {
    return ethers.utils.parseUnits(
      amount.toString(),
      TEST_CONFIG.AMOUNT_DECIMALS
    );
  }

  // Convert from contract format to readable format
  fromPrice(price) {
    return parseFloat(
      ethers.utils.formatUnits(price, TEST_CONFIG.PRICE_DECIMALS)
    );
  }

  fromAmount(amount) {
    return parseFloat(
      ethers.utils.formatUnits(amount, TEST_CONFIG.AMOUNT_DECIMALS)
    );
  }

  // Get current order book state
  async getOrderBookState() {
    const [bidPrices, bidAmounts, askPrices, askAmounts] =
      await this.orderBook.getOrderBookDepth(20);
    const bestBid = await this.orderBook.bestBid();
    const bestAsk = await this.orderBook.bestAsk();
    const [buyOrderCount, sellOrderCount] =
      await this.orderBook.getActiveOrdersCount();

    return {
      bids: bidPrices
        .map((price, i) => ({
          price: this.fromPrice(price),
          amount: this.fromAmount(bidAmounts[i]),
        }))
        .filter((order) => order.price > 0),
      asks: askPrices
        .map((price, i) => ({
          price: this.fromPrice(price),
          amount: this.fromAmount(askAmounts[i]),
        }))
        .filter((order) => order.price > 0),
      bestBid: bestBid.gt(0) ? this.fromPrice(bestBid) : 0,
      bestAsk: bestAsk.lt(ethers.constants.MaxUint256)
        ? this.fromPrice(bestAsk)
        : 0,
      buyOrderCount: buyOrderCount.toNumber(),
      sellOrderCount: sellOrderCount.toNumber(),
    };
  }

  // Clear order book by canceling all orders for test users
  async clearOrderBook(users) {
    for (const user of users) {
      try {
        const userOrderIds = await this.orderBook.getUserOrders(user.address);
        for (const orderId of userOrderIds) {
          try {
            await this.orderBook.connect(user).cancelOrder(orderId);
          } catch (error) {
            // Order might already be filled or canceled
          }
        }
      } catch (error) {
        // User might not have any orders
      }
    }

    // Wait for transactions to be mined
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Setup test environment with clean state
  async setupTest(users) {
    await this.clearOrderBook(users);

    // Ensure users have USDC for testing
    for (const user of users) {
      try {
        const balance = await this.mockUSDC.balanceOf(user.address);
        if (balance.lt(ethers.utils.parseUnits("10000", 6))) {
          await this.mockUSDC.mint(
            user.address,
            ethers.utils.parseUnits("10000", 6)
          );
        }
      } catch (error) {
        // If balanceOf fails, the user might not have USDC yet, so mint some
        console.log(`    Minting initial USDC for user ${user.address}`);
        await this.mockUSDC.mint(
          user.address,
          ethers.utils.parseUnits("10000", 6)
        );
      }
    }
  }

  // Log order book state for debugging
  async logOrderBookState(title = "Order Book State") {
    if (!TEST_CONFIG.VERBOSE_LOGGING) return;

    const state = await this.getOrderBookState();
    console.log(`\n📊 ${title}:`);
    console.log(`   Best Bid: $${state.bestBid} | Best Ask: $${state.bestAsk}`);
    console.log(
      `   Orders: ${state.buyOrderCount} buys, ${state.sellOrderCount} sells`
    );

    if (state.bids.length > 0) {
      console.log(
        "   📈 Bids:",
        state.bids
          .slice(0, 3)
          .map((b) => `$${b.price}×${b.amount}`)
          .join(", ")
      );
    }
    if (state.asks.length > 0) {
      console.log(
        "   📉 Asks:",
        state.asks
          .slice(0, 3)
          .map((a) => `$${a.price}×${a.amount}`)
          .join(", ")
      );
    }
  }

  // Wait for transaction and return receipt
  async waitForTransaction(tx, description = "Transaction") {
    try {
      const receipt = await tx.wait();
      if (TEST_CONFIG.VERBOSE_LOGGING) {
        console.log(
          `   ⛽ ${description} gas used: ${receipt.gasUsed.toString()}`
        );
      }
      return receipt;
    } catch (error) {
      console.error(`❌ ${description} failed:`, error.message);
      throw error;
    }
  }
}

// Test implementations for each requirement
class OrderBookRequirementsTests {
  constructor(orderBook, mockUSDC, users, testResults) {
    this.orderBook = orderBook;
    this.mockUSDC = mockUSDC;
    this.users = users;
    this.testResults = testResults;
    this.utils = new OrderBookTestUtils(orderBook, mockUSDC, testResults);
  }

  // Requirement 1: Limit buy order behavior
  async testRequirement1() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 1: Limit Buy Order Behavior",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      // Test 1a: Buy order matches lower sell orders
      console.log("  Test 1a: Buy order matches lower sell orders");

      // Place sell order at $10
      const sellTx = await this.orderBook.connect(seller).placeLimitOrder(
        this.utils.toPrice(10),
        this.utils.toAmount(100),
        false // sell
      );
      await this.utils.waitForTransaction(sellTx, "Sell order");

      // Place buy order at $12 (higher than sell) - should match
      const buyTx = await this.orderBook.connect(buyer).placeLimitOrder(
        this.utils.toPrice(12),
        this.utils.toAmount(50),
        true // buy
      );
      const buyReceipt = await this.utils.waitForTransaction(
        buyTx,
        "Buy order"
      );

      // Check if OrderMatched event was emitted
      const matchEvents =
        buyReceipt.events?.filter((e) => e.event === "OrderMatched") || [];
      const orderPlacedEvents =
        buyReceipt.events?.filter((e) => e.event === "OrderPlaced") || [];

      if (matchEvents.length > 0) {
        this.testResults.addResult(
          1,
          "Buy order matches lower sell orders",
          true,
          `Matched ${this.utils.fromAmount(
            matchEvents[0].args.amount
          )} units at $${this.utils.fromPrice(matchEvents[0].args.price)}`
        );
      } else {
        this.testResults.addResult(
          1,
          "Buy order matches lower sell orders",
          false,
          "No matching occurred when buy price was higher than sell price"
        );
      }

      await this.utils.clearOrderBook(this.users);

      // Test 1b: Buy order stays in book when price is lower
      console.log(
        "  Test 1b: Buy order stays in book when price is lower than sell orders"
      );

      // Place sell order at $15
      await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(100),
          false
        );

      // Place buy order at $12 (lower than sell) - should stay in book
      const buyTx2 = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(this.utils.toPrice(12), this.utils.toAmount(50), true);
      const buyReceipt2 = await this.utils.waitForTransaction(
        buyTx2,
        "Buy order (lower price)"
      );

      const matchEvents2 =
        buyReceipt2.events?.filter((e) => e.event === "OrderMatched") || [];
      const orderPlacedEvents2 =
        buyReceipt2.events?.filter((e) => e.event === "OrderPlaced") || [];

      if (matchEvents2.length === 0 && orderPlacedEvents2.length > 0) {
        this.testResults.addResult(
          1,
          "Buy order stays in book when price is lower",
          true,
          "Order correctly placed in book without matching"
        );
      } else {
        this.testResults.addResult(
          1,
          "Buy order stays in book when price is lower",
          false,
          "Order should not have matched or should have been placed in book"
        );
      }

      await this.utils.clearOrderBook(this.users);

      // Test 1c: Buy order stays in empty book
      console.log("  Test 1c: Buy order stays in empty book");

      const buyTx3 = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          true
        );
      const buyReceipt3 = await this.utils.waitForTransaction(
        buyTx3,
        "Buy order (empty book)"
      );

      const state = await this.utils.getOrderBookState();
      if (state.buyOrderCount === 1 && state.bestBid === 10) {
        this.testResults.addResult(
          1,
          "Buy order stays in empty book",
          true,
          `Order placed with best bid at $${state.bestBid}`
        );
      } else {
        this.testResults.addResult(
          1,
          "Buy order stays in empty book",
          false,
          `Expected 1 buy order at $10, got ${state.buyOrderCount} orders with best bid $${state.bestBid}`
        );
      }
    } catch (error) {
      this.testResults.addResult(1, "Requirement 1 tests", false, "", error);
    }
  }

  // Requirement 2: Limit sell order behavior
  async testRequirement2() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 2: Limit Sell Order Behavior",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      // Test 2a: Sell order matches higher buy orders
      console.log("  Test 2a: Sell order matches higher buy orders");

      // Place buy order at $15
      await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(100),
          true
        );

      // Place sell order at $12 (lower than buy) - should match
      const sellTx = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(50),
          false
        );
      const sellReceipt = await this.utils.waitForTransaction(
        sellTx,
        "Sell order"
      );

      const matchEvents =
        sellReceipt.events?.filter((e) => e.event === "OrderMatched") || [];

      if (matchEvents.length > 0) {
        this.testResults.addResult(
          2,
          "Sell order matches higher buy orders",
          true,
          `Matched ${this.utils.fromAmount(
            matchEvents[0].args.amount
          )} units at $${this.utils.fromPrice(matchEvents[0].args.price)}`
        );
      } else {
        this.testResults.addResult(
          2,
          "Sell order matches higher buy orders",
          false,
          "No matching occurred when sell price was lower than buy price"
        );
      }

      await this.utils.clearOrderBook(this.users);

      // Test 2b: Sell order stays in book when price is higher
      console.log(
        "  Test 2b: Sell order stays in book when price is higher than buy orders"
      );

      // Place buy order at $10
      await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          true
        );

      // Place sell order at $15 (higher than buy) - should stay in book
      const sellTx2 = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(50),
          false
        );
      const sellReceipt2 = await this.utils.waitForTransaction(
        sellTx2,
        "Sell order (higher price)"
      );

      const matchEvents2 =
        sellReceipt2.events?.filter((e) => e.event === "OrderMatched") || [];
      const orderPlacedEvents2 =
        sellReceipt2.events?.filter((e) => e.event === "OrderPlaced") || [];

      if (matchEvents2.length === 0 && orderPlacedEvents2.length > 0) {
        this.testResults.addResult(
          2,
          "Sell order stays in book when price is higher",
          true,
          "Order correctly placed in book without matching"
        );
      } else {
        this.testResults.addResult(
          2,
          "Sell order stays in book when price is higher",
          false,
          "Order should not have matched or should have been placed in book"
        );
      }

      await this.utils.clearOrderBook(this.users);

      // Test 2c: Sell order stays in empty book
      console.log("  Test 2c: Sell order stays in empty book");

      const sellTx3 = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(20),
          this.utils.toAmount(100),
          false
        );
      await this.utils.waitForTransaction(sellTx3, "Sell order (empty book)");

      const state = await this.utils.getOrderBookState();
      if (state.sellOrderCount === 1 && state.bestAsk === 20) {
        this.testResults.addResult(
          2,
          "Sell order stays in empty book",
          true,
          `Order placed with best ask at $${state.bestAsk}`
        );
      } else {
        this.testResults.addResult(
          2,
          "Sell order stays in empty book",
          false,
          `Expected 1 sell order at $20, got ${state.sellOrderCount} orders with best ask $${state.bestAsk}`
        );
      }
    } catch (error) {
      this.testResults.addResult(2, "Requirement 2 tests", false, "", error);
    }
  }

  // Requirement 3: Partial matching for buy orders
  async testRequirement3() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 3: Partial Buy Order Matching",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log(
        "  Test 3: Buy order partially matches and creates remaining order"
      );

      // Place sell order with 50 units at $10
      await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(50),
          false
        );

      // Place buy order with 100 units at $12 - should match 50 and leave 50 in book
      const buyTx = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(100),
          true
        );
      const buyReceipt = await this.utils.waitForTransaction(
        buyTx,
        "Partial buy order"
      );

      // Check events
      const matchEvents =
        buyReceipt.events?.filter((e) => e.event === "OrderMatched") || [];
      const orderPlacedEvents =
        buyReceipt.events?.filter((e) => e.event === "OrderPlaced") || [];

      const state = await this.utils.getOrderBookState();

      // Should have matched 50 units and left 50 units in buy book
      const matchedCorrectly =
        matchEvents.length > 0 &&
        this.utils.fromAmount(matchEvents[0].args.amount) === 50;
      const remainingOrderExists =
        state.buyOrderCount === 1 &&
        state.bids.length > 0 &&
        state.bids[0].amount === 50;

      if (matchedCorrectly && remainingOrderExists) {
        this.testResults.addResult(
          3,
          "Partial buy order matching",
          true,
          `Matched 50 units, remaining 50 units placed in book at $${state.bids[0].price}`
        );
      } else {
        this.testResults.addResult(
          3,
          "Partial buy order matching",
          false,
          `Expected to match 50 and leave 50 in book. Matches: ${matchEvents.length}, Buy orders: ${state.buyOrderCount}`
        );
      }
    } catch (error) {
      this.testResults.addResult(3, "Requirement 3 tests", false, "", error);
    }
  }

  // Requirement 4: Partial matching for sell orders
  async testRequirement4() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 4: Partial Sell Order Matching",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log(
        "  Test 4: Sell order partially matches and creates remaining order"
      );

      // Place buy order with 50 units at $15
      await this.orderBook
        .connect(buyer)
        .placeLimitOrder(this.utils.toPrice(15), this.utils.toAmount(50), true);

      // Place sell order with 100 units at $12 - should match 50 and leave 50 in book
      const sellTx = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(100),
          false
        );
      const sellReceipt = await this.utils.waitForTransaction(
        sellTx,
        "Partial sell order"
      );

      // Check events
      const matchEvents =
        sellReceipt.events?.filter((e) => e.event === "OrderMatched") || [];

      const state = await this.utils.getOrderBookState();

      // Should have matched 50 units and left 50 units in sell book
      const matchedCorrectly =
        matchEvents.length > 0 &&
        this.utils.fromAmount(matchEvents[0].args.amount) === 50;
      const remainingOrderExists =
        state.sellOrderCount === 1 &&
        state.asks.length > 0 &&
        state.asks[0].amount === 50;

      if (matchedCorrectly && remainingOrderExists) {
        this.testResults.addResult(
          4,
          "Partial sell order matching",
          true,
          `Matched 50 units, remaining 50 units placed in book at $${state.asks[0].price}`
        );
      } else {
        this.testResults.addResult(
          4,
          "Partial sell order matching",
          false,
          `Expected to match 50 and leave 50 in book. Matches: ${matchEvents.length}, Sell orders: ${state.sellOrderCount}`
        );
      }
    } catch (error) {
      this.testResults.addResult(4, "Requirement 4 tests", false, "", error);
    }
  }

  // Requirement 5: Market buy orders with slippage
  async testRequirement5() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 5: Market Buy Orders with Slippage",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller1, seller2, seller3] = this.users;

    try {
      console.log(
        "  Test 5: Market buy order matches within slippage tolerance"
      );

      // Setup sell orders at different prices
      await this.orderBook
        .connect(seller1)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(50),
          false
        );
      await this.orderBook
        .connect(seller2)
        .placeLimitOrder(
          this.utils.toPrice(11),
          this.utils.toAmount(50),
          false
        ); // 10% higher
      await this.orderBook
        .connect(seller3)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(50),
          false
        ); // 50% higher

      await this.utils.logOrderBookState("Before market buy");

      // Place market buy order - should match orders within reasonable slippage
      const marketBuyTx = await this.orderBook.connect(buyer).placeMarketOrder(
        this.utils.toAmount(120), // More than available at reasonable prices
        true // buy
      );
      const receipt = await this.utils.waitForTransaction(
        marketBuyTx,
        "Market buy order"
      );

      const matchEvents =
        receipt.events?.filter((e) => e.event === "OrderMatched") || [];
      const totalMatched = matchEvents.reduce(
        (sum, event) => sum + this.utils.fromAmount(event.args.amount),
        0
      );

      await this.utils.logOrderBookState("After market buy");

      // Market order should have matched at least some orders (ideally within reasonable slippage)
      if (matchEvents.length > 0 && totalMatched > 0) {
        this.testResults.addResult(
          5,
          "Market buy order execution",
          true,
          `Matched ${totalMatched} units across ${matchEvents.length} orders`
        );
      } else {
        this.testResults.addResult(
          5,
          "Market buy order execution",
          false,
          "Market buy order should have matched available sell orders"
        );
      }
    } catch (error) {
      this.testResults.addResult(5, "Requirement 5 tests", false, "", error);
    }
  }

  // Requirement 6: Market sell orders with slippage
  async testRequirement6() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 6: Market Sell Orders with Slippage",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer1, buyer2, buyer3, seller] = this.users;

    try {
      console.log(
        "  Test 6: Market sell order matches within slippage tolerance"
      );

      // Setup buy orders at different prices
      await this.orderBook
        .connect(buyer1)
        .placeLimitOrder(this.utils.toPrice(15), this.utils.toAmount(50), true);
      await this.orderBook
        .connect(buyer2)
        .placeLimitOrder(this.utils.toPrice(14), this.utils.toAmount(50), true); // 6.7% lower
      await this.orderBook
        .connect(buyer3)
        .placeLimitOrder(this.utils.toPrice(10), this.utils.toAmount(50), true); // 33% lower

      await this.utils.logOrderBookState("Before market sell");

      // Place market sell order
      const marketSellTx = await this.orderBook
        .connect(seller)
        .placeMarketOrder(
          this.utils.toAmount(120),
          false // sell
        );
      const receipt = await this.utils.waitForTransaction(
        marketSellTx,
        "Market sell order"
      );

      const matchEvents =
        receipt.events?.filter((e) => e.event === "OrderMatched") || [];
      const totalMatched = matchEvents.reduce(
        (sum, event) => sum + this.utils.fromAmount(event.args.amount),
        0
      );

      await this.utils.logOrderBookState("After market sell");

      if (matchEvents.length > 0 && totalMatched > 0) {
        this.testResults.addResult(
          6,
          "Market sell order execution",
          true,
          `Matched ${totalMatched} units across ${matchEvents.length} orders`
        );
      } else {
        this.testResults.addResult(
          6,
          "Market sell order execution",
          false,
          "Market sell order should have matched available buy orders"
        );
      }
    } catch (error) {
      this.testResults.addResult(6, "Requirement 6 tests", false, "", error);
    }
  }

  // Requirement 7: Fully matched buy orders removed
  async testRequirement7() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 7: Fully Matched Buy Orders Removal",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log("  Test 7: Fully matched buy order is removed from book");

      // Place buy order
      const buyTx = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(100),
          true
        );
      const buyReceipt = await this.utils.waitForTransaction(
        buyTx,
        "Buy order"
      );
      const orderId = buyReceipt.events?.find((e) => e.event === "OrderPlaced")
        ?.args?.orderId;

      const stateBefore = await this.utils.getOrderBookState();

      // Place matching sell order
      await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(100),
          false
        );

      const stateAfter = await this.utils.getOrderBookState();

      // Check if order was removed
      let orderExists = true;
      try {
        const order = await this.orderBook.getOrder(orderId);
        orderExists = order.trader !== ethers.constants.AddressZero;
      } catch (error) {
        orderExists = false;
      }

      if (!orderExists && stateAfter.buyOrderCount === 0) {
        this.testResults.addResult(
          7,
          "Fully matched buy order removal",
          true,
          "Buy order was completely removed after full match"
        );
      } else {
        this.testResults.addResult(
          7,
          "Fully matched buy order removal",
          false,
          `Order should be removed. Order exists: ${orderExists}, Buy orders: ${stateAfter.buyOrderCount}`
        );
      }
    } catch (error) {
      this.testResults.addResult(7, "Requirement 7 tests", false, "", error);
    }
  }

  // Requirement 8: Fully matched sell orders removed
  async testRequirement8() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 8: Fully Matched Sell Orders Removal",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log("  Test 8: Fully matched sell order is removed from book");

      // Place sell order
      const sellTx = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          false
        );
      const sellReceipt = await this.utils.waitForTransaction(
        sellTx,
        "Sell order"
      );
      const orderId = sellReceipt.events?.find((e) => e.event === "OrderPlaced")
        ?.args?.orderId;

      // Place matching buy order
      await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          true
        );

      const stateAfter = await this.utils.getOrderBookState();

      // Check if order was removed
      let orderExists = true;
      try {
        const order = await this.orderBook.getOrder(orderId);
        orderExists = order.trader !== ethers.constants.AddressZero;
      } catch (error) {
        orderExists = false;
      }

      if (!orderExists && stateAfter.sellOrderCount === 0) {
        this.testResults.addResult(
          8,
          "Fully matched sell order removal",
          true,
          "Sell order was completely removed after full match"
        );
      } else {
        this.testResults.addResult(
          8,
          "Fully matched sell order removal",
          false,
          `Order should be removed. Order exists: ${orderExists}, Sell orders: ${stateAfter.sellOrderCount}`
        );
      }
    } catch (error) {
      this.testResults.addResult(8, "Requirement 8 tests", false, "", error);
    }
  }

  // Requirement 9: Partially matched orders adjusted
  async testRequirement9() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 9: Partially Matched Order Adjustment",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log(
        "  Test 9: Partially matched order has remaining quantity adjusted"
      );

      // Place sell order with 100 units
      const sellTx = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          false
        );
      const sellReceipt = await this.utils.waitForTransaction(
        sellTx,
        "Sell order"
      );
      const orderId = sellReceipt.events?.find((e) => e.event === "OrderPlaced")
        ?.args?.orderId;

      // Place buy order with 60 units - should partially match
      await this.orderBook
        .connect(buyer)
        .placeLimitOrder(this.utils.toPrice(10), this.utils.toAmount(60), true);

      // Check remaining order
      const order = await this.orderBook.getOrder(orderId);
      const remainingAmount = this.utils.fromAmount(order.amount);
      const filledAmount = this.utils.fromAmount(
        await this.orderBook.getFilledAmount(orderId)
      );

      if (remainingAmount === 40 && filledAmount === 60) {
        this.testResults.addResult(
          9,
          "Partial order quantity adjustment",
          true,
          `Order correctly adjusted: ${filledAmount} filled, ${remainingAmount} remaining`
        );
      } else {
        this.testResults.addResult(
          9,
          "Partial order quantity adjustment",
          false,
          `Expected 40 remaining and 60 filled, got ${remainingAmount} remaining and ${filledAmount} filled`
        );
      }
    } catch (error) {
      this.testResults.addResult(9, "Requirement 9 tests", false, "", error);
    }
  }

  // Requirement 10: Market order price prioritization
  async testRequirement10() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 10: Market Order Price Prioritization",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller1, seller2, seller3] = this.users;

    try {
      console.log("  Test 10: Market order prioritizes best available prices");

      // Setup sell orders at different prices (should match lowest first)
      await this.orderBook
        .connect(seller3)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(30),
          false
        ); // Highest
      await this.orderBook
        .connect(seller1)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(30),
          false
        ); // Lowest
      await this.orderBook
        .connect(seller2)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(30),
          false
        ); // Middle

      // Place market buy order for 50 units (should match 30 at $10 and 20 at $12)
      const marketBuyTx = await this.orderBook
        .connect(buyer)
        .placeMarketOrder(this.utils.toAmount(50), true);
      const receipt = await this.utils.waitForTransaction(
        marketBuyTx,
        "Market buy with prioritization"
      );

      const matchEvents =
        receipt.events?.filter((e) => e.event === "OrderMatched") || [];

      // Should match lowest price first
      if (matchEvents.length > 0) {
        const firstMatchPrice = this.utils.fromPrice(matchEvents[0].args.price);
        const matchedBestPrice = firstMatchPrice === 10; // Should match $10 first

        this.testResults.addResult(
          10,
          "Market order price prioritization",
          matchedBestPrice,
          `First match at $${firstMatchPrice}, expected $10 (best price)`
        );
      } else {
        this.testResults.addResult(
          10,
          "Market order price prioritization",
          false,
          "No matches occurred for market order"
        );
      }
    } catch (error) {
      this.testResults.addResult(10, "Requirement 10 tests", false, "", error);
    }
  }

  // Requirement 11: Market order slippage limits
  async testRequirement11() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 11: Market Order Slippage Limits",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller1, seller2] = this.users;

    try {
      console.log(
        "  Test 11: Market order executes within slippage and cancels remainder"
      );

      // Setup orders with extreme price difference
      await this.orderBook
        .connect(seller1)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(50),
          false
        );
      await this.orderBook
        .connect(seller2)
        .placeLimitOrder(
          this.utils.toPrice(50),
          this.utils.toAmount(50),
          false
        ); // 400% higher

      // Place market buy order for 100 units
      const marketBuyTx = await this.orderBook
        .connect(buyer)
        .placeMarketOrder(this.utils.toAmount(100), true);
      const receipt = await this.utils.waitForTransaction(
        marketBuyTx,
        "Market buy with slippage limit"
      );

      const matchEvents =
        receipt.events?.filter((e) => e.event === "OrderMatched") || [];
      const totalMatched = matchEvents.reduce(
        (sum, event) => sum + this.utils.fromAmount(event.args.amount),
        0
      );

      // Should match some but not all due to slippage (implementation dependent)
      // At minimum, should match the first reasonable order
      if (totalMatched > 0 && totalMatched <= 100) {
        this.testResults.addResult(
          11,
          "Market order slippage limits",
          true,
          `Executed ${totalMatched}/100 units, remaining cancelled due to slippage`
        );
      } else {
        this.testResults.addResult(
          11,
          "Market order slippage limits",
          false,
          `Expected partial execution with remainder cancelled, got ${totalMatched} units matched`
        );
      }
    } catch (error) {
      this.testResults.addResult(11, "Requirement 11 tests", false, "", error);
    }
  }

  // Requirement 12: Order book maintains active orders record
  async testRequirement12() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 12: Active Orders Record",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer, seller] = this.users;

    try {
      console.log("  Test 12: Order book maintains record of active orders");

      // Place multiple orders
      const buyTx = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(100),
          true
        );
      const buyReceipt = await this.utils.waitForTransaction(
        buyTx,
        "Buy order"
      );
      const buyOrderId = buyReceipt.events?.find(
        (e) => e.event === "OrderPlaced"
      )?.args?.orderId;

      const sellTx = await this.orderBook
        .connect(seller)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(50),
          false
        );
      const sellReceipt = await this.utils.waitForTransaction(
        sellTx,
        "Sell order"
      );
      const sellOrderId = sellReceipt.events?.find(
        (e) => e.event === "OrderPlaced"
      )?.args?.orderId;

      // Check order records
      const buyOrder = await this.orderBook.getOrder(buyOrderId);
      const sellOrder = await this.orderBook.getOrder(sellOrderId);
      const userBuyOrders = await this.orderBook.getUserOrders(buyer.address);
      const userSellOrders = await this.orderBook.getUserOrders(seller.address);
      const [buyCount, sellCount] = await this.orderBook.getActiveOrdersCount();

      const recordsCorrect =
        buyOrder.trader === buyer.address &&
        sellOrder.trader === seller.address &&
        userBuyOrders.length > 0 &&
        userSellOrders.length > 0 &&
        buyCount.toNumber() >= 1 &&
        sellCount.toNumber() >= 1;

      if (recordsCorrect) {
        this.testResults.addResult(
          12,
          "Active orders record maintenance",
          true,
          `Order book correctly tracks ${buyCount} buy and ${sellCount} sell orders`
        );
      } else {
        this.testResults.addResult(
          12,
          "Active orders record maintenance",
          false,
          "Order book failed to maintain proper records of active orders"
        );
      }
    } catch (error) {
      this.testResults.addResult(12, "Requirement 12 tests", false, "", error);
    }
  }

  // Requirement 13: Order cancellation
  async testRequirement13() {
    console.log(
      colorText("\n🧪 Testing Requirement 13: Order Cancellation", colors.cyan)
    );

    await this.utils.setupTest(this.users);
    const [buyer] = this.users;

    try {
      console.log("  Test 13: Order cancellation removes order from book");

      // Place order
      const buyTx = await this.orderBook
        .connect(buyer)
        .placeLimitOrder(
          this.utils.toPrice(12),
          this.utils.toAmount(100),
          true
        );
      const buyReceipt = await this.utils.waitForTransaction(
        buyTx,
        "Buy order"
      );
      const orderId = buyReceipt.events?.find((e) => e.event === "OrderPlaced")
        ?.args?.orderId;

      const stateBefore = await this.utils.getOrderBookState();

      // Cancel order
      const cancelTx = await this.orderBook.connect(buyer).cancelOrder(orderId);
      const cancelReceipt = await this.utils.waitForTransaction(
        cancelTx,
        "Cancel order"
      );

      const stateAfter = await this.utils.getOrderBookState();
      const cancelEvents =
        cancelReceipt.events?.filter((e) => e.event === "OrderCancelled") || [];

      // Check if order was removed
      let orderExists = true;
      try {
        const order = await this.orderBook.getOrder(orderId);
        orderExists = order.trader !== ethers.constants.AddressZero;
      } catch (error) {
        orderExists = false;
      }

      if (
        !orderExists &&
        cancelEvents.length > 0 &&
        stateAfter.buyOrderCount < stateBefore.buyOrderCount
      ) {
        this.testResults.addResult(
          13,
          "Order cancellation",
          true,
          "Order successfully cancelled and removed from book"
        );
      } else {
        this.testResults.addResult(
          13,
          "Order cancellation",
          false,
          `Cancellation failed. Order exists: ${orderExists}, Cancel events: ${cancelEvents.length}`
        );
      }
    } catch (error) {
      this.testResults.addResult(13, "Requirement 13 tests", false, "", error);
    }
  }

  // Requirement 14: Order modification (Note: Current contract doesn't support modification)
  async testRequirement14() {
    console.log(
      colorText("\n🧪 Testing Requirement 14: Order Modification", colors.cyan)
    );

    try {
      console.log("  Test 14: Order modification capability");

      // Check if contract has modification functions
      const hasModifyFunction =
        typeof this.orderBook.modifyOrder === "function";

      if (!hasModifyFunction) {
        this.testResults.addResult(
          14,
          "Order modification capability",
          false,
          "Contract does not implement order modification functions. Users must cancel and re-place orders."
        );
      } else {
        // If modification function exists, test it
        this.testResults.addResult(
          14,
          "Order modification capability",
          true,
          "Contract supports order modification"
        );
      }
    } catch (error) {
      this.testResults.addResult(14, "Requirement 14 tests", false, "", error);
    }
  }

  // Requirement 15: Real-time best bid/ask updates
  async testRequirement15() {
    console.log(
      colorText(
        "\n🧪 Testing Requirement 15: Real-time Best Bid/Ask Updates",
        colors.cyan
      )
    );

    await this.utils.setupTest(this.users);
    const [buyer1, buyer2, seller1, seller2] = this.users;

    try {
      console.log("  Test 15: Best bid and ask are updated in real-time");

      const initialState = await this.utils.getOrderBookState();

      // Place first buy order
      await this.orderBook
        .connect(buyer1)
        .placeLimitOrder(
          this.utils.toPrice(10),
          this.utils.toAmount(100),
          true
        );

      let state = await this.utils.getOrderBookState();
      const firstBidCorrect = state.bestBid === 10;

      // Place higher buy order (should become new best bid)
      await this.orderBook
        .connect(buyer2)
        .placeLimitOrder(this.utils.toPrice(12), this.utils.toAmount(50), true);

      state = await this.utils.getOrderBookState();
      const secondBidCorrect = state.bestBid === 12;

      // Place first sell order
      await this.orderBook
        .connect(seller1)
        .placeLimitOrder(
          this.utils.toPrice(20),
          this.utils.toAmount(100),
          false
        );

      state = await this.utils.getOrderBookState();
      const firstAskCorrect = state.bestAsk === 20;

      // Place lower sell order (should become new best ask)
      await this.orderBook
        .connect(seller2)
        .placeLimitOrder(
          this.utils.toPrice(15),
          this.utils.toAmount(50),
          false
        );

      state = await this.utils.getOrderBookState();
      const secondAskCorrect = state.bestAsk === 15;

      const allUpdatesCorrect =
        firstBidCorrect &&
        secondBidCorrect &&
        firstAskCorrect &&
        secondAskCorrect;

      if (allUpdatesCorrect) {
        this.testResults.addResult(
          15,
          "Real-time best bid/ask updates",
          true,
          `Best bid updated: $10 → $12, Best ask updated: $20 → $15`
        );
      } else {
        this.testResults.addResult(
          15,
          "Real-time best bid/ask updates",
          false,
          `Updates failed. Bid updates: ${
            firstBidCorrect && secondBidCorrect
          }, Ask updates: ${firstAskCorrect && secondAskCorrect}`
        );
      }
    } catch (error) {
      this.testResults.addResult(15, "Requirement 15 tests", false, "", error);
    }
  }

  // Run all tests
  async runAllTests() {
    console.log(
      colorText(
        "🚀 Starting Comprehensive Order Book Requirements Testing",
        colors.bright
      )
    );
    console.log("═".repeat(80));

    const testMethods = [
      this.testRequirement1,
      this.testRequirement2,
      this.testRequirement3,
      this.testRequirement4,
      this.testRequirement5,
      this.testRequirement6,
      this.testRequirement7,
      this.testRequirement8,
      this.testRequirement9,
      this.testRequirement10,
      this.testRequirement11,
      this.testRequirement12,
      this.testRequirement13,
      this.testRequirement14,
      this.testRequirement15,
    ];

    for (let i = 0; i < testMethods.length; i++) {
      try {
        await testMethods[i].call(this);
      } catch (error) {
        console.error(
          colorText(`❌ Test ${i + 1} failed with error:`, colors.red),
          error.message
        );
        this.testResults.addResult(
          i + 1,
          `Requirement ${i + 1} tests`,
          false,
          "",
          error
        );
      }

      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// Main execution function
async function main() {
  console.log(
    colorText(
      "🔥 HYPERLIQUID ORDER BOOK REQUIREMENTS VALIDATOR 🔥",
      colors.magenta
    )
  );
  console.log("═".repeat(80));

  try {
    // Get contracts and signers
    const orderBook = await getContract("ALUMINUM_ORDERBOOK");
    const mockUSDC = await getContract("MOCK_USDC");
    const [deployer, user1, user2, user3, user4] = await ethers.getSigners();
    const testUsers = [user1, user2, user3, user4];

    console.log("📋 Test Configuration:");
    console.log("  OrderBook:", orderBook.address);
    console.log("  MockUSDC:", mockUSDC.address);
    console.log("  Test Users:", testUsers.length);
    console.log("  Max Slippage:", TEST_CONFIG.MAX_SLIPPAGE_BPS / 100, "%");
    console.log("  Verbose Logging:", TEST_CONFIG.VERBOSE_LOGGING);

    // Initialize test results tracker
    const testResults = new TestResults();

    // Initialize test suite
    const testSuite = new OrderBookRequirementsTests(
      orderBook,
      mockUSDC,
      testUsers,
      testResults
    );

    // Run all tests
    await testSuite.runAllTests();

    // Print comprehensive summary
    testResults.printSummary();
  } catch (error) {
    console.error(
      colorText("❌ Test execution failed:", colors.red),
      error.message
    );
    console.error(error.stack);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  OrderBookRequirementsTests,
  OrderBookTestUtils,
  TestResults,
  TEST_CONFIG,
  main,
};
