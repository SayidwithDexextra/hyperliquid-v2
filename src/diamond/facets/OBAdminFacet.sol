// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";

contract OBAdminFacet {
    using OrderBookStorage for OrderBookStorage.State;

    event TradingParametersUpdated(uint256 marginRequirement, uint256 tradingFee, address feeRecipient);
    event LeverageEnabled(address indexed controller, uint256 maxLeverage, uint256 newMarginRequirement);
    event LeverageDisabled(address indexed controller);
    event LeverageControllerUpdated(address indexed oldController, address indexed newController);

    modifier onlyOwner() {
        LibDiamond.enforceIsContractOwner();
        _;
    }

    function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external onlyOwner {
        require(_marginRequirementBps <= 15000, "OB: margin too high");
        require(_tradingFee <= 1000, "OB: fee too high");
        require(_feeRecipient != address(0), "OB: bad recipient");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.marginRequirementBps = _marginRequirementBps;
        s.tradingFee = _tradingFee;
        s.feeRecipient = _feeRecipient;
        emit TradingParametersUpdated(_marginRequirementBps, _tradingFee, _feeRecipient);
    }

    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) external onlyOwner {
        require(_maxLeverage > 1 && _maxLeverage <= 100, "OB: bad maxLev");
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OB: bad margin");
        require(_marginRequirementBps <= (10000 / _maxLeverage), "OB: margin too low for maxLev");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.leverageEnabled = true;
        s.maxLeverage = _maxLeverage;
        s.marginRequirementBps = _marginRequirementBps;
        emit LeverageEnabled(s.leverageController, _maxLeverage, _marginRequirementBps);
    }

    function disableLeverage() external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.leverageEnabled = false;
        s.marginRequirementBps = 10000;
        emit LeverageDisabled(s.leverageController);
    }

    function setMarginRequirement(uint256 _marginRequirementBps) external onlyOwner {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        require(s.leverageEnabled, "OB: leverage disabled");
        require(_marginRequirementBps >= 100 && _marginRequirementBps <= 10000, "OB: bad margin");
        require(s.maxLeverage == 0 || _marginRequirementBps <= (10000 / s.maxLeverage), "OB: margin too low for maxLev");
        s.marginRequirementBps = _marginRequirementBps;
        emit TradingParametersUpdated(_marginRequirementBps, s.tradingFee, s.feeRecipient);
    }

    function setLeverageController(address _newController) external onlyOwner {
        require(_newController != address(0), "OB: invalid controller");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        address old = s.leverageController;
        s.leverageController = _newController;
        emit LeverageControllerUpdated(old, _newController);
    }

    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    function updateMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        require(_maxSlippageBps <= 5000, "OrderBook: slippage too high");
        OrderBookStorage.State storage s = OrderBookStorage.state();
        uint256 old = s.maxSlippageBps;
        s.maxSlippageBps = _maxSlippageBps;
        emit MaxSlippageUpdated(old, _maxSlippageBps);
    }
}


