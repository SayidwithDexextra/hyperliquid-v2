// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/LiquidationVault.sol";
import "../src/VaultRouter.sol";
import "../src/OrderBook.sol";
import "../src/MockUSDC.sol";

contract LiquidationTest is Test {
    LiquidationVault public vault;
    VaultRouter public router;
    OrderBook public orderBook;
    MockUSDC public usdc;
    
    address public admin = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public liquidator = address(4);
    
    bytes32 public constant MARKET_ID = keccak256("ALU-USD");
    uint256 public constant INITIAL_BALANCE = 10000e6; // 10,000 USDC
    uint256 public constant INITIAL_PRICE = 2500e6;    // $2,500
    
    function setUp() public {
        // Deploy contracts
        usdc = new MockUSDC();
        vault = new LiquidationVault(address(usdc), admin);
        orderBook = new OrderBook();
        router = new VaultRouter(address(vault), address(orderBook), admin);
        
        // Setup roles
        vm.startPrank(admin);
        vault.grantRole(vault.ORDERBOOK_ROLE(), address(orderBook));
        vault.grantRole(vault.SETTLEMENT_ROLE(), address(orderBook));
        router.grantRole(router.LIQUIDATOR_ROLE(), liquidator);
        vm.stopPrank();
        
        // Fund users
        usdc.mint(user1, INITIAL_BALANCE);
        usdc.mint(user2, INITIAL_BALANCE);
        
        vm.startPrank(user1);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositCollateral(INITIAL_BALANCE);
        vm.stopPrank();
        
        vm.startPrank(user2);
        usdc.approve(address(vault), type(uint256).max);
        vault.depositCollateral(INITIAL_BALANCE);
        vm.stopPrank();
    }
    
    function test_ShortMarginRequirement() public {
        // Setup: User1 tries to open a short position with insufficient margin
        uint256 positionSize = 1e18; // 1 unit
        uint256 notionalValue = positionSize * INITIAL_PRICE / 1e18;
        uint256 requiredMargin = (notionalValue * 150) / 100; // 150%
        
        vm.startPrank(user1);
        vm.expectRevert("LiquidationVault: insufficient collateral for position margin");
        vault.updatePosition(user1, MARKET_ID, -int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Now provide enough margin and try again
        vm.startPrank(user1);
        vault.depositCollateral(requiredMargin);
        vault.updatePosition(user1, MARKET_ID, -int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Verify position was opened
        (int256 size, uint256 entryPrice,) = vault.getUserPositionByMarket(user1, MARKET_ID);
        assertEq(size, -int256(positionSize));
        assertEq(entryPrice, INITIAL_PRICE);
    }
    
    function test_LongMarginRequirement() public {
        // Setup: User1 tries to open a long position with insufficient margin
        uint256 positionSize = 1e18; // 1 unit
        uint256 notionalValue = positionSize * INITIAL_PRICE / 1e18;
        uint256 requiredMargin = notionalValue; // 100%
        
        vm.startPrank(user1);
        vm.expectRevert("LiquidationVault: insufficient collateral for position margin");
        vault.updatePosition(user1, MARKET_ID, int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Now provide enough margin and try again
        vm.startPrank(user1);
        vault.depositCollateral(requiredMargin);
        vault.updatePosition(user1, MARKET_ID, int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Verify position was opened
        (int256 size, uint256 entryPrice,) = vault.getUserPositionByMarket(user1, MARKET_ID);
        assertEq(size, int256(positionSize));
        assertEq(entryPrice, INITIAL_PRICE);
    }
    
    function test_ShortLiquidation() public {
        // Setup: User1 opens a short position
        uint256 positionSize = 1e18; // 1 unit
        uint256 notionalValue = positionSize * INITIAL_PRICE / 1e18;
        uint256 requiredMargin = (notionalValue * 150) / 100; // 150%
        
        vm.startPrank(user1);
        vault.depositCollateral(requiredMargin);
        vault.updatePosition(user1, MARKET_ID, -int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Price increases by 40%, making position liquidatable
        uint256 newPrice = INITIAL_PRICE * 140 / 100;
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.calculateMarkPrice.selector),
            abi.encode(newPrice)
        );
        
        // Verify position is liquidatable
        assertTrue(vault.isLiquidatable(user1, newPrice));
        
        // Liquidator executes liquidation
        vm.startPrank(liquidator);
        router.liquidateShort(user1, MARKET_ID);
        vm.stopPrank();
        
        // Verify position was closed
        (int256 size,,) = vault.getUserPositionByMarket(user1, MARKET_ID);
        assertEq(size, 0);
    }
    
    function test_SocializedLoss() public {
        // Setup: User1 and User2 have profitable positions
        vm.startPrank(user1);
        vault.updatePosition(user1, MARKET_ID, 1e18, INITIAL_PRICE);
        vm.stopPrank();
        
        vm.startPrank(user2);
        vault.updatePosition(user2, MARKET_ID, 1e18, INITIAL_PRICE);
        vm.stopPrank();
        
        // Simulate profits
        uint256 profitPrice = INITIAL_PRICE * 120 / 100;
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.calculateMarkPrice.selector),
            abi.encode(profitPrice)
        );
        
        // Record initial balances
        uint256 user1InitialBalance = vault.userCollateral(user1);
        uint256 user2InitialBalance = vault.userCollateral(user2);
        
        // Apply socialized loss
        uint256 lossAmount = 1000e6; // 1,000 USDC loss
        vm.startPrank(admin);
        vault.applySocializedLoss(MARKET_ID, lossAmount);
        vm.stopPrank();
        
        // Verify loss was distributed proportionally
        uint256 user1FinalBalance = vault.userCollateral(user1);
        uint256 user2FinalBalance = vault.userCollateral(user2);
        
        assertLt(user1FinalBalance, user1InitialBalance);
        assertLt(user2FinalBalance, user2InitialBalance);
        assertEq(user1InitialBalance - user1FinalBalance + user2InitialBalance - user2FinalBalance, lossAmount);
    }
    
    function test_LiquidationThreshold() public {
        // Setup: Open a short position near liquidation threshold
        uint256 positionSize = 1e18;
        uint256 notionalValue = positionSize * INITIAL_PRICE / 1e18;
        uint256 requiredMargin = (notionalValue * 150) / 100;
        
        vm.startPrank(user1);
        vault.depositCollateral(requiredMargin);
        vault.updatePosition(user1, MARKET_ID, -int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Price increases just below liquidation threshold
        uint256 safePrice = INITIAL_PRICE * 130 / 100; // 30% increase
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.calculateMarkPrice.selector),
            abi.encode(safePrice)
        );
        
        // Verify position is not liquidatable
        assertFalse(vault.isLiquidatable(user1, safePrice));
        
        // Price increases above liquidation threshold
        uint256 unsafePrice = INITIAL_PRICE * 140 / 100; // 40% increase
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.calculateMarkPrice.selector),
            abi.encode(unsafePrice)
        );
        
        // Verify position is now liquidatable
        assertTrue(vault.isLiquidatable(user1, unsafePrice));
    }
    
    function test_PartialFill() public {
        // Setup: Open a large short position
        uint256 positionSize = 10e18; // 10 units
        uint256 notionalValue = positionSize * INITIAL_PRICE / 1e18;
        uint256 requiredMargin = (notionalValue * 150) / 100;
        
        vm.startPrank(user1);
        vault.depositCollateral(requiredMargin);
        vault.updatePosition(user1, MARKET_ID, -int256(positionSize), INITIAL_PRICE);
        vm.stopPrank();
        
        // Price increases making position liquidatable
        uint256 liquidationPrice = INITIAL_PRICE * 140 / 100;
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.calculateMarkPrice.selector),
            abi.encode(liquidationPrice)
        );
        
        // Mock orderbook to only fill half the position
        vm.mockCall(
            address(orderBook),
            abi.encodeWithSelector(OrderBook.createMarketBuyOrder.selector),
            abi.encode(positionSize / 2)
        );
        
        // Execute liquidation
        vm.startPrank(liquidator);
        router.liquidateShort(user1, MARKET_ID);
        vm.stopPrank();
        
        // Verify remaining position size
        (int256 size,,) = vault.getUserPositionByMarket(user1, MARKET_ID);
        assertEq(size, -int256(positionSize / 2));
    }
}

