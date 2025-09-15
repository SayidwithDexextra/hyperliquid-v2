const { ethers } = require("hardhat");

/**
 * OrderBook Filler - Generates natural-looking order book with both bids and asks
 *
 * This script creates a realistic order book by placing limit orders on both sides
 * of the market using multiple users (Deployer, User1, User2) with natural price
 * distribution and amount variance.
 *
 * Features:
 * - Generates both BID and ASK orders
 * - Uses multiple users for realistic distribution
 * - Natural price spacing with randomness
 * - Variable order amounts with realistic variance
 * - Adapts to existing market prices or uses configured base price
 *
 * Usage:
 *   npx hardhat run OrderBookFiller.js --network localhost
 *
 * Configuration:
 *   - BASE_PRICE: Starting price point ($1.00)
 *   - ORDER_COUNT_PER_SIDE: Number of orders per side (8)
 *   - PRICE_STEP_PERCENTAGE: Price increment between orders (2%)
 *   - AMOUNT_VARIANCE: Random variance in order amounts (±30%)
 *   - USERS_TO_USE: Which users to place orders (Deployer, User1, User2)
 */

// Contract ABI for OrderBook
const ORDERBOOK_ABI = [
  "function getOrderBookDepth(uint256 levels) external view returns (uint256[] memory bidPrices, uint256[] memory bidAmounts, uint256[] memory askPrices, uint256[] memory askAmounts)",
  "function placeLimitOrder(uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId)",
  "function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId)",
  "function bestBid() external view returns (uint256)",
  "function bestAsk() external view returns (uint256)",
  "function getMarketData() external view returns (uint256 midPrice, uint256 spread, uint256 bestBidPrice, uint256 bestAskPrice, uint256 totalBidLiquidity, uint256 totalAskLiquidity)",
  "function getOrderBookSummary() external view returns (uint256 bestBid, uint256 bestAsk)",
  "event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp)",
  "event DebugMarginCalculation(uint256 amount, uint256 price, bool isBuy, uint256 marginRequired)",
];

// Configuration
const CONFIG = {
  // Contract addresses from deployment
  ORDERBOOK_ADDRESS: "0x63AA51e2808bE96eD022B07836AD5fA097806F29",

  // Liquidity parameters
  PRICE_SPREAD_PERCENTAGE: 10, // 10% spread around existing orders
  MIN_AMOUNT: ethers.parseEther("1"), // Minimum 1 unit per order
  MAX_AMOUNT: ethers.parseEther("10"), // Maximum 10 units per order

  // Number of levels to analyze and fill
  LEVELS_TO_ANALYZE: 5,

  // Price increments (in basis points, 100 = 1%)
  BID_PRICE_INCREMENT_BPS: 100, // 1% increments for bids
  ASK_PRICE_DECREMENT_BPS: 100, // 1% increments for asks

  // Enable margin orders (requires sufficient collateral)
  USE_MARGIN_ORDERS: true,

  // Network configuration
  NETWORK: "localhost",
  RPC_URL: "http://127.0.0.1:8545",

  // Display configuration
  SHOW_DETAILED_LOGS: true,
  MAX_ORDERS_PER_SIDE: 10, // Maximum number of orders to place per side

  // Enhanced configuration for natural order book
  BASE_PRICE: ethers.parseUnits("1", 6), // $1.00 base price
  PRICE_RANGE_PERCENTAGE: 20, // 20% range around base price
  ORDER_COUNT_PER_SIDE: 8, // Number of orders per side
  PRICE_STEP_PERCENTAGE: 2, // 2% steps between orders
  AMOUNT_VARIANCE: 0.3, // 30% variance in amounts
  USERS_TO_USE: [0, 1, 2], // Deployer, User1, User2 (exclude User3)
};

class OrderBookFiller {
  constructor() {
    this.orderBook = null;
    this.signer = null;
    this.deployedContracts = null;
    this.users = [];
  }

  /**
   * Generate a random number between min and max
   */
  randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Generate a random integer between min and max (inclusive)
   */
  randomIntBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate natural-looking order amounts with variance
   */
  generateOrderAmount(baseAmount) {
    const variance = this.randomBetween(
      1 - CONFIG.AMOUNT_VARIANCE,
      1 + CONFIG.AMOUNT_VARIANCE
    );
    const amount = BigInt(Math.floor(Number(baseAmount) * variance));

    // Ensure amount is within bounds and positive
    if (amount < CONFIG.MIN_AMOUNT) {
      return CONFIG.MIN_AMOUNT;
    } else if (amount > CONFIG.MAX_AMOUNT) {
      return CONFIG.MAX_AMOUNT;
    } else if (amount <= 0n) {
      return CONFIG.MIN_AMOUNT;
    }

    return amount;
  }

  /**
   * Generate price levels for bids (below base price)
   */
  generateBidPrices(basePrice) {
    const prices = [];
    const basePriceNum = Number(basePrice);
    const stepPercentage = CONFIG.PRICE_STEP_PERCENTAGE / 100;

    for (let i = 1; i <= CONFIG.ORDER_COUNT_PER_SIDE; i++) {
      // Start below base price and go lower
      const priceReduction = stepPercentage * i;
      const price = basePriceNum * (1 - priceReduction);

      // Add some randomness to make it more natural
      const randomVariance = this.randomBetween(0.95, 1.05);
      const finalPrice = Math.floor(price * randomVariance);

      prices.push(BigInt(Math.max(1, finalPrice))); // Ensure price is at least 1
    }

    return prices.sort((a, b) => Number(b) - Number(a)); // Sort descending (highest first)
  }

  /**
   * Generate price levels for asks (above base price)
   */
  generateAskPrices(basePrice) {
    const prices = [];
    const basePriceNum = Number(basePrice);
    const stepPercentage = CONFIG.PRICE_STEP_PERCENTAGE / 100;

    for (let i = 1; i <= CONFIG.ORDER_COUNT_PER_SIDE; i++) {
      // Start above base price and go higher
      const priceIncrease = stepPercentage * i;
      const price = basePriceNum * (1 + priceIncrease);

      // Add some randomness to make it more natural
      const randomVariance = this.randomBetween(0.95, 1.05);
      const finalPrice = Math.floor(price * randomVariance);

      prices.push(BigInt(Math.max(1, finalPrice))); // Ensure price is at least 1
    }

    return prices.sort((a, b) => Number(a) - Number(b)); // Sort ascending (lowest first)
  }

  /**
   * Get a random user from the configured users
   */
  getRandomUser() {
    const randomIndex = this.randomIntBetween(
      0,
      CONFIG.USERS_TO_USE.length - 1
    );
    const userIndex = CONFIG.USERS_TO_USE[randomIndex];
    return this.users[userIndex];
  }

  async initialize() {
    console.log("🚀 Initializing OrderBook Filler...");

    try {
      // Get all signers
      const signers = await ethers.getSigners();
      this.users = signers;
      this.signer = signers[0]; // Deployer as primary signer

      console.log(`📝 Loaded ${this.users.length} users:`);
      for (let i = 0; i < this.users.length; i++) {
        const userName = i === 0 ? "Deployer" : `User ${i}`;
        console.log(`   ${userName}: ${this.users[i].address}`);
      }

      // Load deployment configuration
      this.deployedContracts = require("./deployments/localhost-deployment.json");
      console.log(
        `📋 Loaded deployment config for ${this.deployedContracts.network}`
      );

      // Connect to OrderBook contract
      this.orderBook = new ethers.Contract(
        CONFIG.ORDERBOOK_ADDRESS,
        ORDERBOOK_ABI,
        this.signer
      );

      console.log(`🔗 Connected to OrderBook at: ${CONFIG.ORDERBOOK_ADDRESS}`);

      // Verify connection
      const bestBid = await this.orderBook.bestBid();
      const bestAsk = await this.orderBook.bestAsk();
      console.log(
        `📊 Current market state - Best Bid: ${ethers.formatEther(
          bestBid
        )}, Best Ask: ${ethers.formatEther(bestAsk)}`
      );
    } catch (error) {
      console.error("❌ Failed to initialize:", error.message);
      throw error;
    }
  }

  /**
   * Get current orderbook state
   */
  async getCurrentOrderBookState() {
    console.log("\n📊 Analyzing current OrderBook state...");

    try {
      const [bidPrices, bidAmounts, askPrices, askAmounts] =
        await this.orderBook.getOrderBookDepth(CONFIG.LEVELS_TO_ANALYZE);

      const state = {
        bids: [],
        asks: [],
        bestBid: await this.orderBook.bestBid(),
        bestAsk: await this.orderBook.bestAsk(),
      };

      // Process bids (buy orders)
      for (let i = 0; i < bidPrices.length; i++) {
        if (bidPrices[i] > 0) {
          state.bids.push({
            price: bidPrices[i],
            amount: bidAmounts[i],
            priceFormatted: ethers.formatEther(bidPrices[i]),
            amountFormatted: ethers.formatEther(bidAmounts[i]),
          });
        }
      }

      // Process asks (sell orders)
      for (let i = 0; i < askPrices.length; i++) {
        if (askPrices[i] < ethers.MaxUint256) {
          state.asks.push({
            price: askPrices[i],
            amount: askAmounts[i],
            priceFormatted: ethers.formatEther(askPrices[i]),
            amountFormatted: ethers.formatEther(askAmounts[i]),
          });
        }
      }

      console.log(
        `📈 Found ${state.bids.length} bid levels and ${state.asks.length} ask levels`
      );

      return state;
    } catch (error) {
      console.error("❌ Failed to get orderbook state:", error.message);
      throw error;
    }
  }

  /**
   * Calculate surrounding prices for liquidity placement
   */
  calculateSurroundingPrices(existingPrice, isBid) {
    const price = BigInt(existingPrice);
    const spreadBps = BigInt(CONFIG.PRICE_SPREAD_PERCENTAGE * 100); // Convert to basis points

    if (isBid) {
      // For bids, create orders above the existing price
      const increment = (price * spreadBps) / BigInt(10000);
      return {
        price: price + increment,
        priceFormatted: ethers.formatEther(price + increment),
      };
    } else {
      // For asks, create orders below the existing price
      const decrement = (price * spreadBps) / BigInt(10000);
      return {
        price: price - decrement,
        priceFormatted: ethers.formatEther(price - decrement),
      };
    }
  }

  /**
   * Calculate order amount based on existing order
   */
  calculateOrderAmount(existingAmount) {
    // Use the same amount as the existing order, but within min/max bounds
    let amount = BigInt(existingAmount);

    if (amount < CONFIG.MIN_AMOUNT) {
      amount = CONFIG.MIN_AMOUNT;
    } else if (amount > CONFIG.MAX_AMOUNT) {
      amount = CONFIG.MAX_AMOUNT;
    }

    return amount;
  }

  /**
   * Place a single limit order
   */
  async placeOrder(price, amount, isBuy) {
    try {
      console.log(
        `📝 Placing ${isBuy ? "BID" : "ASK"} order: ${ethers.formatEther(
          price
        )} @ ${ethers.formatEther(amount)}`
      );

      let tx;
      if (CONFIG.USE_MARGIN_ORDERS) {
        tx = await this.orderBook.placeMarginLimitOrder(price, amount, isBuy);
      } else {
        tx = await this.orderBook.placeLimitOrder(price, amount, isBuy);
      }

      const receipt = await tx.wait();
      console.log(`✅ Order placed successfully! Gas used: ${receipt.gasUsed}`);

      // Find the OrderPlaced event
      const orderPlacedEvent = receipt.logs.find((log) => {
        try {
          const parsed = this.orderBook.interface.parseLog(log);
          return parsed.name === "OrderPlaced";
        } catch (e) {
          return false;
        }
      });

      if (orderPlacedEvent) {
        const parsed = this.orderBook.interface.parseLog(orderPlacedEvent);
        console.log(`🆔 Order ID: ${parsed.args.orderId}`);
        return parsed.args.orderId;
      } else {
        // If no event found, try to get order ID from transaction
        console.log(`🆔 Order placed in transaction: ${tx.hash}`);
        return tx.hash; // Use transaction hash as fallback
      }
    } catch (error) {
      console.error(`❌ Failed to place order:`, error.message);
      throw error;
    }
  }

  /**
   * Place a single limit order with a specific user
   */
  async placeOrderWithUser(price, amount, isBuy, user) {
    try {
      let tx;
      if (CONFIG.USE_MARGIN_ORDERS) {
        tx = await this.orderBook
          .connect(user)
          .placeMarginLimitOrder(price, amount, isBuy);
      } else {
        tx = await this.orderBook
          .connect(user)
          .placeLimitOrder(price, amount, isBuy);
      }

      const receipt = await tx.wait();

      // Find the OrderPlaced event
      const orderPlacedEvent = receipt.logs.find((log) => {
        try {
          const parsed = this.orderBook.interface.parseLog(log);
          return parsed.name === "OrderPlaced";
        } catch (e) {
          return false;
        }
      });

      if (orderPlacedEvent) {
        const parsed = this.orderBook.interface.parseLog(orderPlacedEvent);
        return parsed.args.orderId;
      } else {
        return tx.hash; // Use transaction hash as fallback
      }
    } catch (error) {
      console.error(`❌ Failed to place order:`, error.message);
      throw error;
    }
  }

  /**
   * Generate a natural-looking order book with both bids and asks
   */
  async fillLiquidity() {
    console.log("\n🎯 Starting natural order book generation...");

    try {
      // Get current state to determine base price
      const state = await this.getCurrentOrderBookState();

      // Determine base price - use existing orders if available, otherwise use config
      let basePrice = CONFIG.BASE_PRICE;
      if (state.bids.length > 0 || state.asks.length > 0) {
        // Calculate mid price from existing orders
        const allPrices = [
          ...state.bids.map((b) => b.price),
          ...state.asks.map((a) => a.price),
        ];
        const avgPrice =
          allPrices.reduce((sum, price) => sum + Number(price), 0) /
          allPrices.length;
        basePrice = BigInt(Math.floor(avgPrice));
        console.log(
          `📊 Using existing market price as base: ${ethers.formatEther(
            basePrice
          )}`
        );
      } else {
        console.log(
          `📊 Using configured base price: ${ethers.formatEther(basePrice)}`
        );
      }

      const placedOrders = [];

      // Generate bid prices (below base price)
      console.log("\n📈 Generating BID orders...");
      const bidPrices = this.generateBidPrices(basePrice);

      for (let i = 0; i < bidPrices.length; i++) {
        const price = bidPrices[i];
        const amount = this.generateOrderAmount(CONFIG.MIN_AMOUNT);
        const user = this.getRandomUser();
        const userName =
          this.users.indexOf(user) === 0
            ? "Deployer"
            : `User ${this.users.indexOf(user)}`;

        console.log(
          `   ${userName}: BID ${ethers.formatEther(
            amount
          )} @ ${ethers.formatEther(price)}`
        );

        try {
          const orderId = await this.placeOrderWithUser(
            price,
            amount,
            true,
            user
          );
          if (orderId) {
            placedOrders.push({
              orderId: orderId.toString(),
              type: "BID",
              price: ethers.formatEther(price),
              amount: ethers.formatEther(amount),
              user: userName,
            });
          }
        } catch (error) {
          console.error(`   ❌ Failed to place bid: ${error.message}`);
        }
      }

      // Generate ask prices (above base price)
      console.log("\n📉 Generating ASK orders...");
      const askPrices = this.generateAskPrices(basePrice);

      for (let i = 0; i < askPrices.length; i++) {
        const price = askPrices[i];
        const amount = this.generateOrderAmount(CONFIG.MIN_AMOUNT);
        const user = this.getRandomUser();
        const userName =
          this.users.indexOf(user) === 0
            ? "Deployer"
            : `User ${this.users.indexOf(user)}`;

        console.log(
          `   ${userName}: ASK ${ethers.formatEther(
            amount
          )} @ ${ethers.formatEther(price)}`
        );

        try {
          const orderId = await this.placeOrderWithUser(
            price,
            amount,
            false,
            user
          );
          if (orderId) {
            placedOrders.push({
              orderId: orderId.toString(),
              type: "ASK",
              price: ethers.formatEther(price),
              amount: ethers.formatEther(amount),
              user: userName,
            });
          }
        } catch (error) {
          console.error(`   ❌ Failed to place ask: ${error.message}`);
        }
      }

      // Summary
      console.log("\n📊 Order Book Generation Summary:");
      console.log(`✅ Successfully placed ${placedOrders.length} orders`);

      // Group orders by user for summary
      const ordersByUser = {};
      placedOrders.forEach((order) => {
        if (!ordersByUser[order.user]) {
          ordersByUser[order.user] = { bids: 0, asks: 0 };
        }
        if (order.type === "BID") {
          ordersByUser[order.user].bids++;
        } else {
          ordersByUser[order.user].asks++;
        }
      });

      console.log("\n📋 Orders by User:");
      Object.entries(ordersByUser).forEach(([user, counts]) => {
        console.log(`   ${user}: ${counts.bids} bids, ${counts.asks} asks`);
      });

      return placedOrders;
    } catch (error) {
      console.error("❌ Failed to generate order book:", error.message);
      throw error;
    }
  }

  /**
   * Display current market summary
   */
  async displayMarketSummary() {
    try {
      console.log("\n📊 Current Market Summary:");

      const state = await this.getCurrentOrderBookState();

      console.log(
        `   Best Bid: ${
          state.bestBid > 0 ? ethers.formatEther(state.bestBid) : "None"
        }`
      );
      console.log(
        `   Best Ask: ${
          state.bestAsk < ethers.MaxUint256
            ? ethers.formatEther(state.bestAsk)
            : "None"
        }`
      );

      if (state.bestBid > 0 && state.bestAsk < ethers.MaxUint256) {
        const spread = state.bestAsk - state.bestBid;
        const midPrice = (state.bestBid + state.bestAsk) / BigInt(2);
        console.log(`   Mid Price: ${ethers.formatEther(midPrice)}`);
        console.log(`   Spread: ${ethers.formatEther(spread)}`);
      }

      console.log(`   Bid Levels: ${state.bids.length}`);
      console.log(`   Ask Levels: ${state.asks.length}`);
    } catch (error) {
      console.error("❌ Failed to display market summary:", error.message);
    }
  }

  /**
   * Display current configuration
   */
  displayConfiguration() {
    console.log("\n⚙️  Configuration:");
    console.log(`   Base Price: ${ethers.formatEther(CONFIG.BASE_PRICE)}`);
    console.log(`   Price Range: ±${CONFIG.PRICE_RANGE_PERCENTAGE}%`);
    console.log(`   Orders per Side: ${CONFIG.ORDER_COUNT_PER_SIDE}`);
    console.log(`   Price Step: ${CONFIG.PRICE_STEP_PERCENTAGE}%`);
    console.log(`   Amount Variance: ±${CONFIG.AMOUNT_VARIANCE * 100}%`);
    console.log(`   Min Amount: ${ethers.formatEther(CONFIG.MIN_AMOUNT)}`);
    console.log(`   Max Amount: ${ethers.formatEther(CONFIG.MAX_AMOUNT)}`);
    console.log(`   Use Margin Orders: ${CONFIG.USE_MARGIN_ORDERS}`);
    console.log(`   Users: Deployer, User1, User2 (excluding User3)`);
  }

  /**
   * Run the complete filling process
   */
  async run() {
    try {
      console.log("🎯 OrderBook Filler Starting...");
      console.log("=".repeat(50));

      this.displayConfiguration();
      await this.initialize();
      await this.displayMarketSummary();
      await this.fillLiquidity();

      console.log("\n🎉 OrderBook filling completed successfully!");
    } catch (error) {
      console.error("💥 OrderBook filling failed:", error.message);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const filler = new OrderBookFiller();
  await filler.run();
}

// Export for use as module
module.exports = { OrderBookFiller, CONFIG };

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
}
