// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token for testing and development
 * @notice This is a test token with 6 decimals to match real USDC
 */
contract MockUSDC is ERC20, ERC20Permit, Ownable {
    uint8 private constant DECIMALS = 6;
    // No supply or minting limits for testing
    
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);
    
    constructor(
        address initialOwner
    ) ERC20("Mock USD Coin", "USDC") ERC20Permit("Mock USD Coin") Ownable(initialOwner) {
        // Mint initial supply to owner
        _mint(initialOwner, 1_000_000_000 * 10**DECIMALS); // 1B initial supply
    }
    
    /**
     * @dev Returns the number of decimals used to get its user representation
     * @return The number of decimals (6 for USDC)
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
    
    /**
     * @dev Mint tokens to an address (no limits for testing)
     * @param to Address to mint tokens to
     * @param amount Amount to mint (in token units)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MockUSDC: mint to zero address");
        require(amount > 0, "MockUSDC: mint amount must be greater than 0");
        
        _mint(to, amount);
        emit Mint(to, amount);
    }
    
    /**
     * @dev Burn tokens from an address
     * @param from Address to burn tokens from
     * @param amount Amount to burn (in token units)
     */
    function burnFrom(address from, uint256 amount) external {
        require(from != address(0), "MockUSDC: burn from zero address");
        require(amount > 0, "MockUSDC: burn amount must be greater than 0");
        
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "MockUSDC: burn amount exceeds allowance");
        
        _approve(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
        
        emit Burn(from, amount);
    }
    
    /**
     * @dev Burn tokens from caller's balance
     * @param amount Amount to burn (in token units)
     */
    function burn(uint256 amount) external {
        require(amount > 0, "MockUSDC: burn amount must be greater than 0");
        _burn(msg.sender, amount);
        emit Burn(msg.sender, amount);
    }
    
    /**
     * @dev Faucet function for testing - allows users to mint unlimited amounts
     * @param amount Amount to mint
     */
    function faucet(uint256 amount) external {
        require(amount > 0, "MockUSDC: faucet amount must be greater than 0");
        
        _mint(msg.sender, amount);
        emit Mint(msg.sender, amount);
    }
}
