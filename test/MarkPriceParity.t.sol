// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

interface ILegacyOrderBook {
    function calculateMarkPrice() external view returns (uint256);
    function bestBid() external view returns (uint256);
    function bestAsk() external view returns (uint256);
    function lastTradePrice() external view returns (uint256);
}

interface IOBPricingFacetLike {
    function calculateMarkPrice() external view returns (uint256);
}

// This test expects the fixture/deployer to provide addresses for legacy OB and diamond pricing facet
// via environment or broadcast logs. Alternatively, you can wire this into your deploy script to set
// the constants before running.
contract MarkPriceParityTest is Test {
    ILegacyOrderBook legacy;
    IOBPricingFacetLike pricing;

    constructor() {
        // Set these via env vars for your local tests
        address legacyAddr = vm.envAddress("LEGACY_OB_ADDRESS");
        address pricingAddr = vm.envAddress("DIAMOND_PRICING_ADDRESS");
        legacy = ILegacyOrderBook(legacyAddr);
        pricing = IOBPricingFacetLike(pricingAddr);
    }

    function test_equal_calculateMarkPrice_snapshot() public view {
        uint256 legacyMark = legacy.calculateMarkPrice();
        uint256 diamondMark = pricing.calculateMarkPrice();
        assertEq(legacyMark, diamondMark, "mark price mismatch");
    }
}


