// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOBPricingFacet {
    function getOrderBookDepth(uint256 levels) external view returns (
        uint256[] memory bidPrices,
        uint256[] memory bidAmounts,
        uint256[] memory askPrices,
        uint256[] memory askAmounts
    );
}


