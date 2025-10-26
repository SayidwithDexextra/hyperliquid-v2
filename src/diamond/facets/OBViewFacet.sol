// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/OrderBookStorage.sol";

contract OBViewFacet {
    using OrderBookStorage for OrderBookStorage.State;

    function getTradingParameters() external view returns (uint256 marginRequirement, uint256 fee, address recipient) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return (s.marginRequirementBps, s.tradingFee, s.feeRecipient);
    }

    function getLeverageInfo() external view returns (bool enabled, uint256 maxLev, uint256 marginReq, address controller) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return (s.leverageEnabled, s.leverageEnabled ? (s.maxLeverage == 0 ? 10 : s.maxLeverage) : 1, s.marginRequirementBps, s.leverageController);
    }

    function marketStatic() external view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return (address(s.vault), s.marketId, s.useVWAPForMarkPrice, s.vwapTimeWindow);
    }

    // Compatibility getters (mirror public variables in original)
    function bestBid() external view returns (uint256) { return OrderBookStorage.state().bestBid; }
    function bestAsk() external view returns (uint256) { return OrderBookStorage.state().bestAsk; }
    function lastTradePrice() external view returns (uint256) { return OrderBookStorage.state().lastTradePrice; }
    function maxSlippageBps() external view returns (uint256) { return OrderBookStorage.state().maxSlippageBps; }
    function getMaxSlippageBps() external view returns (uint256) { return OrderBookStorage.state().maxSlippageBps; }
    function getFilledAmount(uint256 orderId) external view returns (uint256) { return OrderBookStorage.state().filledAmounts[orderId]; }
    function getUserOrders(address user) external view returns (uint256[] memory orderIds) { return OrderBookStorage.state().userOrders[user]; }

    // Added views for interactive tooling compatibility
    function getOrder(uint256 orderId) external view returns (OrderBookStorage.Order memory order) {
        return OrderBookStorage.state().orders[orderId];
    }

    function getUserPosition(address user) external view returns (int256) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        (int256 size,,) = s.vault.getPositionSummary(user, s.marketId);
        return size;
    }

    function getActiveOrdersCount() external view returns (uint256 buyCount, uint256 sellCount) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 b = 0; for (uint256 i = 0; i < s.buyPrices.length; i++) { uint256 p = s.buyPrices[i]; OrderBookStorage.PriceLevel storage lvl = s.buyLevels[p]; if (lvl.exists && lvl.firstOrderId != 0) { b++; } }
        uint256 a = 0; for (uint256 j = 0; j < s.sellPrices.length; j++) { uint256 p2 = s.sellPrices[j]; OrderBookStorage.PriceLevel storage lvl2 = s.sellLevels[p2]; if (lvl2.exists && lvl2.firstOrderId != 0) { a++; } }
        return (b, a);
    }

    // Mapping-like accessors to mirror public mapping getters in monolith
    function buyLevels(uint256 price) external view returns (OrderBookStorage.PriceLevel memory level) {
        return OrderBookStorage.state().buyLevels[price];
    }
    function sellLevels(uint256 price) external view returns (OrderBookStorage.PriceLevel memory level) {
        return OrderBookStorage.state().sellLevels[price];
    }

    // Total margin locked in this market across all users (USDC, 6 decimals)
    function totalMarginLockedInMarket() external view returns (uint256 totalLocked6) {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        return s.vault.getTotalMarginLockedInMarket(s.marketId);
    }
}


