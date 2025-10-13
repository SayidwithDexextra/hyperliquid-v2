// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICoreVault.sol";
import "../libraries/OrderBookStorage.sol";

contract OrderBookInitFacet {
    using OrderBookStorage for OrderBookStorage.State;

    event OBInitialized(address vault, bytes32 marketId, address feeRecipient);

    function obInitialize(address _vault, bytes32 _marketId, address _feeRecipient) external {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(address(s.vault) == address(0) && s.marketId == bytes32(0) && s.feeRecipient == address(0), "OB: already initialized");
        require(_vault != address(0) && _feeRecipient != address(0), "OB: bad params");
        s.vault = ICoreVault(_vault);
        s.marketId = _marketId;
        s.feeRecipient = _feeRecipient;
        s.leverageController = _feeRecipient;
        // sensible defaults from OrderBook
        s.marginRequirementBps = 10000;
        s.tradingFee = 10;
        s.leverageEnabled = false;
        s.maxSlippageBps = 500; // 5%
        s.useVWAPForMarkPrice = true;
        s.vwapTimeWindow = 3600;
        s.lastTradePrice = 1000000;
        s.unitMarginLong6 = 1_000_000; // 1.0 USDC per ALU
        s.unitMarginShort6 = 1_500_000; // 1.5 USDC per ALU
        emit OBInitialized(_vault, _marketId, _feeRecipient);
    }
}


