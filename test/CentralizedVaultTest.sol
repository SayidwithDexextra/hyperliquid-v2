// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import "../src/CentralizedVault.sol";
import "../src/MockUSDC.sol";

/**
 * @title CentralizedVaultTest
 * @dev Comprehensive test suite for the CentralizedVault contract
 */
contract CentralizedVaultTest is Test {
    CentralizedVault public vault;
    MockUSDC public usdc;
    
    // Test addresses
    address public admin = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);
    address public orderBook = address(0x4);
    address public settlement = address(0x5);
    address public feeRecipient = address(0x6);
    
    // Test constants
    bytes32 public constant MARKET_ETH = keccak256("ETH-USD");
    bytes32 public constant MARKET_BTC = keccak256("BTC-USD");
    
    uint256 public constant DEPOSIT_AMOUNT = 1000 * 10**6; // 1000 USDC
    uint256 public constant MARGIN_AMOUNT = 100 * 10**6;   // 100 USDC
    uint256 public constant PRICE_ETH = 2000 * 10**6;      // $2000
    uint256 public constant PRICE_BTC = 50000 * 10**6;     // $50000
    
    // Events for testing
    event CollateralDeposited(address indexed user, uint256 amount, uint256 newBalance);
    event CollateralWithdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLocked);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLocked);
    event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event PnLRealized(address indexed user, bytes32 indexed marketId, int256 pnl, int256 totalRealizedPnL);
    event FeesDeducted(address indexed user, uint256 feeAmount, address indexed feeRecipient);
    event MarkPriceUpdated(bytes32 indexed marketId, uint256 oldPrice, uint256 newPrice);
    event MarketAuthorizationChanged(bytes32 indexed marketId, bool authorized);
    
    function setUp() public {
        // Deploy contracts
        usdc = new MockUSDC(admin);
        vault = new CentralizedVault(address(usdc), admin);
        
        // Setup roles
        vm.startPrank(admin);
        vault.grantRole(vault.ORDERBOOK_ROLE(), orderBook);
        vault.grantRole(vault.SETTLEMENT_ROLE(), settlement);
        
        // Authorize test markets
        vault.setMarketAuthorization(MARKET_ETH, true);
        vault.setMarketAuthorization(MARKET_BTC, true);
        
        // Set initial mark prices
        vault.updateMarkPrice(MARKET_ETH, PRICE_ETH);
        vault.updateMarkPrice(MARKET_BTC, PRICE_BTC);
        vm.stopPrank();
        
        // Mint USDC to test users
        vm.startPrank(admin);
        usdc.mint(user1, DEPOSIT_AMOUNT * 10); // 10k USDC
        usdc.mint(user2, DEPOSIT_AMOUNT * 10); // 10k USDC
        vm.stopPrank();
        
        // Approve vault for transfers
        vm.prank(user1);
        usdc.approve(address(vault), type(uint256).max);
        
        vm.prank(user2);
        usdc.approve(address(vault), type(uint256).max);
    }
    
    // ============ Collateral Management Tests ============
    
    function testDepositCollateral() public {
        vm.prank(user1);
        vm.expectEmit(true, false, false, true);
        emit CollateralDeposited(user1, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);
        
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        assertEq(vault.userCollateral(user1), DEPOSIT_AMOUNT);
        assertEq(vault.totalCollateralDeposited(), DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), DEPOSIT_AMOUNT);
    }
    
    function testWithdrawCollateral() public {
        // First deposit
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        uint256 withdrawAmount = DEPOSIT_AMOUNT / 2;
        uint256 expectedBalance = DEPOSIT_AMOUNT - withdrawAmount;
        
        vm.prank(user1);
        vm.expectEmit(true, false, false, true);
        emit CollateralWithdrawn(user1, withdrawAmount, expectedBalance);
        
        vault.withdrawCollateral(withdrawAmount);
        
        assertEq(vault.userCollateral(user1), expectedBalance);
        assertEq(vault.totalCollateralDeposited(), expectedBalance);
    }
    
    function testCannotWithdrawMoreThanAvailable() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(user1);
        vm.expectRevert();
        vault.withdrawCollateral(DEPOSIT_AMOUNT + 1);
    }
    
    function testCannotDepositZero() public {
        vm.prank(user1);
        vm.expectRevert("CentralizedVault: amount must be positive");
        vault.depositCollateral(0);
    }
    
    function testCannotWithdrawZero() public {
        vm.prank(user1);
        vm.expectRevert("CentralizedVault: amount must be positive");
        vault.withdrawCollateral(0);
    }
    
    // ============ Margin Management Tests ============
    
    function testLockMargin() public {
        // Setup: deposit collateral
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vm.expectEmit(true, true, false, true);
        emit MarginLocked(user1, MARKET_ETH, MARGIN_AMOUNT, MARGIN_AMOUNT);
        
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        assertEq(vault.userMarginByMarket(user1, MARKET_ETH), MARGIN_AMOUNT);
        assertEq(vault.totalMarginLocked(), MARGIN_AMOUNT);
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT - MARGIN_AMOUNT);
    }
    
    function testReleaseMargin() public {
        // Setup: deposit and lock margin
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        uint256 releaseAmount = MARGIN_AMOUNT / 2;
        uint256 expectedLocked = MARGIN_AMOUNT - releaseAmount;
        
        vm.prank(orderBook);
        vm.expectEmit(true, true, false, true);
        emit MarginReleased(user1, MARKET_ETH, releaseAmount, expectedLocked);
        
        vault.releaseMargin(user1, MARKET_ETH, releaseAmount);
        
        assertEq(vault.userMarginByMarket(user1, MARKET_ETH), expectedLocked);
        assertEq(vault.totalMarginLocked(), expectedLocked);
    }
    
    function testReserveMargin() public {
        // Setup: deposit collateral
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        bytes32 orderId = keccak256("order1");
        
        vm.prank(orderBook);
        vm.expectEmit(true, true, true, true);
        emit MarginReserved(user1, orderId, MARKET_ETH, MARGIN_AMOUNT);
        
        vault.reserveMargin(user1, orderId, MARKET_ETH, MARGIN_AMOUNT);
        
        assertEq(vault.getTotalMarginReserved(user1), MARGIN_AMOUNT);
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT - MARGIN_AMOUNT);
        
        // Check pending order was created
        CentralizedVault.PendingOrder[] memory orders = vault.getUserPendingOrders(user1);
        assertEq(orders.length, 1);
        assertEq(orders[0].orderId, orderId);
        assertEq(orders[0].marketId, MARKET_ETH);
        assertEq(orders[0].marginReserved, MARGIN_AMOUNT);
    }
    
    function testUnreserveMargin() public {
        // Setup: deposit and reserve margin
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        bytes32 orderId = keccak256("order1");
        
        vm.prank(orderBook);
        vault.reserveMargin(user1, orderId, MARKET_ETH, MARGIN_AMOUNT);
        
        vm.prank(orderBook);
        vm.expectEmit(true, true, false, true);
        emit MarginUnreserved(user1, orderId, MARGIN_AMOUNT);
        
        vault.unreserveMargin(user1, orderId);
        
        assertEq(vault.getTotalMarginReserved(user1), 0);
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT);
        
        // Check pending order was removed
        CentralizedVault.PendingOrder[] memory orders = vault.getUserPendingOrders(user1);
        assertEq(orders.length, 0);
    }
    
    function testCannotLockMoreThanAvailable() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vm.expectRevert();
        vault.lockMargin(user1, MARKET_ETH, DEPOSIT_AMOUNT + 1);
    }
    
    function testOnlyOrderBookCanManageMargin() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(user1);
        vm.expectRevert();
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
    }
    
    // ============ Position Management Tests ============
    
    function testUpdatePositionNewLong() public {
        // Setup: deposit and lock margin
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 size = 1 * 10**18; // 1 ETH long
        
        vm.prank(orderBook);
        vm.expectEmit(true, true, false, true);
        emit PositionUpdated(user1, MARKET_ETH, 0, size, PRICE_ETH, MARGIN_AMOUNT);
        
        vault.updatePosition(user1, MARKET_ETH, size, PRICE_ETH);
        
        // Check position was created
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 1);
        assertEq(positions[0].marketId, MARKET_ETH);
        assertEq(positions[0].size, size);
        assertEq(positions[0].entryPrice, PRICE_ETH);
        assertEq(positions[0].marginLocked, MARGIN_AMOUNT);
    }
    
    function testUpdatePositionNewShort() public {
        // Setup: deposit and lock margin
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 size = -1 * 10**18; // 1 ETH short
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, size, PRICE_ETH);
        
        // Check position was created
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 1);
        assertEq(positions[0].size, size);
    }
    
    function testUpdatePositionIncrease() public {
        // Setup: create initial position
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 initialSize = 1 * 10**18;
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, initialSize, PRICE_ETH);
        
        // Increase position
        int256 additionalSize = 1 * 10**18;
        uint256 newPrice = PRICE_ETH + 100 * 10**6; // $100 higher
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, additionalSize, newPrice);
        
        // Check weighted average entry price
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 1);
        assertEq(positions[0].size, initialSize + additionalSize);
        
        // Expected weighted average: (2000 + 2100) / 2 = 2050
        uint256 expectedPrice = (PRICE_ETH + newPrice) / 2;
        assertEq(positions[0].entryPrice, expectedPrice);
    }
    
    function testUpdatePositionClose() public {
        // Setup: create initial position
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 size = 1 * 10**18;
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, size, PRICE_ETH);
        
        // Close position
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, -size, PRICE_ETH);
        
        // Check position was removed
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 0);
    }
    
    function testUpdatePositionFlip() public {
        // Setup: create initial long position
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 initialSize = 1 * 10**18;
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, initialSize, PRICE_ETH);
        
        // Flip to short (close long + open short)
        int256 flipSize = -2 * 10**18; // Close 1 ETH long, open 1 ETH short
        uint256 newPrice = PRICE_ETH + 100 * 10**6;
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, flipSize, newPrice);
        
        // Check position flipped
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 1);
        assertEq(positions[0].size, initialSize + flipSize); // 1 + (-2) = -1
        assertEq(positions[0].entryPrice, newPrice); // New entry price for flipped position
    }
    
    function testCannotUpdatePositionUnauthorized() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.updatePosition(user1, MARKET_ETH, 1 * 10**18, PRICE_ETH);
    }
    
    // ============ Portfolio Calculation Tests ============
    
    function testGetAvailableCollateral() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        // Initially all collateral is available
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT);
        
        // Lock some margin
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT - MARGIN_AMOUNT);
        
        // Reserve some margin
        bytes32 orderId = keccak256("order1");
        vm.prank(orderBook);
        vault.reserveMargin(user1, orderId, MARKET_BTC, MARGIN_AMOUNT);
        
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT - (2 * MARGIN_AMOUNT));
    }
    
    function testGetUnrealizedPnL() public {
        // Setup: create position
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        int256 size = 1 * 10**18; // 1 ETH
        uint256 entryPrice = 2000 * 10**6; // $2000
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, size, entryPrice);
        
        // Update mark price to $2100 (profit)
        uint256 newMarkPrice = 2100 * 10**6;
        vm.prank(settlement);
        vault.updateMarkPrice(MARKET_ETH, newMarkPrice);
        
        // Calculate expected P&L: (2100 - 2000) * 1 / 1e6 = 100 USDC
        int256 expectedPnL = int256((newMarkPrice - entryPrice) * uint256(size) / vault.TICK_PRECISION());
        assertEq(vault.getUnrealizedPnL(user1), expectedPnL);
    }
    
    function testGetPortfolioValue() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        // Initially portfolio value equals collateral
        assertEq(vault.getPortfolioValue(user1), int256(DEPOSIT_AMOUNT));
        
        // Add realized P&L
        int256 realizedPnL = 50 * 10**6; // $50 profit
        vm.prank(settlement);
        vault.realizePnL(user1, MARKET_ETH, realizedPnL);
        
        assertEq(vault.getPortfolioValue(user1), int256(DEPOSIT_AMOUNT) + realizedPnL);
    }
    
    function testGetMarginSummary() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        bytes32 orderId = keccak256("order1");
        vm.prank(orderBook);
        vault.reserveMargin(user1, orderId, MARKET_BTC, MARGIN_AMOUNT);
        
        CentralizedVault.MarginSummary memory summary = vault.getMarginSummary(user1);
        
        assertEq(summary.totalCollateral, DEPOSIT_AMOUNT);
        assertEq(summary.marginUsed, MARGIN_AMOUNT);
        assertEq(summary.marginReserved, MARGIN_AMOUNT);
        assertEq(summary.availableCollateral, DEPOSIT_AMOUNT - (2 * MARGIN_AMOUNT));
        assertEq(summary.realizedPnL, 0);
        assertEq(summary.unrealizedPnL, 0);
        assertEq(summary.portfolioValue, int256(DEPOSIT_AMOUNT));
    }
    
    // ============ Settlement Function Tests ============
    
    function testRealizePnL() public {
        int256 pnl = 100 * 10**6; // $100 profit
        
        vm.prank(settlement);
        vm.expectEmit(true, true, false, true);
        emit PnLRealized(user1, MARKET_ETH, pnl, pnl);
        
        vault.realizePnL(user1, MARKET_ETH, pnl);
        
        assertEq(vault.userRealizedPnL(user1), pnl);
    }
    
    function testDeductFees() public {
        // Setup: deposit collateral
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        uint256 feeAmount = 10 * 10**6; // $10 fee
        
        vm.prank(orderBook);
        vm.expectEmit(true, false, true, true);
        emit FeesDeducted(user1, feeAmount, feeRecipient);
        
        vault.deductFees(user1, feeAmount, feeRecipient);
        
        assertEq(vault.userCollateral(user1), DEPOSIT_AMOUNT - feeAmount);
        assertEq(vault.totalFeesCollected(), feeAmount);
        assertEq(usdc.balanceOf(feeRecipient), feeAmount);
    }
    
    function testUpdateMarkPrice() public {
        uint256 newPrice = 2100 * 10**6;
        
        vm.prank(settlement);
        vm.expectEmit(true, false, false, true);
        emit MarkPriceUpdated(MARKET_ETH, PRICE_ETH, newPrice);
        
        vault.updateMarkPrice(MARKET_ETH, newPrice);
        
        assertEq(vault.marketMarkPrices(MARKET_ETH), newPrice);
    }
    
    // ============ Administrative Function Tests ============
    
    function testSetMarketAuthorization() public {
        bytes32 newMarket = keccak256("NEW-MARKET");
        
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit MarketAuthorizationChanged(newMarket, true);
        
        vault.setMarketAuthorization(newMarket, true);
        
        assertTrue(vault.authorizedMarkets(newMarket));
    }
    
    function testPauseUnpause() public {
        // Test pause
        vm.prank(admin);
        vault.pause();
        assertTrue(vault.paused());
        
        // Test that operations are blocked when paused
        vm.prank(user1);
        vm.expectRevert();
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        // Test unpause
        vm.prank(admin);
        vault.unpause();
        assertFalse(vault.paused());
        
        // Test that operations work after unpause
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        assertEq(vault.userCollateral(user1), DEPOSIT_AMOUNT);
    }
    
    function testOnlyAdminCanPause() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.pause();
    }
    
    // ============ View Function Tests ============
    
    function testGetUserPositions() public {
        // Setup: create positions
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_BTC, MARGIN_AMOUNT);
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, 1 * 10**18, PRICE_ETH);
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_BTC, -5 * 10**17, PRICE_BTC); // 0.5 BTC short
        
        CentralizedVault.Position[] memory positions = vault.getUserPositions(user1);
        assertEq(positions.length, 2);
        
        // Check ETH position
        bool foundETH = false;
        bool foundBTC = false;
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == MARKET_ETH) {
                foundETH = true;
                assertEq(positions[i].size, 1 * 10**18);
                assertEq(positions[i].entryPrice, PRICE_ETH);
            } else if (positions[i].marketId == MARKET_BTC) {
                foundBTC = true;
                assertEq(positions[i].size, -5 * 10**17);
                assertEq(positions[i].entryPrice, PRICE_BTC);
            }
        }
        assertTrue(foundETH);
        assertTrue(foundBTC);
    }
    
    function testGetUserPositionByMarket() public {
        // Setup: create position
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, 1 * 10**18, PRICE_ETH);
        
        CentralizedVault.Position memory position = vault.getUserPositionByMarket(user1, MARKET_ETH);
        assertEq(position.marketId, MARKET_ETH);
        assertEq(position.size, 1 * 10**18);
        assertEq(position.entryPrice, PRICE_ETH);
        
        // Test non-existent position
        CentralizedVault.Position memory emptyPosition = vault.getUserPositionByMarket(user1, MARKET_BTC);
        assertEq(emptyPosition.size, 0);
    }
    
    function testGetGlobalStats() public {
        // Setup: create some activity
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(user2);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        vm.prank(orderBook);
        vault.deductFees(user1, 10 * 10**6, feeRecipient);
        
        (uint256 totalDeposited, uint256 totalLocked, uint256 totalFees) = vault.getGlobalStats();
        
        assertEq(totalDeposited, 2 * DEPOSIT_AMOUNT - 10 * 10**6); // 2 deposits minus fees
        assertEq(totalLocked, MARGIN_AMOUNT);
        assertEq(totalFees, 10 * 10**6);
    }
    
    // ============ Edge Case Tests ============
    
    function testPositionOverflowProtection() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        // Create max position
        int256 maxSize = type(int256).max / 2;
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, maxSize, PRICE_ETH);
        
        // Try to increase beyond max - should revert
        vm.prank(orderBook);
        vm.expectRevert("CentralizedVault: position size overflow");
        vault.updatePosition(user1, MARKET_ETH, maxSize, PRICE_ETH);
    }
    
    function testCannotOperateOnUnauthorizedMarket() public {
        bytes32 unauthorizedMarket = keccak256("UNAUTHORIZED");
        
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(orderBook);
        vm.expectRevert("CentralizedVault: market not authorized");
        vault.lockMargin(user1, unauthorizedMarket, MARGIN_AMOUNT);
    }
    
    function testMultipleUsersIndependent() public {
        // Setup both users
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        vm.prank(user2);
        vault.depositCollateral(DEPOSIT_AMOUNT * 2);
        
        // User1 operations
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        
        // User2 operations
        vm.prank(orderBook);
        vault.lockMargin(user2, MARKET_BTC, MARGIN_AMOUNT * 2);
        
        // Check independence
        assertEq(vault.getAvailableCollateral(user1), DEPOSIT_AMOUNT - MARGIN_AMOUNT);
        assertEq(vault.getAvailableCollateral(user2), (DEPOSIT_AMOUNT * 2) - (MARGIN_AMOUNT * 2));
        assertEq(vault.userMarginByMarket(user1, MARKET_ETH), MARGIN_AMOUNT);
        assertEq(vault.userMarginByMarket(user1, MARKET_BTC), 0);
        assertEq(vault.userMarginByMarket(user2, MARKET_BTC), MARGIN_AMOUNT * 2);
        assertEq(vault.userMarginByMarket(user2, MARKET_ETH), 0);
    }
    
    // ============ Gas Optimization Tests ============
    
    function testGasOptimizationBenchmark() public {
        vm.prank(user1);
        vault.depositCollateral(DEPOSIT_AMOUNT);
        
        uint256 gasBefore;
        uint256 gasAfter;
        
        // Test deposit gas
        gasBefore = gasleft();
        vm.prank(user1);
        vault.depositCollateral(100 * 10**6);
        gasAfter = gasleft();
        console.log("Deposit gas:", gasBefore - gasAfter);
        
        // Test margin lock gas
        gasBefore = gasleft();
        vm.prank(orderBook);
        vault.lockMargin(user1, MARKET_ETH, MARGIN_AMOUNT);
        gasAfter = gasleft();
        console.log("Lock margin gas:", gasBefore - gasAfter);
        
        // Test position update gas
        gasBefore = gasleft();
        vm.prank(orderBook);
        vault.updatePosition(user1, MARKET_ETH, 1 * 10**18, PRICE_ETH);
        gasAfter = gasleft();
        console.log("Position update gas:", gasBefore - gasAfter);
    }
}
