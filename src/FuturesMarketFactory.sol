// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OrderBook.sol";
import "./CentralizedVault.sol";

// UMA Oracle interface
interface IOptimisticOracleV3 {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        address currency,
        uint256 reward
    ) external returns (bytes32 requestId);
    
    function settleRequest(bytes32 requestId) external;
    function getPrice(bytes32 requestId) external view returns (int256);
}

// Generic Oracle interface  
interface IPriceOracle {
    function getPrice(bytes32 identifier) external view returns (uint256 price, uint256 timestamp);
    function requestPriceUpdate(bytes32 identifier, string memory metricUrl) external;
}

/**
 * @title FuturesMarketFactory
 * @dev Factory contract for creating custom futures markets with dedicated OrderBooks
 * @notice Allows users to create and trade custom metric futures with margin support
 */
contract FuturesMarketFactory {
    // ============ State Variables ============
    
    CentralizedVault public immutable vault;
    address public admin;
    address public feeRecipient;
    
    // Default trading parameters - Conservative defaults (1:1 margin, no leverage)
    uint256 public defaultMarginRequirementBps = 10000; // 100% margin requirement (1:1)
    uint256 public defaultTradingFee = 10; // 0.1%
    bool public defaultLeverageEnabled = false; // Leverage disabled by default
    
    // Futures market tracking
    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => bytes32) public orderBookToMarket;
    mapping(bytes32 => bool) public marketExists;
    mapping(bytes32 => address) public marketCreators; // Track who created each market
    mapping(bytes32 => string) public marketSymbols; // Store market symbols
    mapping(address => bytes32[]) public userCreatedMarkets; // Markets created by each user
    
    // Enhanced market metadata
    mapping(bytes32 => string) public marketMetricUrls; // Single source of truth URL for each market
    mapping(bytes32 => uint256) public marketSettlementDates; // Settlement end date (timestamp)
    mapping(bytes32 => uint256) public marketStartPrices; // Start price when market was created
    mapping(bytes32 => uint256) public marketCreationTimestamps; // When market was created
    mapping(bytes32 => string) public marketDataSources; // Data source categorization
    mapping(bytes32 => string[]) public marketTags; // Tags for discovery
    mapping(bytes32 => bool) public isCustomMetric; // True for custom metrics, false for standard
    
    // Oracle integration
    mapping(bytes32 => address) public marketOracles; // Custom oracle per market
    mapping(bytes32 => bytes32) public umaRequestIds; // UMA request IDs for settlement
    mapping(bytes32 => bool) public marketSettled; // Settlement status
    mapping(bytes32 => uint256) public finalSettlementPrices; // Final settlement prices
    
    // Global oracle settings
    IOptimisticOracleV3 public umaOracle;
    IPriceOracle public defaultOracle;
    address public oracleAdmin;
    uint256 public defaultOracleReward = 10 * 10**6; // 10 USDC reward for UMA requests
    
    address[] public allOrderBooks;
    bytes32[] public allMarkets;
    
    // Market creation settings
    uint256 public marketCreationFee = 100 * 10**6; // 100 USDC fee to create market
    bool public publicMarketCreation = true; // Allow anyone to create markets
    
    // ============ Events ============
    
    event FuturesMarketCreated(
        address indexed orderBook,
        bytes32 indexed marketId,
        string marketSymbol,
        address indexed creator,
        uint256 creationFee,
        string metricUrl,
        uint256 settlementDate,
        uint256 startPrice
    );
    event FuturesMarketDeactivated(address indexed orderBook, bytes32 indexed marketId, address indexed creator);
    event DefaultParametersUpdated(uint256 marginRequirement, uint256 tradingFee);
    event MarketCreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event PublicMarketCreationToggled(bool enabled);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    
    // Oracle and settlement events
    event OracleConfigurationUpdated(address indexed umaOracle, address indexed defaultOracle, address indexed oracleAdmin);
    event MarketSettlementRequested(bytes32 indexed marketId, bytes32 indexed umaRequestId, address indexed requestor);
    event MarketSettled(bytes32 indexed marketId, uint256 finalPrice, address indexed settler);
    event CustomOracleAssigned(bytes32 indexed marketId, address indexed oracle);
    event EmergencyPriceUpdate(bytes32 indexed marketId, uint256 price, string reason);
    
    // ============ Modifiers ============
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "FuturesMarketFactory: only admin");
        _;
    }
    
    modifier canCreateMarket() {
        require(publicMarketCreation || msg.sender == admin, "FuturesMarketFactory: market creation restricted");
        _;
    }
    
    modifier validMarketSymbol(string memory symbol) {
        require(bytes(symbol).length > 0, "FuturesMarketFactory: empty market symbol");
        require(bytes(symbol).length <= 64, "FuturesMarketFactory: market symbol too long");
        _;
    }
    
    modifier validMetricUrl(string memory url) {
        require(bytes(url).length > 0, "FuturesMarketFactory: empty metric URL");
        require(bytes(url).length <= 256, "FuturesMarketFactory: metric URL too long");
        _;
    }
    
    modifier validSettlementDate(uint256 settlementDate) {
        require(settlementDate > block.timestamp, "FuturesMarketFactory: settlement date must be in future");
        require(settlementDate <= block.timestamp + 365 days, "FuturesMarketFactory: settlement date too far in future");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        address _vault,
        address _admin,
        address _feeRecipient
    ) {
        require(_vault != address(0), "FuturesMarketFactory: vault cannot be zero address");
        require(_admin != address(0), "FuturesMarketFactory: admin cannot be zero address");
        require(_feeRecipient != address(0), "FuturesMarketFactory: fee recipient cannot be zero address");
        
        vault = CentralizedVault(_vault);
        admin = _admin;
        feeRecipient = _feeRecipient;
    }
    
    // ============ Futures Market Creation ============
    
    /**
     * @dev Create a new futures market with dedicated OrderBook
     * @param marketSymbol Human-readable market symbol (e.g., "TESLA-STOCK-PRICE-EOY")
     * @param metricUrl URL to the single source of truth for this metric
     * @param settlementDate Unix timestamp when the market settles
     * @param startPrice Initial price for the metric (with 6 USDC decimals)
     * @param dataSource Data source category (e.g., "NASDAQ", "COINBASE", "CUSTOM")
     * @param tags Array of tags for market discovery
     * @param marginRequirementBps Margin requirement in basis points (optional, uses default if 0)
     * @param tradingFee Trading fee in basis points (optional, uses default if 0)
     * @return orderBook Address of the created OrderBook
     * @return marketId Generated market ID
     */
    function createFuturesMarket(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        uint256 marginRequirementBps,
        uint256 tradingFee
    ) external 
        canCreateMarket 
        validMarketSymbol(marketSymbol) 
        validMetricUrl(metricUrl)
        validSettlementDate(settlementDate)
        returns (address orderBook, bytes32 marketId) {
        require(startPrice > 0, "FuturesMarketFactory: start price must be positive");
        require(bytes(dataSource).length > 0, "FuturesMarketFactory: data source cannot be empty");
        require(tags.length <= 10, "FuturesMarketFactory: too many tags");
        // Collect market creation fee if enabled
        if (marketCreationFee > 0 && msg.sender != admin) {
            vault.deductFees(msg.sender, marketCreationFee, feeRecipient);
        }
        
        // Generate unique market ID from symbol, URL, and creator
        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, msg.sender, block.timestamp, block.number));
        require(!marketExists[marketId], "FuturesMarketFactory: market ID collision");
        
        // Use default parameters if not specified
        if (marginRequirementBps == 0) {
            marginRequirementBps = defaultMarginRequirementBps;
        }
        if (tradingFee == 0) {
            tradingFee = defaultTradingFee;
        }
        
        // Validate parameters - Allow up to 100% margin requirement for conservative markets
        require(marginRequirementBps >= 1000 && marginRequirementBps <= 10000, "FuturesMarketFactory: invalid margin requirement"); // 10% to 100%
        require(tradingFee <= 1000, "FuturesMarketFactory: trading fee too high"); // Max 10%
        
        // Deploy new OrderBook
        orderBook = address(new OrderBook(
            address(vault),
            marketId,
            feeRecipient
        ));
        
        // Register with vault
        vault.registerOrderBook(orderBook);
        vault.assignMarketToOrderBook(marketId, orderBook);
        
        // Update trading parameters if different from defaults
        if (marginRequirementBps != defaultMarginRequirementBps || 
            tradingFee != defaultTradingFee) {
            OrderBook(orderBook).updateTradingParameters(
                marginRequirementBps,
                tradingFee,
                feeRecipient
            );
        }
        
        // Update tracking
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarket[orderBook] = marketId;
        marketExists[marketId] = true;
        marketCreators[marketId] = msg.sender;
        marketSymbols[marketId] = marketSymbol;
        userCreatedMarkets[msg.sender].push(marketId);
        allOrderBooks.push(orderBook);
        allMarkets.push(marketId);
        
        // Store enhanced metadata
        marketMetricUrls[marketId] = metricUrl;
        marketSettlementDates[marketId] = settlementDate;
        marketStartPrices[marketId] = startPrice;
        marketCreationTimestamps[marketId] = block.timestamp;
        marketDataSources[marketId] = dataSource;
        marketTags[marketId] = tags;
        isCustomMetric[marketId] = true; // All user-created markets are custom metrics
        
        // Set initial mark price in vault
        vault.updateMarkPrice(marketId, startPrice);
        
        emit FuturesMarketCreated(
            orderBook, 
            marketId, 
            marketSymbol, 
            msg.sender, 
            marketCreationFee,
            metricUrl,
            settlementDate,
            startPrice
        );
        
        return (orderBook, marketId);
    }
    
    /**
     * @dev Deactivate a futures market (emergency function or by creator)
     * @param orderBook Address of the OrderBook to deactivate
     */
    function deactivateFuturesMarket(address orderBook) external {
        require(orderBook != address(0), "FuturesMarketFactory: invalid OrderBook address");
        
        bytes32 marketId = orderBookToMarket[orderBook];
        require(marketId != bytes32(0), "FuturesMarketFactory: OrderBook not found");
        
        // Only admin or market creator can deactivate
        require(
            msg.sender == admin || msg.sender == marketCreators[marketId],
            "FuturesMarketFactory: only admin or creator can deactivate"
        );
        
        // Deregister from vault
        vault.deregisterOrderBook(orderBook);
        
        // Update tracking
        delete marketToOrderBook[marketId];
        delete orderBookToMarket[orderBook];
        marketExists[marketId] = false;
        
        // Remove from arrays
        for (uint256 i = 0; i < allOrderBooks.length; i++) {
            if (allOrderBooks[i] == orderBook) {
                allOrderBooks[i] = allOrderBooks[allOrderBooks.length - 1];
                allOrderBooks.pop();
                break;
            }
        }
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (allMarkets[i] == marketId) {
                allMarkets[i] = allMarkets[allMarkets.length - 1];
                allMarkets.pop();
                break;
            }
        }
        
        emit FuturesMarketDeactivated(orderBook, marketId, marketCreators[marketId]);
    }
    
    // ============ Oracle Integration Functions ============
    
    /**
     * @dev Configure oracle settings
     * @param _umaOracle UMA Optimistic Oracle V3 address
     * @param _defaultOracle Default price oracle address
     * @param _oracleAdmin Oracle admin address
     */
    function configureOracles(
        address _umaOracle,
        address _defaultOracle,
        address _oracleAdmin
    ) external onlyAdmin {
        umaOracle = IOptimisticOracleV3(_umaOracle);
        defaultOracle = IPriceOracle(_defaultOracle);
        oracleAdmin = _oracleAdmin;
        
        emit OracleConfigurationUpdated(_umaOracle, _defaultOracle, _oracleAdmin);
    }
    
    /**
     * @dev Assign custom oracle to a market
     * @param marketId Market identifier
     * @param oracle Custom oracle address
     */
    function assignCustomOracle(bytes32 marketId, address oracle) external {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(
            msg.sender == marketCreators[marketId] || msg.sender == admin,
            "FuturesMarketFactory: only creator or admin can assign oracle"
        );
        
        marketOracles[marketId] = oracle;
        emit CustomOracleAssigned(marketId, oracle);
    }
    
    /**
     * @dev Request settlement via UMA oracle
     * @param marketId Market identifier
     */
    function requestUMASettlement(bytes32 marketId) external {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(!marketSettled[marketId], "FuturesMarketFactory: market already settled");
        require(
            block.timestamp >= marketSettlementDates[marketId],
            "FuturesMarketFactory: settlement date not reached"
        );
        require(address(umaOracle) != address(0), "FuturesMarketFactory: UMA oracle not configured");
        
        // Create UMA request
        bytes memory ancillaryData = abi.encodePacked(
            "Metric URL: ", marketMetricUrls[marketId],
            ", Market: ", marketSymbols[marketId],
            ", Settlement Date: ", marketSettlementDates[marketId]
        );
        
        bytes32 requestId = umaOracle.requestPrice(
            marketId, // Use marketId as identifier
            marketSettlementDates[marketId],
            ancillaryData,
            address(vault.collateralToken()),
            defaultOracleReward
        );
        
        umaRequestIds[marketId] = requestId;
        
        emit MarketSettlementRequested(marketId, requestId, msg.sender);
    }
    
    /**
     * @dev Settle market with UMA oracle result
     * @param marketId Market identifier
     */
    function settleMarketWithUMA(bytes32 marketId) external {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(!marketSettled[marketId], "FuturesMarketFactory: market already settled");
        require(umaRequestIds[marketId] != bytes32(0), "FuturesMarketFactory: no UMA request found");
        
        // Get price from UMA oracle
        int256 oraclePrice = umaOracle.getPrice(umaRequestIds[marketId]);
        require(oraclePrice > 0, "FuturesMarketFactory: invalid oracle price");
        
        uint256 finalPrice = uint256(oraclePrice);
        
        // Settle the market
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    /**
     * @dev Manual settlement by oracle admin
     * @param marketId Market identifier
     * @param finalPrice Final settlement price
     */
    function manualSettle(bytes32 marketId, uint256 finalPrice) external {
        require(
            msg.sender == oracleAdmin || msg.sender == admin,
            "FuturesMarketFactory: only oracle admin can manually settle"
        );
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(!marketSettled[marketId], "FuturesMarketFactory: market already settled");
        require(
            block.timestamp >= marketSettlementDates[marketId],
            "FuturesMarketFactory: settlement date not reached"
        );
        require(finalPrice > 0, "FuturesMarketFactory: invalid final price");
        
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    /**
     * @dev Internal function to settle a market
     * @param marketId Market identifier
     * @param finalPrice Final settlement price
     */
    function _settleMarket(bytes32 marketId, uint256 finalPrice) internal {
        marketSettled[marketId] = true;
        finalSettlementPrices[marketId] = finalPrice;
        
        // Update final mark price in vault
        vault.updateMarkPrice(marketId, finalPrice);
        
        // TODO: Implement position settlement logic
        // This would calculate P&L for all positions and settle them
    }
    
    // ============ Administrative Functions ============
    
    /**
     * @dev Update default trading parameters for new OrderBooks
     * @param marginRequirementBps Default margin requirement in basis points
     * @param tradingFee Default trading fee in basis points
     */
    function updateDefaultParameters(
        uint256 marginRequirementBps,
        uint256 tradingFee
    ) external onlyAdmin {
        require(marginRequirementBps >= 1000 && marginRequirementBps <= 10000, "FuturesMarketFactory: invalid default margin requirement");
        require(tradingFee <= 1000, "FuturesMarketFactory: trading fee too high");
        
        defaultMarginRequirementBps = marginRequirementBps;
        defaultTradingFee = tradingFee;
        
        emit DefaultParametersUpdated(marginRequirementBps, tradingFee);
    }
    
    /**
     * @dev Update market creation fee
     * @param newFee New market creation fee in USDC
     */
    function updateMarketCreationFee(uint256 newFee) external onlyAdmin {
        uint256 oldFee = marketCreationFee;
        marketCreationFee = newFee;
        emit MarketCreationFeeUpdated(oldFee, newFee);
    }
    
    /**
     * @dev Toggle public market creation
     * @param enabled Whether public market creation is enabled
     */
    function togglePublicMarketCreation(bool enabled) external onlyAdmin {
        publicMarketCreation = enabled;
        emit PublicMarketCreationToggled(enabled);
    }
    
    /**
     * @dev Update admin address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "OrderBookFactory: admin cannot be zero address");
        
        address oldAdmin = admin;
        admin = newAdmin;
        
        emit AdminUpdated(oldAdmin, newAdmin);
    }
    
    /**
     * @dev Update fee recipient address
     * @param newFeeRecipient New fee recipient address
     */
    function updateFeeRecipient(address newFeeRecipient) external onlyAdmin {
        require(newFeeRecipient != address(0), "OrderBookFactory: fee recipient cannot be zero address");
        
        address oldRecipient = feeRecipient;
        feeRecipient = newFeeRecipient;
        
        emit FeeRecipientUpdated(oldRecipient, newFeeRecipient);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get OrderBook address for a market
     * @param marketId Market identifier
     * @return OrderBook address (address(0) if not found)
     */
    function getOrderBookForMarket(bytes32 marketId) external view returns (address) {
        return marketToOrderBook[marketId];
    }
    
    /**
     * @dev Get market ID for an OrderBook
     * @param orderBook OrderBook address
     * @return Market ID (bytes32(0) if not found)
     */
    function getMarketForOrderBook(address orderBook) external view returns (bytes32) {
        return orderBookToMarket[orderBook];
    }
    
    /**
     * @dev Get all OrderBook addresses
     * @return Array of OrderBook addresses
     */
    function getAllOrderBooks() external view returns (address[] memory) {
        return allOrderBooks;
    }
    
    /**
     * @dev Get all market IDs
     * @return Array of market IDs
     */
    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarkets;
    }
    
    /**
     * @dev Get total number of OrderBooks
     * @return Number of OrderBooks
     */
    function getOrderBookCount() external view returns (uint256) {
        return allOrderBooks.length;
    }
    
    /**
     * @dev Check if a market exists
     * @param marketId Market identifier
     * @return True if market exists
     */
    function doesMarketExist(bytes32 marketId) external view returns (bool) {
        return marketExists[marketId];
    }
    
    /**
     * @dev Get default trading parameters
     * @return marginRequirement Default margin requirement in basis points
     * @return fee Default trading fee in basis points
     */
    function getDefaultParameters() external view returns (uint256 marginRequirement, uint256 fee) {
        return (defaultMarginRequirementBps, defaultTradingFee);
    }
    
    /**
     * @dev Get market creator
     * @param marketId Market identifier
     * @return Creator address
     */
    function getMarketCreator(bytes32 marketId) external view returns (address) {
        return marketCreators[marketId];
    }
    
    /**
     * @dev Get market symbol
     * @param marketId Market identifier
     * @return Market symbol string
     */
    function getMarketSymbol(bytes32 marketId) external view returns (string memory) {
        return marketSymbols[marketId];
    }
    
    /**
     * @dev Get metric URL for a market (single source of truth)
     * @param marketId Market identifier
     * @return Metric URL string
     */
    function getMarketMetricUrl(bytes32 marketId) external view returns (string memory) {
        return marketMetricUrls[marketId];
    }
    
    /**
     * @dev Get settlement date for a market
     * @param marketId Market identifier
     * @return Settlement date timestamp
     */
    function getMarketSettlementDate(bytes32 marketId) external view returns (uint256) {
        return marketSettlementDates[marketId];
    }
    
    /**
     * @dev Get start price for a market
     * @param marketId Market identifier
     * @return Start price (6 USDC decimals)
     */
    function getMarketStartPrice(bytes32 marketId) external view returns (uint256) {
        return marketStartPrices[marketId];
    }
    
    /**
     * @dev Get market creation timestamp
     * @param marketId Market identifier
     * @return Creation timestamp
     */
    function getMarketCreationTimestamp(bytes32 marketId) external view returns (uint256) {
        return marketCreationTimestamps[marketId];
    }
    
    /**
     * @dev Check if a market has settled (past settlement date)
     * @param marketId Market identifier
     * @return True if market has settled
     */
    function isMarketSettled(bytes32 marketId) external view returns (bool) {
        return block.timestamp >= marketSettlementDates[marketId];
    }
    
    /**
     * @dev Get time remaining until settlement
     * @param marketId Market identifier
     * @return Time remaining in seconds (0 if already settled)
     */
    function getTimeToSettlement(bytes32 marketId) external view returns (uint256) {
        uint256 settlementDate = marketSettlementDates[marketId];
        if (block.timestamp >= settlementDate) {
            return 0;
        }
        return settlementDate - block.timestamp;
    }
    
    /**
     * @dev Get data source for a market
     * @param marketId Market identifier
     * @return Data source string
     */
    function getMarketDataSource(bytes32 marketId) external view returns (string memory) {
        return marketDataSources[marketId];
    }
    
    /**
     * @dev Get tags for a market
     * @param marketId Market identifier
     * @return Array of tag strings
     */
    function getMarketTags(bytes32 marketId) external view returns (string[] memory) {
        return marketTags[marketId];
    }
    
    /**
     * @dev Get settlement status and final price
     * @param marketId Market identifier
     * @return settled Whether market is settled
     * @return finalPrice Final settlement price (0 if not settled)
     */
    function getMarketSettlementInfo(bytes32 marketId) external view returns (bool settled, uint256 finalPrice) {
        return (marketSettled[marketId], finalSettlementPrices[marketId]);
    }
    
    /**
     * @dev Get markets created by a user
     * @param creator Creator address
     * @return Array of market IDs created by the user
     */
    function getUserCreatedMarkets(address creator) external view returns (bytes32[] memory) {
        return userCreatedMarkets[creator];
    }
    
    // ============ Market Discovery Functions ============
    
    /**
     * @dev Get all custom metric markets
     * @return Array of custom metric market IDs
     */
    function getCustomMetricMarkets() external view returns (bytes32[] memory) {
        return _getMarketsByType(true);
    }
    
    /**
     * @dev Get all standard markets
     * @return Array of standard market IDs
     */
    function getStandardMarkets() external view returns (bytes32[] memory) {
        return _getMarketsByType(false);
    }
    
    /**
     * @dev Get markets by data source
     * @param dataSource Data source to filter by
     * @return Array of market IDs from the specified data source
     */
    function getMarketsByDataSource(string memory dataSource) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (_compareStrings(marketDataSources[allMarkets[i]], dataSource)) {
                count++;
            }
        }
        
        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (_compareStrings(marketDataSources[allMarkets[i]], dataSource)) {
                filtered[index] = allMarkets[i];
                index++;
            }
        }
        
        return filtered;
    }
    
    /**
     * @dev Get markets containing a specific tag
     * @param tag Tag to search for
     * @return Array of market IDs containing the tag
     */
    function getMarketsByTag(string memory tag) external view returns (bytes32[] memory) {
        uint256 count = 0;
        
        // Count matching markets
        for (uint256 i = 0; i < allMarkets.length; i++) {
            string[] memory tags = marketTags[allMarkets[i]];
            for (uint256 j = 0; j < tags.length; j++) {
                if (_compareStrings(tags[j], tag)) {
                    count++;
                    break;
                }
            }
        }
        
        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        
        // Collect matching markets
        for (uint256 i = 0; i < allMarkets.length; i++) {
            string[] memory tags = marketTags[allMarkets[i]];
            for (uint256 j = 0; j < tags.length; j++) {
                if (_compareStrings(tags[j], tag)) {
                    filtered[index] = allMarkets[i];
                    index++;
                    break;
                }
            }
        }
        
        return filtered;
    }
    
    /**
     * @dev Get markets settling within a time range
     * @param fromTimestamp Start of time range
     * @param toTimestamp End of time range
     * @return Array of market IDs settling in the range
     */
    function getMarketsBySettlementRange(
        uint256 fromTimestamp,
        uint256 toTimestamp
    ) external view returns (bytes32[] memory) {
        require(fromTimestamp <= toTimestamp, "FuturesMarketFactory: invalid time range");
        
        uint256 count = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            uint256 settlementDate = marketSettlementDates[allMarkets[i]];
            if (settlementDate >= fromTimestamp && settlementDate <= toTimestamp) {
                count++;
            }
        }
        
        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            uint256 settlementDate = marketSettlementDates[allMarkets[i]];
            if (settlementDate >= fromTimestamp && settlementDate <= toTimestamp) {
                filtered[index] = allMarkets[i];
                index++;
            }
        }
        
        return filtered;
    }
    
    /**
     * @dev Get active (unsettled) markets
     * @return Array of active market IDs
     */
    function getActiveMarkets() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]] && block.timestamp < marketSettlementDates[allMarkets[i]]) {
                count++;
            }
        }
        
        bytes32[] memory active = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]] && block.timestamp < marketSettlementDates[allMarkets[i]]) {
                active[index] = allMarkets[i];
                index++;
            }
        }
        
        return active;
    }
    
    /**
     * @dev Get markets ready for settlement
     * @return Array of market IDs ready for settlement
     */
    function getMarketsReadyForSettlement() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]] && block.timestamp >= marketSettlementDates[allMarkets[i]]) {
                count++;
            }
        }
        
        bytes32[] memory ready = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]] && block.timestamp >= marketSettlementDates[allMarkets[i]]) {
                ready[index] = allMarkets[i];
                index++;
            }
        }
        
        return ready;
    }
    
    /**
     * @dev Get market creation settings
     * @return creationFee Market creation fee
     * @return publicCreation Whether public creation is enabled
     */
    function getMarketCreationSettings() external view returns (uint256 creationFee, bool publicCreation) {
        return (marketCreationFee, publicMarketCreation);
    }
    
    /**
     * @dev Get comprehensive market details
     * @param marketId Market identifier
     * @return orderBook OrderBook address
     * @return creator Market creator
     * @return symbol Market symbol
     * @return metricUrl Metric URL (source of truth)
     * @return settlementDate Settlement timestamp
     * @return startPrice Start price (6 USDC decimals)
     * @return creationTimestamp When market was created
     * @return exists Whether market exists
     */
    function getMarketDetails(bytes32 marketId) external view returns (
        address orderBook,
        address creator,
        string memory symbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        uint256 creationTimestamp,
        bool exists
    ) {
        return (
            marketToOrderBook[marketId],
            marketCreators[marketId],
            marketSymbols[marketId],
            marketMetricUrls[marketId],
            marketSettlementDates[marketId],
            marketStartPrices[marketId],
            marketCreationTimestamps[marketId],
            marketExists[marketId]
        );
    }
    
    /**
     * @dev Get market metadata only
     * @param marketId Market identifier
     * @return symbol Market symbol
     * @return metricUrl Metric URL (source of truth)
     * @return settlementDate Settlement timestamp
     * @return startPrice Start price (6 USDC decimals)
     * @return settled Whether market has settled
     */
    function getMarketMetadata(bytes32 marketId) external view returns (
        string memory symbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        bool settled
    ) {
        return (
            marketSymbols[marketId],
            marketMetricUrls[marketId],
            marketSettlementDates[marketId],
            marketStartPrices[marketId],
            block.timestamp >= marketSettlementDates[marketId]
        );
    }
    
    // ============ Robust Oracle Management Functions ============
    
    /**
     * @dev Set oracle reward amount for UMA requests
     * @param rewardAmount New reward amount in USDC
     */
    function setOracleReward(uint256 rewardAmount) external onlyAdmin {
        require(rewardAmount > 0, "FuturesMarketFactory: reward must be positive");
        defaultOracleReward = rewardAmount;
    }
    
    /**
     * @dev Update oracle admin
     * @param newOracleAdmin New oracle admin address
     */
    function updateOracleAdmin(address newOracleAdmin) external onlyAdmin {
        require(newOracleAdmin != address(0), "FuturesMarketFactory: oracle admin cannot be zero");
        oracleAdmin = newOracleAdmin;
    }
    
    /**
     * @dev Force price update for a market using default oracle
     * @param marketId Market identifier
     */
    function requestPriceUpdate(bytes32 marketId) external {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(address(defaultOracle) != address(0), "FuturesMarketFactory: default oracle not configured");
        
        defaultOracle.requestPriceUpdate(marketId, marketMetricUrls[marketId]);
    }
    
    /**
     * @dev Get current price from market's oracle
     * @param marketId Market identifier
     * @return price Current price
     * @return timestamp Price timestamp
     */
    function getCurrentOraclePrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        
        // Try custom oracle first
        if (marketOracles[marketId] != address(0)) {
            return IPriceOracle(marketOracles[marketId]).getPrice(marketId);
        }
        
        // Fall back to default oracle
        if (address(defaultOracle) != address(0)) {
            return defaultOracle.getPrice(marketId);
        }
        
        // Return vault mark price as fallback
        return (vault.marketMarkPrices(marketId), block.timestamp);
    }
    
    /**
     * @dev Get oracle configuration for a market
     * @param marketId Market identifier
     * @return customOracle Custom oracle address (address(0) if none)
     * @return umaRequestId UMA request ID (bytes32(0) if none)
     * @return hasUmaRequest Whether market has pending UMA request
     */
    function getMarketOracleConfig(bytes32 marketId) external view returns (
        address customOracle,
        bytes32 umaRequestId,
        bool hasUmaRequest
    ) {
        return (
            marketOracles[marketId],
            umaRequestIds[marketId],
            umaRequestIds[marketId] != bytes32(0)
        );
    }
    
    /**
     * @dev Get all oracle-related information for a market
     * @param marketId Market identifier
     * @return customOracle Custom oracle address
     * @return defaultOracleAddr Default oracle address
     * @return umaOracleAddr UMA oracle address
     * @return currentPrice Current oracle price
     * @return priceTimestamp Price timestamp
     * @return isSettlementReady Whether market is ready for settlement
     */
    function getMarketOracleInfo(bytes32 marketId) external view returns (
        address customOracle,
        address defaultOracleAddr,
        address umaOracleAddr,
        uint256 currentPrice,
        uint256 priceTimestamp,
        bool isSettlementReady
    ) {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        
        // Get current price
        (currentPrice, priceTimestamp) = this.getCurrentOraclePrice(marketId);
        
        return (
            marketOracles[marketId],
            address(defaultOracle),
            address(umaOracle),
            currentPrice,
            priceTimestamp,
            block.timestamp >= marketSettlementDates[marketId] && !marketSettled[marketId]
        );
    }
    
    /**
     * @dev Update multiple market prices via oracle admin
     * @param marketIds Array of market identifiers
     * @param prices Array of new prices
     */
    function batchUpdatePrices(bytes32[] memory marketIds, uint256[] memory prices) external {
        require(
            msg.sender == oracleAdmin || msg.sender == admin,
            "FuturesMarketFactory: only oracle admin can batch update"
        );
        require(marketIds.length == prices.length, "FuturesMarketFactory: arrays length mismatch");
        
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (marketExists[marketIds[i]] && !marketSettled[marketIds[i]]) {
                vault.updateMarkPrice(marketIds[i], prices[i]);
            }
        }
    }
    
    /**
     * @dev Get markets requiring oracle updates (price older than threshold)
     * @param maxAge Maximum age in seconds for price to be considered fresh
     * @return Array of market IDs needing price updates
     */
    function getMarketsNeedingPriceUpdate(uint256 maxAge) external view returns (bytes32[] memory) {
        uint256 count = 0;
        uint256 cutoffTime = block.timestamp - maxAge;
        
        // Count markets needing updates
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]]) {
                (, uint256 timestamp) = this.getCurrentOraclePrice(allMarkets[i]);
                if (timestamp < cutoffTime) {
                    count++;
                }
            }
        }
        
        bytes32[] memory staleMarkets = new bytes32[](count);
        uint256 index = 0;
        
        // Collect markets needing updates
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (!marketSettled[allMarkets[i]]) {
                (, uint256 timestamp) = this.getCurrentOraclePrice(allMarkets[i]);
                if (timestamp < cutoffTime) {
                    staleMarkets[index] = allMarkets[i];
                    index++;
                }
            }
        }
        
        return staleMarkets;
    }
    
    /**
     * @dev Get oracle health status across all markets
     * @return totalMarkets Total number of markets
     * @return activeMarkets Number of active (unsettled) markets
     * @return marketsWithCustomOracles Number of markets with custom oracles
     * @return marketsWithUMARequests Number of markets with pending UMA requests
     * @return settledMarkets Number of settled markets
     */
    function getOracleHealthStatus() external view returns (
        uint256 totalMarkets,
        uint256 activeMarkets,
        uint256 marketsWithCustomOracles,
        uint256 marketsWithUMARequests,
        uint256 settledMarkets
    ) {
        totalMarkets = allMarkets.length;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            bytes32 marketId = allMarkets[i];
            
            if (!marketSettled[marketId] && block.timestamp < marketSettlementDates[marketId]) {
                activeMarkets++;
            }
            
            if (marketOracles[marketId] != address(0)) {
                marketsWithCustomOracles++;
            }
            
            if (umaRequestIds[marketId] != bytes32(0)) {
                marketsWithUMARequests++;
            }
            
            if (marketSettled[marketId]) {
                settledMarkets++;
            }
        }
    }
    
    /**
     * @dev Emergency oracle intervention - update price directly
     * @param marketId Market identifier
     * @param emergencyPrice Emergency price to set
     * @param reason Reason for emergency intervention
     */
    function emergencyPriceUpdate(
        bytes32 marketId,
        uint256 emergencyPrice,
        string memory reason
    ) external onlyAdmin {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(emergencyPrice > 0, "FuturesMarketFactory: price must be positive");
        require(bytes(reason).length > 0, "FuturesMarketFactory: reason required");
        
        vault.updateMarkPrice(marketId, emergencyPrice);
        
        // Emergency intervention logged via event
        emit EmergencyPriceUpdate(marketId, emergencyPrice, reason);
    }
    
    // ============ Internal Helper Functions ============
    
    /**
     * @dev Get markets by custom metric type
     * @param customType True for custom metrics, false for standard
     * @return Array of market IDs of the specified type
     */
    function _getMarketsByType(bool customType) internal view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (isCustomMetric[allMarkets[i]] == customType) {
                count++;
            }
        }
        
        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (isCustomMetric[allMarkets[i]] == customType) {
                filtered[index] = allMarkets[i];
                index++;
            }
        }
        
        return filtered;
    }
    
    /**
     * @dev Get markets by type (custom vs traditional)
     * @param customOnly If true, return only custom markets; if false, return traditional markets
     * @return marketIds Array of market IDs
     */
    function getMarketsByType(bool customOnly) external view returns (bytes32[] memory marketIds) {
        uint256 count = 0;
        
        // Count matching markets
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (isCustomMetric[allMarkets[i]] == customOnly) {
                count++;
            }
        }
        
        // Create array and populate
        marketIds = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            if (isCustomMetric[allMarkets[i]] == customOnly) {
                marketIds[index] = allMarkets[i];
                index++;
            }
        }
    }

    /**
     * @dev Get market information
     * @param marketId Market ID
     * @return name Market symbol
     * @return orderBookAddress OrderBook contract address
     */
    function getMarketInfo(bytes32 marketId) external view returns (string memory name, address orderBookAddress) {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        name = marketSymbols[marketId];
        orderBookAddress = marketToOrderBook[marketId];
    }

    /**
     * @dev Compare two strings for equality
     * @param a First string
     * @param b Second string
     * @return True if strings are equal
     */
    function _compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
    }

    // ============ Leverage Management Functions ============

    /**
     * @dev Enable leverage for a specific market
     * @param marketId Market identifier
     * @param maxLeverage Maximum leverage allowed (e.g., 10 for 10x)
     * @param marginRequirementBps New margin requirement in basis points
     */
    function enableMarketLeverage(
        bytes32 marketId,
        uint256 maxLeverage,
        uint256 marginRequirementBps
    ) external onlyAdmin {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(maxLeverage > 1 && maxLeverage <= 100, "FuturesMarketFactory: invalid max leverage");
        require(marginRequirementBps >= 100 && marginRequirementBps <= 10000, "FuturesMarketFactory: invalid margin requirement");
        require(marginRequirementBps <= (10000 / maxLeverage), "FuturesMarketFactory: margin requirement too low for max leverage");
        
        address orderBookAddress = marketToOrderBook[marketId];
        OrderBook orderBook = OrderBook(orderBookAddress);
        
        // Enable leverage on the OrderBook
        orderBook.enableLeverage(maxLeverage, marginRequirementBps);
        
        emit MarketLeverageEnabled(marketId, maxLeverage, marginRequirementBps);
    }

    /**
     * @dev Disable leverage for a specific market (revert to 1:1 margin)
     * @param marketId Market identifier
     */
    function disableMarketLeverage(bytes32 marketId) external onlyAdmin {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        
        address orderBookAddress = marketToOrderBook[marketId];
        OrderBook orderBook = OrderBook(orderBookAddress);
        
        // Disable leverage on the OrderBook
        orderBook.disableLeverage();
        
        emit MarketLeverageDisabled(marketId);
    }

    /**
     * @dev Set leverage controller for a specific market
     * @param marketId Market identifier
     * @param controller New leverage controller address
     */
    function setMarketLeverageController(
        bytes32 marketId,
        address controller
    ) external onlyAdmin {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        require(controller != address(0), "FuturesMarketFactory: invalid controller address");
        
        address orderBookAddress = marketToOrderBook[marketId];
        OrderBook orderBook = OrderBook(orderBookAddress);
        
        // Update leverage controller on the OrderBook
        orderBook.setLeverageController(controller);
        
        emit MarketLeverageControllerUpdated(marketId, controller);
    }

    /**
     * @dev Get leverage information for a market
     * @param marketId Market identifier
     * @return enabled Whether leverage is enabled
     * @return maxLeverage Maximum leverage allowed
     * @return marginRequirement Current margin requirement in basis points
     * @return controller Current leverage controller
     */
    function getMarketLeverageInfo(bytes32 marketId) external view returns (
        bool enabled,
        uint256 maxLeverage,
        uint256 marginRequirement,
        address controller
    ) {
        require(marketExists[marketId], "FuturesMarketFactory: market does not exist");
        
        address orderBookAddress = marketToOrderBook[marketId];
        OrderBook orderBook = OrderBook(orderBookAddress);
        
        return orderBook.getLeverageInfo();
    }

    /**
     * @dev Update default leverage settings for new markets
     * @param _defaultMarginRequirementBps New default margin requirement
     * @param _defaultLeverageEnabled Whether leverage should be enabled by default for new markets
     */
    function updateDefaultLeverageSettings(
        uint256 _defaultMarginRequirementBps,
        bool _defaultLeverageEnabled
    ) external onlyAdmin {
        require(_defaultMarginRequirementBps >= 1000 && _defaultMarginRequirementBps <= 10000, "FuturesMarketFactory: invalid default margin requirement");
        
        defaultMarginRequirementBps = _defaultMarginRequirementBps;
        defaultLeverageEnabled = _defaultLeverageEnabled;
        
        emit DefaultLeverageSettingsUpdated(_defaultMarginRequirementBps, _defaultLeverageEnabled);
    }

    // ============ Additional Events for Leverage Management ============
    
    event MarketLeverageEnabled(bytes32 indexed marketId, uint256 maxLeverage, uint256 marginRequirement);
    event MarketLeverageDisabled(bytes32 indexed marketId);
    event MarketLeverageControllerUpdated(bytes32 indexed marketId, address indexed controller);
    event DefaultLeverageSettingsUpdated(uint256 defaultMarginRequirement, bool defaultLeverageEnabled);
}
