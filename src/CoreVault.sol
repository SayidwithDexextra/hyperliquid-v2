// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./VaultAnalytics.sol";
import "./PositionManager.sol";

// Interface for OrderBook
interface IOrderBook {
    function calculateMarkPrice() external view returns (uint256);
    function clearUserPosition(address user) external;
}

/**
 * @title CoreVault
 * @dev Minimal core vault with library delegation for complex operations
 * @notice Dramatically reduced contract size by extracting logic to libraries
 */
contract CoreVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Access Control Roles ============
    bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // ============ Constants ============
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500; // 5%
    uint256 public constant SHORT_MARGIN_REQUIREMENT_BPS = 1500; // 150%
    uint256 public constant LONG_MARGIN_REQUIREMENT_BPS = 1000; // 100%
    uint256 public constant DECIMAL_SCALE = 1e12; // 10^(ALU_DECIMALS - USDC_DECIMALS)
    uint256 public constant TICK_PRECISION = 1e6; // Price ticks in USDC precision (6 decimals)

    // ============ State Variables ============
    IERC20 public immutable collateralToken;
    
    // Core user data
    mapping(address => uint256) public userCollateral;
    mapping(address => int256) public userRealizedPnL;
    mapping(address => PositionManager.Position[]) public userPositions;
    mapping(address => VaultAnalytics.PendingOrder[]) public userPendingOrders;
    mapping(address => bytes32[]) public userMarketIds;
    mapping(address => mapping(bytes32 => uint256)) public userMarginByMarket;
    
    // Market management
    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => bool) public registeredOrderBooks;
    mapping(address => bytes32[]) public orderBookToMarkets;
    address[] public allOrderBooks;
    mapping(bytes32 => uint256) public marketMarkPrices;
    // Maintenance margin requirement per market (bps); default 10% when 0
    mapping(bytes32 => uint256) public maintenanceMarginBps;
    
    // Global stats
    uint256 public totalCollateralDeposited;
    uint256 public totalMarginLocked;

    // ============ Events ============
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarginLocked(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    event MarginReleased(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 totalLockedAfter);
    // Margin reservation events (compat with CentralizedVault)
    event MarginReserved(address indexed user, bytes32 indexed orderId, bytes32 indexed marketId, uint256 amount);
    event MarginUnreserved(address indexed user, bytes32 indexed orderId, uint256 amount);
    event MarketAuthorized(bytes32 indexed marketId, address indexed orderBook);
    event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
    event PositionUpdated(address indexed user, bytes32 indexed marketId, int256 oldSize, int256 newSize, uint256 entryPrice, uint256 marginLocked);
    event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);

    // ============ Constructor ============
    constructor(address _collateralToken, address _admin) {
        collateralToken = IERC20(_collateralToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ============ Collateral Management ============
    
    function depositCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "!amount");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userCollateral[msg.sender] += amount;
        totalCollateralDeposited += amount;
        
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "!amount");
        require(userCollateral[msg.sender] >= amount, "!balance");
        
        // Check available collateral through library
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[msg.sender].length);
        for (uint256 i = 0; i < userPositions[msg.sender].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[msg.sender][i].marketId,
                size: userPositions[msg.sender][i].size,
                entryPrice: userPositions[msg.sender][i].entryPrice,
                marginLocked: userPositions[msg.sender][i].marginLocked
            });
        }
        uint256 available = VaultAnalytics.getAvailableCollateral(userCollateral[msg.sender], positions);
        require(available >= amount, "!available");
        
        userCollateral[msg.sender] -= amount;
        totalCollateralDeposited -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ============ Position Management (Delegated to Library) ============
    
    function updatePositionWithMargin(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 executionPrice,
        uint256 requiredMargin
    ) external onlyRole(ORDERBOOK_ROLE) nonReentrant {
        PositionManager.NettingResult memory result = PositionManager.executePositionNetting(
            userPositions[user],
            userMarginByMarket[user],
            user,
            marketId,
            sizeDelta,
            executionPrice,
            requiredMargin
        );
        
        // Handle margin changes
        if (result.marginToLock > 0) {
            totalMarginLocked += result.marginToLock;
        }
        if (result.marginToRelease > 0) {
            totalMarginLocked -= result.marginToRelease;
        }
        
        // Handle realized P&L
        if (result.realizedPnL != 0) {
            userRealizedPnL[user] += result.realizedPnL;
        }
        
        // Update market IDs
        if (result.positionClosed) {
            PositionManager.removeMarketIdFromUser(userMarketIds[user], marketId);
        } else if (!result.positionExists) {
            PositionManager.addMarketIdToUser(userMarketIds[user], marketId);
        }
    }

    // ============ View Functions (Delegated to VaultAnalytics) ============
    
    function getMarginSummary(address user) external view returns (VaultAnalytics.MarginSummary memory) {
        // Convert PositionManager.Position[] to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        uint256[] memory markPrices = new uint256[](userPositions[user].length);
        
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
            markPrices[i] = getMarkPrice(userPositions[user][i].marketId);
        }
        
        return VaultAnalytics.getMarginSummary(
            userCollateral[user],
            userRealizedPnL[user],
            positions,
            userPendingOrders[user],
            markPrices
        );
    }

    function getAvailableCollateral(address user) public view returns (uint256) {
        // Convert to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        // Base available = collateral - margin locked in positions
        uint256 baseAvailable = VaultAnalytics.getAvailableCollateral(userCollateral[user], positions);
        // Subtract margin reserved for pending orders
        uint256 reserved = 0;
        VaultAnalytics.PendingOrder[] storage pending = userPendingOrders[user];
        for (uint256 i = 0; i < pending.length; i++) {
            reserved += pending[i].marginReserved;
        }
        return baseAvailable > reserved ? baseAvailable - reserved : 0;
    }

    function getTotalMarginUsed(address user) public view returns (uint256) {
        // Convert to VaultAnalytics.Position[]
        VaultAnalytics.Position[] memory positions = new VaultAnalytics.Position[](userPositions[user].length);
        for (uint256 i = 0; i < userPositions[user].length; i++) {
            positions[i] = VaultAnalytics.Position({
                marketId: userPositions[user][i].marketId,
                size: userPositions[user][i].size,
                entryPrice: userPositions[user][i].entryPrice,
                marginLocked: userPositions[user][i].marginLocked
            });
        }
        return VaultAnalytics.getTotalMarginUsed(positions);
    }

    function getUserPositions(address user) external view returns (PositionManager.Position[] memory) {
        return userPositions[user];
    }

    function getUserPositionCount(address user) external view returns (uint256) {
        return userPositions[user].length;
    }

    function getMarkPrice(bytes32 marketId) public view returns (uint256) {
        // Return stored mark price (updated by SETTLEMENT_ROLE)
        return marketMarkPrices[marketId];
    }

    // ============ Market Authorization ============
    
    function authorizeMarket(
        bytes32 marketId,
        address orderBook
    ) external onlyRole(FACTORY_ROLE) {
        require(orderBook != address(0), "!orderBook");
        require(marketToOrderBook[marketId] == address(0), "exists");
        
        marketToOrderBook[marketId] = orderBook;
        
        if (!registeredOrderBooks[orderBook]) {
            registeredOrderBooks[orderBook] = true;
            allOrderBooks.push(orderBook);
        }
        
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    // ============ Admin Functions ============
    
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getGlobalStats() external view returns (
        uint256 totalDeposited,
        uint256 totalLocked,
        uint256 totalUsers,
        uint256 totalMarkets
    ) {
        return (
            totalCollateralDeposited,
            totalMarginLocked,
            0, // Total users calculation would require additional tracking
            allOrderBooks.length
        );
    }

    // ============ Factory Interface Methods ============
    
    // Backward-compatible helpers used by OrderBook and router flows
    function deductFees(address user, uint256 amount, address recipient) external {
        require(hasRole(FACTORY_ROLE, msg.sender) || hasRole(ORDERBOOK_ROLE, msg.sender), "unauthorized");
        require(userCollateral[user] >= amount, "!balance");
        userCollateral[user] -= amount;
        userCollateral[recipient] += amount;
    }

    function transferCollateral(address from, address to, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(userCollateral[from] >= amount, "!balance");
        userCollateral[from] -= amount;
        userCollateral[to] += amount;
    }

    // Lock margin directly to a market (position margin)
    function lockMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0) && amount > 0, "invalid");
        require(marketToOrderBook[marketId] != address(0), "market!");
        uint256 avail = getAvailableCollateral(user);
        require(avail >= amount, "insufficient collateral");
        userMarginByMarket[user][marketId] += amount;
        totalMarginLocked += amount;
        emit MarginLocked(user, marketId, amount, userMarginByMarket[user][marketId]);
    }

    function releaseMargin(address user, bytes32 marketId, uint256 amount) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0) && amount > 0, "invalid");
        uint256 locked = userMarginByMarket[user][marketId];
        require(locked >= amount, "insufficient locked");
        userMarginByMarket[user][marketId] = locked - amount;
        if (totalMarginLocked >= amount) {
            totalMarginLocked -= amount;
        }
        emit MarginReleased(user, marketId, amount, userMarginByMarket[user][marketId]);
    }

    // ===== Margin reservation API (compat with CentralizedVault) =====
    function reserveMargin(address user, bytes32 orderId, bytes32 marketId, uint256 amount)
        external
        onlyRole(ORDERBOOK_ROLE)
    {
        require(user != address(0) && amount > 0, "invalid");
        // Ensure market is authorized/assigned
        require(marketToOrderBook[marketId] != address(0), "market!");

        uint256 available = getAvailableCollateral(user);
        require(available >= amount, "insufficient collateral");

        // Ensure not double-reserving same orderId
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        for (uint256 i = 0; i < orders.length; i++) {
            require(orders[i].orderId != orderId, "already reserved");
        }

        orders.push(VaultAnalytics.PendingOrder({ orderId: orderId, marginReserved: amount, timestamp: block.timestamp }));
        emit MarginReserved(user, orderId, marketId, amount);
    }

    function unreserveMargin(address user, bytes32 orderId) external onlyRole(ORDERBOOK_ROLE) {
        require(user != address(0), "invalid");
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        uint256 reserved = 0;
        bool found = false;
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                reserved = orders[i].marginReserved;
                // remove by swap/pop
                if (i < orders.length - 1) {
                    orders[i] = orders[orders.length - 1];
                }
                orders.pop();
                found = true;
                break;
            }
        }
        if (found) {
            emit MarginUnreserved(user, orderId, reserved);
        }
    }

    // Update reserved margin for a given order to the actual needed amount (or any target)
    function releaseExcessMargin(address user, bytes32 orderId, uint256 newTotalReservedForOrder)
        external
        onlyRole(ORDERBOOK_ROLE)
    {
        VaultAnalytics.PendingOrder[] storage orders = userPendingOrders[user];
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].orderId == orderId) {
                uint256 current = orders[i].marginReserved;
                if (newTotalReservedForOrder < current) {
                    uint256 released = current - newTotalReservedForOrder;
                    orders[i].marginReserved = newTotalReservedForOrder;
                    emit MarginReleased(user, bytes32(0), released, newTotalReservedForOrder);
                } else if (newTotalReservedForOrder > current) {
                    // Increasing reservation requires sufficient available collateral
                    uint256 increase = newTotalReservedForOrder - current;
                    uint256 available = getAvailableCollateral(user);
                    require(available >= increase, "insufficient collateral");
                    orders[i].marginReserved = newTotalReservedForOrder;
                    // No event for increase; reservation change is implicit
                }
                return;
            }
        }
        // If not found, silently ignore (compat with some order flows)
    }

    function registerOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        require(!registeredOrderBooks[orderBook], "exists");
        registeredOrderBooks[orderBook] = true;
        allOrderBooks.push(orderBook);
    }

    function assignMarketToOrderBook(bytes32 marketId, address orderBook) external onlyRole(FACTORY_ROLE) {
        require(registeredOrderBooks[orderBook], "!registered");
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarkets[orderBook].push(marketId);
        emit MarketAuthorized(marketId, orderBook);
    }

    function updateMarkPrice(bytes32 marketId, uint256 price) external onlyRole(SETTLEMENT_ROLE) {
        marketMarkPrices[marketId] = price;
    }

    function deregisterOrderBook(address orderBook) external onlyRole(FACTORY_ROLE) {
        require(registeredOrderBooks[orderBook], "!exists");
        registeredOrderBooks[orderBook] = false;
        
        // Remove from allOrderBooks array
        for (uint256 i = 0; i < allOrderBooks.length; i++) {
            if (allOrderBooks[i] == orderBook) {
                if (i < allOrderBooks.length - 1) {
                    allOrderBooks[i] = allOrderBooks[allOrderBooks.length - 1];
                }
                allOrderBooks.pop();
                break;
            }
        }
    }

    // ============ Liquidation Interface (compat with OrderBook expectations) ==========

    function getPositionSummary(
        address user,
        bytes32 marketId
    ) external view returns (int256 size, uint256 entryPrice, uint256 marginLocked) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId) {
                return (positions[i].size, positions[i].entryPrice, userMarginByMarket[user][marketId]);
            }
        }
        return (0, 0, userMarginByMarket[user][marketId]);
    }

    function isLiquidatable(
        address user,
        bytes32 marketId,
        uint256 markPrice
    ) external view returns (bool) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size != 0) {
                int256 size = positions[i].size;
                uint256 mm = maintenanceMarginBps[marketId];
                if (mm == 0) mm = 1000; // default 10%
                if (size > 0) {
                    // Long liquidation: with 1:1 system, only at price 0
                    return markPrice == 0;
                } else {
                    // Short liquidation: P_liq = (2.5E)/(1+m)
                    // Use integer math: numerator = 25/10 * E
                    uint256 numerator = (25 * positions[i].entryPrice) / 10;
                    uint256 denominator = 10000 + mm; // (1 + m)
                    uint256 priceLiq = (numerator * 10000) / denominator;
                    return markPrice >= priceLiq;
                }
            }
        }
        return false;
    }

    function liquidateShort(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size < 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = userMarginByMarket[user][marketId];
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);

                // Calculate trading loss first
                uint256 tradingLoss = 0;
                if (markPrice > entryPrice) {
                    // Short position loss: (current price - entry price) * position size
                    uint256 lossPerUnit = markPrice - entryPrice;
                    tradingLoss = (lossPerUnit * uint256(-oldSize)) / (DECIMAL_SCALE * TICK_PRECISION); // Convert to USDC decimals
                }
                
                // Apply liquidation penalty on top of trading loss
                uint256 penalty = (locked * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 totalLoss = tradingLoss + penalty;
                
                // Cap total loss at user's available collateral
                if (totalLoss > userCollateral[user]) {
                    totalLoss = userCollateral[user];
                }
                
                if (totalLoss > 0) {
                    userCollateral[user] -= totalLoss;
                    // Give liquidator the penalty portion only, trading loss is socialized
                    uint256 liquidatorReward = penalty;
                    if (liquidatorReward > totalLoss) {
                        liquidatorReward = totalLoss;
                    }
                    if (liquidatorReward > 0) {
                        userCollateral[liquidator] += liquidatorReward;
                    }
                }

                // Release all locked margin and remove position
                userMarginByMarket[user][marketId] = 0;
                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                // remove position by swap-pop
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                // Remove market ID from user's market list
                _removeMarketIdFromUser(user, marketId);

                // Notify OrderBook to clear its local copy if possible
                address ob = marketToOrderBook[marketId];
                if (ob != address(0)) {
                    try IOrderBook(ob).clearUserPosition(user) {} catch {}
                }

                // Apply socialized loss for the uncovered position
                uint256 positionNotional = uint256(-oldSize) * entryPrice / TICK_PRECISION;
                emit SocializedLossApplied(marketId, positionNotional, user);

                emit LiquidationExecuted(user, marketId, liquidator, totalLoss, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, 0, entryPrice, 0);
                return;
            }
        }
        // no short position found; ignore
    }

    function liquidateLong(
        address user,
        bytes32 marketId,
        address liquidator
    ) external onlyRole(ORDERBOOK_ROLE) {
        PositionManager.Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].marketId == marketId && positions[i].size > 0) {
                int256 oldSize = positions[i].size;
                uint256 locked = userMarginByMarket[user][marketId];
                uint256 entryPrice = positions[i].entryPrice;
                uint256 markPrice = getMarkPrice(marketId);

                // Calculate trading loss first
                uint256 tradingLoss = 0;
                if (markPrice < entryPrice) {
                    // Long position loss: (entry price - current price) * position size
                    uint256 lossPerUnit = entryPrice - markPrice;
                    tradingLoss = (lossPerUnit * uint256(oldSize)) / (DECIMAL_SCALE * TICK_PRECISION); // Convert to USDC decimals
                }
                
                // Apply liquidation penalty on top of trading loss
                uint256 penalty = (locked * LIQUIDATION_PENALTY_BPS) / 10000;
                uint256 totalLoss = tradingLoss + penalty;
                
                // Cap total loss at user's available collateral
                if (totalLoss > userCollateral[user]) {
                    totalLoss = userCollateral[user];
                }
                
                if (totalLoss > 0) {
                    userCollateral[user] -= totalLoss;
                    // Give liquidator the penalty portion only, trading loss is socialized
                    uint256 liquidatorReward = penalty;
                    if (liquidatorReward > totalLoss) {
                        liquidatorReward = totalLoss;
                    }
                    if (liquidatorReward > 0) {
                        userCollateral[liquidator] += liquidatorReward;
                    }
                }

                // Release all locked margin and remove position
                userMarginByMarket[user][marketId] = 0;
                if (locked <= totalMarginLocked) {
                    totalMarginLocked -= locked;
                }
                if (i < positions.length - 1) {
                    positions[i] = positions[positions.length - 1];
                }
                positions.pop();

                // Remove market ID from user's market list
                _removeMarketIdFromUser(user, marketId);

                address ob = marketToOrderBook[marketId];
                if (ob != address(0)) {
                    try IOrderBook(ob).clearUserPosition(user) {} catch {}
                }

                // Apply socialized loss for the uncovered position
                uint256 positionNotional = uint256(oldSize) * entryPrice / TICK_PRECISION;
                emit SocializedLossApplied(marketId, positionNotional, user);

                emit LiquidationExecuted(user, marketId, liquidator, totalLoss, userCollateral[user]);
                emit PositionUpdated(user, marketId, oldSize, 0, entryPrice, 0);
                return;
            }
        }
        // no long position found; ignore
    }

    // ============ Internal Helper Functions ============
    
    /**
     * @dev Remove market ID from user's market list (helper for position closure)
     * @param user User address
     * @param marketId Market ID to remove
     */
    function _removeMarketIdFromUser(address user, bytes32 marketId) internal {
        bytes32[] storage marketIds = userMarketIds[user];
        for (uint256 j = 0; j < marketIds.length; j++) {
            if (marketIds[j] == marketId) {
                // Remove by swapping with last element and popping
                if (j < marketIds.length - 1) {
                    marketIds[j] = marketIds[marketIds.length - 1];
                }
                marketIds.pop();
                break;
            }
        }
    }
}
