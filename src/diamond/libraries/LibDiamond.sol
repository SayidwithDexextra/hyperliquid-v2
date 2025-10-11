// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IDiamondCut.sol";

library LibDiamond {
    bytes32 internal constant DIAMOND_STORAGE_POSITION = keccak256("diamond.standard.diamond.storage");

    struct FacetAddressAndSelectorPosition {
        address facetAddress;
        uint16 selectorPosition;
    }

    struct DiamondStorage {
        // function selector => facet address and position in selector array
        mapping(bytes4 => FacetAddressAndSelectorPosition) selectorToFacetAndPosition;
        // array of selectors for iteration
        bytes4[] selectors;
        // facet address => selector count
        mapping(address => uint16) facetFunctionCount;
        // ownership
        address contractOwner;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DiamondCut(IDiamondCut.FacetCut[] _diamondCut, address _init, bytes _calldata);

    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    function setContractOwner(address _newOwner) internal {
        DiamondStorage storage ds = diamondStorage();
        address previousOwner = ds.contractOwner;
        ds.contractOwner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }

    function enforceIsContractOwner() internal view {
        require(msg.sender == diamondStorage().contractOwner, "LibDiamond: Must be contract owner");
    }

    function addFunctions(address _facet, bytes4[] memory _selectors) internal {
        require(_facet != address(0), "LibDiamond: Add facet can't be address(0)");
        DiamondStorage storage ds = diamondStorage();
        uint16 selectorCount = uint16(ds.selectors.length);
        for (uint256 i = 0; i < _selectors.length; i++) {
            bytes4 selector = _selectors[i];
            require(ds.selectorToFacetAndPosition[selector].facetAddress == address(0), "LibDiamond: Selector exists");
            ds.selectorToFacetAndPosition[selector] = FacetAddressAndSelectorPosition({
                facetAddress: _facet,
                selectorPosition: selectorCount
            });
            ds.selectors.push(selector);
            selectorCount++;
            ds.facetFunctionCount[_facet]++;
        }
    }

    function replaceFunctions(address _facet, bytes4[] memory _selectors) internal {
        require(_facet != address(0), "LibDiamond: Replace facet can't be address(0)");
        DiamondStorage storage ds = diamondStorage();
        for (uint256 i = 0; i < _selectors.length; i++) {
            bytes4 selector = _selectors[i];
            address old = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(old != address(0), "LibDiamond: Selector does not exist");
            if (old == _facet) continue;
            ds.selectorToFacetAndPosition[selector].facetAddress = _facet;
            ds.facetFunctionCount[_facet]++;
            if (ds.facetFunctionCount[old] > 0) ds.facetFunctionCount[old]--;
        }
    }

    function removeFunctions(bytes4[] memory _selectors) internal {
        DiamondStorage storage ds = diamondStorage();
        uint256 selectorsLen = ds.selectors.length;
        for (uint256 i = 0; i < _selectors.length; i++) {
            bytes4 selector = _selectors[i];
            FacetAddressAndSelectorPosition memory entry = ds.selectorToFacetAndPosition[selector];
            address facet = entry.facetAddress;
            require(facet != address(0), "LibDiamond: Selector does not exist");
            // swap and pop in selectors array
            uint16 pos = entry.selectorPosition;
            bytes4 lastSelector = ds.selectors[selectorsLen - 1];
            ds.selectors[pos] = lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].selectorPosition = pos;
            ds.selectors.pop();
            selectorsLen--;
            delete ds.selectorToFacetAndPosition[selector];
            if (ds.facetFunctionCount[facet] > 0) ds.facetFunctionCount[facet]--;
        }
    }

    function diamondCut(IDiamondCut.FacetCut[] memory _diamondCut, address _init, bytes memory _calldata) internal {
        for (uint256 facetIndex = 0; facetIndex < _diamondCut.length; facetIndex++) {
            IDiamondCut.FacetCutAction action = _diamondCut[facetIndex].action;
            address facet = _diamondCut[facetIndex].facetAddress;
            bytes4[] memory selectors = _diamondCut[facetIndex].functionSelectors;
            if (action == IDiamondCut.FacetCutAction.Add) {
                addFunctions(facet, selectors);
            } else if (action == IDiamondCut.FacetCutAction.Replace) {
                replaceFunctions(facet, selectors);
            } else if (action == IDiamondCut.FacetCutAction.Remove) {
                removeFunctions(selectors);
            } else {
                revert("LibDiamond: Incorrect FacetCutAction");
            }
        }
        emit DiamondCut(_diamondCut, _init, _calldata);
        initializeDiamondCut(_init, _calldata);
    }

    function initializeDiamondCut(address _init, bytes memory _calldata) internal {
        if (_init == address(0)) {
            require(_calldata.length == 0, "LibDiamond: _init is address(0) but_calldata is not empty");
        } else {
            (bool success, bytes memory error) = _init.delegatecall(_calldata);
            if (!success) {
                if (error.length > 0) {
                    assembly {
                        revert(add(error, 32), mload(error))
                    }
                } else {
                    revert("LibDiamond: Initialization function reverted");
                }
            }
        }
    }
}


