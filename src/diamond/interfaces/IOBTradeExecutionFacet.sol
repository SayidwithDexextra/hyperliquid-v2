// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOBTradeExecutionFacet {
    function obExecuteTrade(
        address buyer,
        address seller,
        uint256 price,
        uint256 amount,
        bool buyerMargin,
        bool sellerMargin
    ) external;
}



