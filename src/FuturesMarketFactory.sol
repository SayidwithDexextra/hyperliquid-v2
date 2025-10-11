// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./diamond/Diamond.sol";
import "./diamond/interfaces/IDiamondCut.sol";
import "./CoreVault.sol";
// OrderBook (Diamond) admin/view minimal interfaces
interface IOBAdminFacet {
    function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external;
    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) external;
    function disableLeverage() external;
    function setLeverageController(address _newController) external;
}

interface IOBViewFacet {
    function getLeverageInfo() external view returns (bool enabled, uint256 maxLev, uint256 marginReq, address controller);
}

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

// ============ Custom Errors (reduce bytecode vs long revert strings) ============
error OnlyAdmin();
error MarketCreationRestricted();
error InvalidMarketSymbol();
error InvalidMetricUrl();
error InvalidSettlementDate();
error ZeroAddress();
error InvalidInput();
error MarketIdCollision();
error MarketNotFound();
error NotAuthorized();
error OracleNotConfigured();
error SettlementNotReady();
error UmaRequestMissing();
error MarketAlreadySettledErr();
error InvalidOraclePrice();
error InvalidFinalPrice();
error InvalidMarginRequirement();
error TradingFeeTooHigh();
error InvalidLeverage();
error MarginTooLowForLeverage();
error RewardMustBePositive();
error ReasonRequired();
error UseCreateMarketDiamond();

/**
 * @title FuturesMarketFactory
 * @dev Factory contract for creating custom futures markets with dedicated OrderBooks
 * @notice Allows users to create and trade custom metric futures with margin support
 */
contract FuturesMarketFactory {
    // ============ State Variables ============
    
    CoreVault immutable vault;
    address admin;
    address feeRecipient;
    
    // Default trading parameters - Conservative defaults (1:1 margin, no leverage)
    uint256 defaultMarginRequirementBps = 10000; // 100% margin requirement (1:1)
    uint256 defaultTradingFee = 10; // 0.1%
    bool defaultLeverageEnabled = false; // Leverage disabled by default
    
    // Futures market tracking
    mapping(bytes32 => address) internal marketToOrderBook;
    mapping(address => bytes32) internal orderBookToMarket;
    mapping(bytes32 => bool) internal marketExists;
    mapping(bytes32 => address) internal marketCreators; // Track who created each market
    mapping(bytes32 => string) internal marketSymbols; // Store market symbols
    // removed: userCreatedMarkets tracking to reduce bytecode size
    
    // Enhanced market metadata
    mapping(bytes32 => string) internal marketMetricUrls; // Single source of truth URL for each market
    mapping(bytes32 => uint256) internal marketSettlementDates; // Settlement end date (timestamp)
    // removed: start prices, creation timestamps, data sources, tags, type flags to reduce bytecode
    
    // Oracle integration
    mapping(bytes32 => address) internal marketOracles; // Custom oracle per market
    mapping(bytes32 => bytes32) internal umaRequestIds; // UMA request IDs for settlement
    mapping(bytes32 => bool) internal marketSettled; // Settlement status
    // removed: finalSettlementPrices mapping to reduce bytecode
    
    // Global oracle settings
    IOptimisticOracleV3 internal umaOracle;
    IPriceOracle internal defaultOracle;
    address internal oracleAdmin;
    uint256 internal defaultOracleReward = 10 * 10**6; // 10 USDC reward for UMA requests
    
    // removed: allOrderBooks tracking to reduce bytecode
    bytes32[] internal allMarkets;
    
    // Market creation settings
    uint256 internal marketCreationFee = 100 * 10**6; // 100 USDC fee to create market
    bool internal publicMarketCreation = true; // Allow anyone to create markets
    
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
    // Admin/config events removed to reduce bytecode size
    
    // Oracle and settlement events
    // Auxiliary oracle events removed to reduce bytecode size
    event MarketSettled(bytes32 indexed marketId, uint256 finalPrice, address indexed settler);
    // Auxiliary oracle events removed to reduce bytecode size
    
    // ============ Modifiers ============
    
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }
    
    modifier canCreateMarket() {
        if (!(publicMarketCreation || msg.sender == admin)) revert MarketCreationRestricted();
        _;
    }
    
    modifier validMarketSymbol(string memory symbol) {
        uint256 len = bytes(symbol).length;
        if (len == 0 || len > 64) revert InvalidMarketSymbol();
        _;
    }
    
    modifier validMetricUrl(string memory url) {
        uint256 len = bytes(url).length;
        if (len == 0 || len > 256) revert InvalidMetricUrl();
        _;
    }
    
    modifier validSettlementDate(uint256 settlementDate) {
        if (settlementDate <= block.timestamp || settlementDate > block.timestamp + 365 days) revert InvalidSettlementDate();
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        address _vault,
        address _admin,
        address _feeRecipient
    ) {
        if (_vault == address(0) || _admin == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        
        vault = CoreVault(_vault);
        admin = _admin;
        feeRecipient = _feeRecipient;
    }
    
    // ============ Futures Market Creation ============
    
    /**
     * @dev Deprecated: use createFuturesMarketDiamond. Kept for backward compatibility.
     */
    function createFuturesMarket(
        string memory /*marketSymbol*/,
        string memory /*metricUrl*/,
        uint256 /*settlementDate*/,
        uint256 /*startPrice*/,
        string memory /*dataSource*/,
        string[] memory /*tags*/,
        uint256 /*marginRequirementBps*/,
        uint256 /*tradingFee*/
    ) external pure returns (address /*orderBook*/, bytes32 /*marketId*/) {
        // Deprecated: Factory no longer deploys EIP-1167 OrderBooks
        revert UseCreateMarketDiamond();
    }

    /**
     * @dev Create a new futures market using Diamond proxy pattern.
     * @param marketSymbol Human-readable market symbol
     * @param metricUrl Source-of-truth URL
     * @param settlementDate Settlement timestamp
     * @param startPrice Initial mark price (6 decimals)
     * @param dataSource Data source descriptor
     * @param tags Discovery tags
     * @param diamondOwner Owner of the Diamond (admin)
     * @param cut Initial facet cut describing facets and selectors
     * @param initFacet Address to run initialization delegatecall (e.g., OrderBookInitFacet)
     * @param initFacet Calldata param kept in docs for backwards compatibility (unused)
     */
    function createFuturesMarketDiamond(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        address diamondOwner,
        IDiamondCut.FacetCut[] memory cut,
        address initFacet,
        bytes memory /*initCalldata*/
    ) external 
        canCreateMarket
        validMarketSymbol(marketSymbol)
        validMetricUrl(metricUrl)
        validSettlementDate(settlementDate)
        returns (address orderBook, bytes32 marketId) 
    {
        if (startPrice == 0) revert InvalidOraclePrice();
        if (bytes(dataSource).length == 0) revert InvalidInput();
        if (tags.length > 10) revert InvalidInput();
        if (diamondOwner == address(0)) revert ZeroAddress();

        if (marketCreationFee > 0 && msg.sender != admin) {
            vault.deductFees(msg.sender, marketCreationFee, feeRecipient);
        }

        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, msg.sender, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        // Deploy Diamond with factory-computed initializer that includes the computed marketId
        if (initFacet == address(0)) revert ZeroAddress();
        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        // Register with vault and assign market
        vault.registerOrderBook(orderBook);
        vault.assignMarketToOrderBook(marketId, orderBook);

        // Update tracking and metadata
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarket[orderBook] = marketId;
        marketExists[marketId] = true;
        marketCreators[marketId] = msg.sender;
        marketSymbols[marketId] = marketSymbol;
        allMarkets.push(marketId);
        marketMetricUrls[marketId] = metricUrl;
        marketSettlementDates[marketId] = settlementDate;
        // metadata writes removed for bytecode reduction (startPrice, creationTs, dataSource, tags)

        vault.updateMarkPrice(marketId, startPrice);

        emit FuturesMarketCreated(orderBook, marketId, marketSymbol, msg.sender, marketCreationFee, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }
    
    /**
     * @dev Deactivate a futures market (emergency function or by creator)
     * @param orderBook Address of the OrderBook to deactivate
     */
    function deactivateFuturesMarket(address orderBook) external {
        if (orderBook == address(0)) revert ZeroAddress();
        
        bytes32 marketId = orderBookToMarket[orderBook];
        if (marketId == bytes32(0)) revert MarketNotFound();
        
        // Only admin or market creator can deactivate
        if (!(msg.sender == admin || msg.sender == marketCreators[marketId])) revert NotAuthorized();
        
        // Deregister from vault
        vault.deregisterOrderBook(orderBook);
        
        // Update tracking
        delete marketToOrderBook[marketId];
        delete orderBookToMarket[orderBook];
        marketExists[marketId] = false;
        
        // Remove from arrays (only markets retained)
        uint256 mLen = allMarkets.length;
        for (uint256 i = 0; i < mLen; ) {
            if (allMarkets[i] == marketId) {
                allMarkets[i] = allMarkets[allMarkets.length - 1];
                allMarkets.pop();
                break;
            }
            unchecked { ++i; }
        }
        
        // event omitted to reduce bytecode size
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
        
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Assign custom oracle to a market
     * @param marketId Market identifier
     * @param oracle Custom oracle address
     */
    function assignCustomOracle(bytes32 marketId, address oracle) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (!(msg.sender == marketCreators[marketId] || msg.sender == admin)) revert NotAuthorized();
        
        marketOracles[marketId] = oracle;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Request settlement via UMA oracle
     * @param marketId Market identifier
     */
    function requestUMASettlement(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (address(umaOracle) == address(0)) revert OracleNotConfigured();
        
        // Create UMA request
        bytes memory ancillaryData = abi.encodePacked(
            "URL:", marketMetricUrls[marketId],
            ",SYM:", marketSymbols[marketId],
            ",T:", marketSettlementDates[marketId]
        );
        
        bytes32 requestId = umaOracle.requestPrice(
            marketId, // Use marketId as identifier
            marketSettlementDates[marketId],
            ancillaryData,
            address(vault.collateralToken()),
            defaultOracleReward
        );
        
        umaRequestIds[marketId] = requestId;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Settle market with UMA oracle result
     * @param marketId Market identifier
     */
    function settleMarketWithUMA(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (umaRequestIds[marketId] == bytes32(0)) revert UmaRequestMissing();
        
        // Get price from UMA oracle
        int256 oraclePrice = umaOracle.getPrice(umaRequestIds[marketId]);
        if (oraclePrice <= 0) revert InvalidOraclePrice();
        
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
        if (!(msg.sender == oracleAdmin || msg.sender == admin)) revert NotAuthorized();
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (finalPrice == 0) revert InvalidFinalPrice();
        
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
        if (marginRequirementBps < 1000 || marginRequirementBps > 10000) revert InvalidMarginRequirement();
        if (tradingFee > 1000) revert TradingFeeTooHigh();
        
        defaultMarginRequirementBps = marginRequirementBps;
        defaultTradingFee = tradingFee;
        
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update market creation fee
     * @param newFee New market creation fee in USDC
     */
    function updateMarketCreationFee(uint256 newFee) external onlyAdmin {
        marketCreationFee = newFee;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Toggle public market creation
     * @param enabled Whether public market creation is enabled
     */
    function togglePublicMarketCreation(bool enabled) external onlyAdmin {
        publicMarketCreation = enabled;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update admin address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        
        admin = newAdmin;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update fee recipient address
     * @param newFeeRecipient New fee recipient address
     */
    function updateFeeRecipient(address newFeeRecipient) external onlyAdmin {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        
        feeRecipient = newFeeRecipient;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Set the OrderBook implementation used for EIP-1167 clones
     * @param implementation Address of deployed OrderBook logic contract (template)
     */
    // Removed: EIP-1167 clone template management. Factory only supports Diamond-based markets now.
    
    // ============ View Functions ============
    
    /**
     * @dev Get OrderBook address for a market
     * @param marketId Market identifier
     * @return OrderBook address (address(0) if not found)
     */
    function getOrderBookForMarket(bytes32 marketId) external view returns (address) {
        return marketToOrderBook[marketId];
    }
    
    // Removed redundant reverse lookup getter to reduce bytecode size
    
    /**
     * @dev Get all OrderBook addresses
     * @return Array of OrderBook addresses
     */
    // Removed convenience getter to reduce bytecode size
    
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
    // Removed convenience getter to reduce bytecode size
    
    /**
     * @dev Check if a market exists
     * @param marketId Market identifier
     * @return True if market exists
     */
    // Removed redundant getter: use public mapping `marketExists`
    
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
    // Removed redundant getter: use public mapping `marketCreators`
    
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
    // Removed redundant getter: use public mapping `marketMetricUrls`
    
    /**
     * @dev Get settlement date for a market
     * @param marketId Market identifier
     * @return Settlement date timestamp
     */
    // Removed redundant getter: use public mapping `marketSettlementDates`
    
    /**
     * @dev Get start price for a market
     * @param marketId Market identifier
     * @return Start price (6 USDC decimals)
     */
    // Removed redundant getter: use public mapping `marketStartPrices`
    
    /**
     * @dev Get market creation timestamp
     * @param marketId Market identifier
     * @return Creation timestamp
     */
    // Removed redundant getter: use public mapping `marketCreationTimestamps`
    
    // Removed convenience settlement helpers to reduce bytecode size
    
    /**
     * @dev Get data source for a market
     * @param marketId Market identifier
     * @return Data source string
     */
    // Removed redundant getter: use public mapping `marketDataSources`
    
    /**
     * @dev Get tags for a market
     * @param marketId Market identifier
     * @return Array of tag strings
     */
    // Removed redundant getter
    
    /**
     * @dev Get settlement status and final price
     * @param marketId Market identifier
     * @return settled Whether market is settled
     * @return finalPrice Final settlement price (0 if not settled)
     */
    // Removed convenience view
    
    /**
     * @dev Get markets created by a user
     * @param creator Creator address
     * @return Array of market IDs created by the user
     */
    // Removed convenience view
    
    // ============ Market Discovery Functions ============
    
    /**
     * @dev Get all custom metric markets
     * @return Array of custom metric market IDs
     */
    // Removed discovery helper
    
    /**
     * @dev Get all standard markets
     * @return Array of standard market IDs
     */
    // Removed discovery helper
    
    /**
     * @dev Get markets by data source
     * @param dataSource Data source to filter by
     * @return Array of market IDs from the specified data source
     */
    // Removed discovery helper
    
    /**
     * @dev Get markets containing a specific tag
     * @param tag Tag to search for
     * @return Array of market IDs containing the tag
     */
    // Removed discovery helper
    
    /**
     * @dev Get markets settling within a time range
     * @param fromTimestamp Start of time range
     * @param toTimestamp End of time range
     * @return Array of market IDs settling in the range
     */
    // Removed discovery helper
    
    /**
     * @dev Get active (unsettled) markets
     * @return Array of active market IDs
     */
    // Removed discovery helper
    
    /**
     * @dev Get markets ready for settlement
     * NOTE: Retained due to potential external usage
     */
    function getMarketsReadyForSettlement() external view returns (bytes32[] memory) {
        uint256 mLen = allMarkets.length;
        uint256 count = 0;
        for (uint256 i = 0; i < mLen; ) {
            bytes32 mid = allMarkets[i];
            if (!marketSettled[mid] && block.timestamp >= marketSettlementDates[mid]) {
                count++;
            }
            unchecked { ++i; }
        }
        
        bytes32[] memory ready = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < mLen; ) {
            bytes32 mid = allMarkets[i];
            if (!marketSettled[mid] && block.timestamp >= marketSettlementDates[mid]) {
                ready[index] = mid;
                unchecked { ++index; }
            }
            unchecked { ++i; }
        }
        
        return ready;
    }
    
    // Removed convenience getter for market creation settings to reduce bytecode size
    
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
    // Removed aggregated details view
    
    /**
     * @dev Get market metadata only
     * @param marketId Market identifier
     * @return symbol Market symbol
     * @return metricUrl Metric URL (source of truth)
     * @return settlementDate Settlement timestamp
     * @return startPrice Start price (6 USDC decimals)
     * @return settled Whether market has settled
     */
    // Removed aggregated metadata view
    
    // ============ Robust Oracle Management Functions ============
    
    /**
     * @dev Set oracle reward amount for UMA requests
     * @param rewardAmount New reward amount in USDC
     */
    function setOracleReward(uint256 rewardAmount) external onlyAdmin {
        if (rewardAmount == 0) revert RewardMustBePositive();
        defaultOracleReward = rewardAmount;
    }
    
    /**
     * @dev Update oracle admin
     * @param newOracleAdmin New oracle admin address
     */
    function updateOracleAdmin(address newOracleAdmin) external onlyAdmin {
        if (newOracleAdmin == address(0)) revert ZeroAddress();
        oracleAdmin = newOracleAdmin;
    }
    
    /**
     * @dev Force price update for a market using default oracle
     * @param marketId Market identifier
     */
    function requestPriceUpdate(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (address(defaultOracle) == address(0)) revert OracleNotConfigured();
        
        defaultOracle.requestPriceUpdate(marketId, marketMetricUrls[marketId]);
    }
    
    /**
     * @dev Get current price from market's oracle
     * @param marketId Market identifier
     * @return price Current price
     * @return timestamp Price timestamp
     */
    function getCurrentOraclePrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        if (!marketExists[marketId]) revert MarketNotFound();
        
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
    // Removed aggregated oracle info view to reduce bytecode size
    
    /**
     * @dev Update multiple market prices via oracle admin
     * @param marketIds Array of market identifiers
     * @param prices Array of new prices
     */
    function batchUpdatePrices(bytes32[] memory marketIds, uint256[] memory prices) external {
        if (!(msg.sender == oracleAdmin || msg.sender == admin)) revert NotAuthorized();
        if (marketIds.length != prices.length) revert InvalidInput();
        
        uint256 len = marketIds.length;
        for (uint256 i = 0; i < len; ) {
            bytes32 mid = marketIds[i];
            if (marketExists[mid] && !marketSettled[mid]) {
                vault.updateMarkPrice(mid, prices[i]);
            }
            unchecked { ++i; }
        }
    }
    
    /**
     * @dev Get markets requiring oracle updates (price older than threshold)
     * @param maxAge Maximum age in seconds for price to be considered fresh
     * @return Array of market IDs needing price updates
     */
    // Removed oracle monitoring helper
    
    /**
     * @dev Get oracle health status across all markets
     * @return totalMarkets Total number of markets
     * @return activeMarkets Number of active (unsettled) markets
     * @return marketsWithCustomOracles Number of markets with custom oracles
     * @return marketsWithUMARequests Number of markets with pending UMA requests
     * @return settledMarkets Number of settled markets
     */
    // Removed oracle health view
    
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
        if (!marketExists[marketId]) revert MarketNotFound();
        if (emergencyPrice == 0) revert InvalidOraclePrice();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        vault.updateMarkPrice(marketId, emergencyPrice);
        // event omitted to reduce bytecode size
    }
    
    // ============ Internal Helper Functions ============
    
    /**
     * @dev Get markets by custom metric type
     * @param customType True for custom metrics, false for standard
     * @return Array of market IDs of the specified type
     */
    // helper removed: _getMarketsByType (and related typology) to reduce bytecode size
    
    /**
     * @dev Get markets by type (custom vs traditional)
     * @param customOnly If true, return only custom markets; if false, return traditional markets
     * @return marketIds Array of market IDs
     */
    // view removed: getMarketsByType to reduce bytecode size

    // Removed convenience market info getter to reduce bytecode size

    /**
     * @dev Compare two strings for equality
     * @param a First string
     * @param b Second string
     * @return True if strings are equal
     */
    // helper removed (unused) to reduce bytecode size

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
        if (!marketExists[marketId]) revert MarketNotFound();
        if (!(maxLeverage > 1 && maxLeverage <= 100)) revert InvalidLeverage();
        if (!(marginRequirementBps >= 100 && marginRequirementBps <= 10000)) revert InvalidMarginRequirement();
        if (marginRequirementBps > (10000 / maxLeverage)) revert MarginTooLowForLeverage();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        // Enable leverage on the Diamond OB via admin facet
        obAdmin.enableLeverage(maxLeverage, marginRequirementBps);
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Disable leverage for a specific market (revert to 1:1 margin)
     * @param marketId Market identifier
     */
    function disableMarketLeverage(bytes32 marketId) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        obAdmin.disableLeverage();
        // event omitted to reduce bytecode size
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
        if (!marketExists[marketId]) revert MarketNotFound();
        if (controller == address(0)) revert ZeroAddress();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        obAdmin.setLeverageController(controller);
        // event omitted to reduce bytecode size
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
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBViewFacet obView = IOBViewFacet(orderBookAddress);
        return obView.getLeverageInfo();
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
        if (_defaultMarginRequirementBps < 1000 || _defaultMarginRequirementBps > 10000) revert InvalidMarginRequirement();
        
        defaultMarginRequirementBps = _defaultMarginRequirementBps;
        defaultLeverageEnabled = _defaultLeverageEnabled;
        // event omitted to reduce bytecode size
    }

    // ============ Additional Events for Leverage Management ============
    // removed to reduce bytecode size
}
