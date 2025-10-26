// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICoreVault.sol";

library OrderBookStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("hyperliquid.orderbook.storage.v1");

    struct Order { uint256 orderId; address trader; uint256 price; uint256 amount; bool isBuy; uint256 timestamp; uint256 nextOrderId; uint256 marginRequired; bool isMarginOrder; }
    struct PriceLevel { uint256 totalAmount; uint256 firstOrderId; uint256 lastOrderId; bool exists; }
struct Trade { uint256 tradeId; address buyer; address seller; uint256 price; uint256 amount; uint256 timestamp; uint256 buyOrderId; uint256 sellOrderId; bool buyerIsMargin; bool sellerIsMargin; uint256 tradeValue; uint256 buyerFee; uint256 sellerFee; }

    struct State {
        // Core integration
        ICoreVault vault;
        bytes32 marketId;
        address feeRecipient;
        address leverageController;
        uint256 marginRequirementBps;
        uint256 tradingFee;
        bool leverageEnabled;
        uint256 maxLeverage;
        uint256 maxSlippageBps;
        // Unit-based margin parameters (USDC 6 decimals per 1e18 units)
        uint256 unitMarginLong6;   // e.g., 1_000_000
        uint256 unitMarginShort6;  // e.g., 1_500_000
        // Order book state
        mapping(uint256 => OrderBookStorage.Order) orders;
        mapping(uint256 => OrderBookStorage.PriceLevel) buyLevels;
        mapping(uint256 => OrderBookStorage.PriceLevel) sellLevels;
        mapping(address => uint256[]) userOrders;
        uint256 nextOrderId;
        uint256 bestBid;
        uint256 bestAsk;
        uint256[] buyPrices;
        uint256[] sellPrices;
        mapping(uint256 => bool) buyPriceExists;
        mapping(uint256 => bool) sellPriceExists;
        // Accounting
        mapping(uint256 => uint256) filledAmounts;
        mapping(uint256 => uint256) cumulativeMarginUsed;
        uint256 lastTradePrice;
        uint256 lastMarkPrice;
        bool useVWAPForMarkPrice;
        uint256 vwapTimeWindow;
        uint256 minVolumeForVWAP;
        // Trades
        mapping(uint256 => Trade) trades;
        uint256 nextTradeId;
        uint256 totalTradeCount;
        mapping(address => uint256[]) userTradeIds;
        // User tracking
        address[] allKnownUsers;
        mapping(address => bool) isKnownUser;
        // Liquidation settings and state
        bool liquidationScanOnTrade;
        bool liquidationDebug;
        uint256 lastLiquidationCheck;
        uint256 lastCheckedIndex;
        // Recursion guards & modes
        bool liquidationInProgress;
        bool liquidationMode;
        bool pendingLiquidationRescan;
        address liquidationTarget;
        bool liquidationClosesShort;
        // Maker rewards tracking
        address[] liquidationMakers;
        uint256[] liquidationMakerNotionalScaled;
        uint256 liquidationTotalNotionalScaled;
        bool liquidationTrackingActive;
        uint256 liquidationRewardedRecipients;
        address liquidationLastRewardRecipient;
        // Execution tracking for liquidation
        uint256 liquidationExecutionTotalVolume;
        uint256 liquidationExecutionTotalValue;
        uint256 liquidationWorstPrice;
        uint256 liquidationExecutionCount;
        // Simple reentrancy guard for external calls from facets
        bool nonReentrantLock;
        // Last 20 trades ring buffer (trade IDs)
        uint256[20] lastTwentyTradeIds;
        uint8 lastTwentyIndex; // next write position
        uint8 lastTwentyCount; // number of valid entries (max 20)
    }

    function state() internal pure returns (State storage s) {
        bytes32 slot = STORAGE_SLOT;
        assembly { s.slot := slot }
    }
}


