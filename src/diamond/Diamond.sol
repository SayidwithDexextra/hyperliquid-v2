// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDiamondCut.sol";
import "./interfaces/IDiamondLoupe.sol";
import "./interfaces/IERC173.sol";
import "./libraries/LibDiamond.sol";

contract Diamond is IDiamondCut, IDiamondLoupe, IERC173 {
    using LibDiamond for LibDiamond.DiamondStorage;

    constructor(address _contractOwner, FacetCut[] memory _cut, address _init, bytes memory _calldata) {
        LibDiamond.setContractOwner(_contractOwner);
        LibDiamond.diamondCut(_cut, _init, _calldata);
    }

    // IDiamondCut
    function diamondCut(FacetCut[] calldata _diamondCut, address _init, bytes calldata _calldata) external override {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.diamondCut(_diamondCut, _init, _calldata);
    }

    // Loupe
    function facets() external view override returns (Facet[] memory facets_) {
        address[] memory facetAddrs = facetAddresses();
        facets_ = new Facet[](facetAddrs.length);
        for (uint256 i = 0; i < facetAddrs.length; i++) {
            facets_[i].facetAddress = facetAddrs[i];
            facets_[i].functionSelectors = facetFunctionSelectors(facetAddrs[i]);
        }
    }

    function facetFunctionSelectors(address _facet) public view override returns (bytes4[] memory facetFunctionSelectors_) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        // count selectors for this facet
        uint16 count = ds.facetFunctionCount[_facet];
        facetFunctionSelectors_ = new bytes4[](count);
        uint256 found = 0;
        for (uint256 i = 0; i < ds.selectors.length; i++) {
            LibDiamond.FacetAddressAndSelectorPosition memory entry = ds.selectorToFacetAndPosition[ds.selectors[i]];
            if (entry.facetAddress == _facet) {
                facetFunctionSelectors_[found] = ds.selectors[i];
                found++;
                if (found == count) break;
            }
        }
    }

    function facetAddresses() public view override returns (address[] memory facetAddresses_) {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        // derive unique set from mapping by scanning selectors
        // upper bound = number of selectors
        address[] memory tmp = new address[](ds.selectors.length);
        uint256 unique = 0;
        for (uint256 i = 0; i < ds.selectors.length; i++) {
            address f = ds.selectorToFacetAndPosition[ds.selectors[i]].facetAddress;
            bool seen = false;
            for (uint256 j = 0; j < unique; j++) {
                if (tmp[j] == f) { seen = true; break; }
            }
            if (!seen) { tmp[unique] = f; unique++; }
        }
        facetAddresses_ = new address[](unique);
        for (uint256 k = 0; k < unique; k++) {
            facetAddresses_[k] = tmp[k];
        }
    }

    function facetAddress(bytes4 _functionSelector) external view override returns (address facetAddress_) {
        facetAddress_ = LibDiamond.diamondStorage().selectorToFacetAndPosition[_functionSelector].facetAddress;
    }

    // Ownership
    function owner() external view override returns (address) {
        return LibDiamond.diamondStorage().contractOwner;
    }

    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        require(_newOwner != address(0), "Diamond: new owner is zero");
        LibDiamond.setContractOwner(_newOwner);
    }

    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}


