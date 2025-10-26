// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICoreVault {
    function isLiquidatable(address user, bytes32 marketId, uint256 markPrice) external returns (bool);
    function getPositionSummary(address user, bytes32 marketId) external view returns (int256 size, uint256 entryPrice, uint256 marginLocked);
    function setUnderLiquidation(address user, bytes32 marketId, bool state) external;
    function updatePositionWithMargin(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice, uint256 marginToLock) external;
    function updatePositionWithLiquidation(address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, address liquidator) external;
    function deductFees(address user, uint256 feeAmount, address feeRecipient) external;
    function transferCollateral(address from, address to, uint256 amount) external;
    function getAvailableCollateral(address user) external view returns (uint256);
    function updateMarkPrice(bytes32 marketId, uint256 price) external;
    function settleMarket(bytes32 marketId, uint256 finalPrice) external;
    function payMakerLiquidationReward(address liquidatedUser, bytes32 marketId, address maker, uint256 amount) external;
    // Order reservation for margin orders
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount) external;
    function unreserveMargin(address user, bytes32 orderId) external;
    function releaseExcessMargin(address user, bytes32 orderId, uint256 actualMarginNeeded) external;
    // Discovery helpers
    function getUsersWithPositionsInMarket(bytes32 marketId) external view returns (address[] memory users);
    function marketSettled(bytes32 marketId) external view returns (bool);
    function getTotalMarginLockedInMarket(bytes32 marketId) external view returns (uint256 totalLocked6);
}


