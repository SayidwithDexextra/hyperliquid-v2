# Isolated Margin Trading System Implementation Plan

## Overview
This document outlines the complete implementation plan for converting the existing OrderBook smart contract system to support isolated margin trading with automated liquidations and socialized loss mechanisms.

## Core Requirements

### 1. Isolated Margin Trading
- Each position maintains its own dedicated collateral
- Positions cannot share margin between each other
- Users can choose their margin amount (with minimums enforced)
- Clear liquidation prices calculated at position opening

### 2. Liquidation System
- Automatic liquidation when mark price reaches liquidation price
- Liquidation penalties distributed to fee recipient or protocol treasury
- Partial liquidation support for large positions
- Immediate position closure to prevent further losses

### 3. Collateral Waterfall for Losses
When a position's losses exceed its isolated margin:
1. **First**: Use position's isolated margin (already gone)
2. **Second**: Deduct from user's available collateral in vault
3. **Third**: Implement socialized losses as last resort

### 4. Socialized Loss System
- Only triggered after user's total collateral is exhausted
- Losses distributed proportionally among profitable traders
- ADL (Auto-Deleveraging) queue based on profit × leverage
- Transparent and predictable for all users

## Implementation Steps

### Phase 1: Data Structure Updates

#### 1.1 Update Position Structure
```solidity
// In OrderBook.sol, modify the position tracking:
struct IsolatedPosition {
    uint256 positionId;
    address trader;
    int256 size; // Positive for long, negative for short
    uint256 entryPrice;
    uint256 isolatedMargin;
    uint256 liquidationPrice;
    uint256 maintenanceMargin;
    uint256 openTimestamp;
    bool isActive;
}

// Add new mappings
mapping(address => mapping(uint256 => IsolatedPosition)) public userPositions;
mapping(address => uint256[]) public userPositionIds;
mapping(address => uint256) public userNextPositionId;
```

#### 1.2 Add Liquidation Tracking
```solidity
struct LiquidationEvent {
    address trader;
    uint256 positionId;
    uint256 liquidationPrice;
    uint256 bankruptcyPrice;
    uint256 shortfall;
    uint256 timestamp;
}

// Shortfall tracking
uint256 public totalShortfall;
mapping(uint256 => LiquidationEvent) public liquidationHistory;
```

### Phase 2: Core Functions Implementation

#### 2.1 Position Opening with Isolated Margin
```solidity
Key requirements:
1. Calculate minimum margin based on position size and leverage limits
2. Allow users to add more margin than minimum for safety
3. Calculate and store liquidation price immediately
4. Lock the isolated margin in vault
5. Emit events for position tracking
```

#### 2.2 Liquidation Price Calculation
```solidity
For SHORT positions:
- Liquidation Price = Entry Price + ((Isolated Margin - Maintenance Margin) / Position Size)
- Maintenance Margin = 5% of notional value
- Must account for trading fees in calculation

For LONG positions:
- Liquidation Price = Entry Price - ((Isolated Margin - Maintenance Margin) / Position Size)
```

#### 2.3 Mark Price Integration
```solidity
Requirements:
1. Use VWAP-based mark price for liquidation checks
2. Update mark price on every trade
3. Add external price feed capability for gap protection
4. Implement price smoothing to prevent flash liquidations
```

### Phase 3: Liquidation Engine

#### 3.1 Liquidation Checker
```solidity
Function: checkAndLiquidatePositions()
- Iterate through all active positions
- Compare current mark price to liquidation price
- Trigger liquidation for underwater positions
- Can be called by anyone (keeper incentives)
```

#### 3.2 Liquidation Execution
```solidity
Function: executeLiquidation(address trader, uint256 positionId)

Steps:
1. Verify position is indeed liquidatable
2. Calculate actual loss at current mark price
3. Apply liquidation penalty (2.5% of position value)
4. Distribute penalty: 1.5% to keeper, 1% to protocol
5. Check if isolated margin covers the loss
6. If not, proceed to collateral waterfall
```

### Phase 4: Collateral Waterfall Implementation

#### 4.1 Available Collateral Check
```solidity
When isolated margin insufficient:
1. Calculate shortfall = Total Loss - Isolated Margin
2. Get user's available collateral from vault
3. Deduct shortfall from available collateral
4. Update user's vault balance
5. Track any remaining shortfall
```

#### 4.2 Direct to Socialized Losses
```solidity
If user's total collateral exhausted:
1. Calculate remaining shortfall
2. Track total system shortfall
3. Proceed immediately to socialized losses
4. No intermediate fund to cover gaps
5. Emit events for transparency
```

### Phase 5: Socialized Loss Implementation

#### 5.1 Profit Tracking
```solidity
Requirements:
1. Track unrealized PnL for all positions
2. Calculate profit percentage and leverage score
3. Maintain sorted list of profitable positions
4. Update on every mark price change
```

#### 5.2 Loss Socialization
```solidity
Function: socializeLosses(uint256 shortfall)

Process:
1. Get all profitable positions in opposite direction
2. Sort by score (profit % × leverage)
3. Calculate total profits available
4. Distribute losses proportionally
5. Update each trader's realized PnL
6. Emit socialization events
```

#### 5.3 Auto-Deleveraging Option
```solidity
Alternative to pure socialization:
1. Force close highest-scoring positions
2. Use their profits to cover shortfall
3. Continue until shortfall covered
4. More aggressive but cleaner
```

### Phase 6: Safety Mechanisms

#### 6.1 Position Limits
```solidity
Dynamic limits based on:
1. User's total collateral
2. Market liquidity
3. Current open interest
4. Insurance fund size
```

#### 6.3 Margin Requirements
```solidity
Flexible margin with minimums:
- Minimum for longs: 10% (10x leverage)
- Minimum for shorts: 20% (5x leverage)
- Users can add up to 100% for safety
- Higher requirements during volatility
```

### Phase 7: System Protection Mechanisms

#### 7.1 Liquidation Penalty Distribution
```solidity
1. 1.5% to liquidation executor (keeper)
2. 1% to protocol treasury/fee recipient
3. Creates incentive for timely liquidations
4. No insurance fund accumulation
```

#### 7.2 Risk Parameters
```solidity
Maintain system health through:
- Dynamic margin requirements
- Position limits per user
- Maximum leverage caps
- Early liquidation triggers
```

### Phase 8: User Interface Requirements

#### 8.1 Position Management
```
Display for each position:
- Position ID and direction
- Entry price and current price
- Isolated margin amount
- Liquidation price
- Current PnL
- Health percentage
```

#### 8.2 Risk Warnings
```
Show warnings when:
- Position health < 150%
- Liquidation price within 10% of mark
- Using minimum margin
- High ADL ranking
```

## Testing Requirements

### 8.1 Unit Tests
- Liquidation price calculations
- Collateral waterfall logic
- Socialized loss distribution
- Insurance fund operations

### 8.2 Integration Tests
- Full liquidation scenarios
- Gap market simulations
- Multi-user socializations

### 8.3 Stress Tests
- 1000+ positions
- Cascade liquidations
- Insurance fund depletion
- System recovery

## Migration Strategy

### Step 1: Deploy New Contracts
- Deploy updated OrderBook with isolated margin
- Deploy insurance fund contract
- Keep old system running

### Step 2: Gradual Migration
- Allow new positions only on new system
- Let old positions close naturally
- Transfer collateral on user request

### Step 3: Full Cutover
- Set deadline for migration
- Force close remaining old positions
- Disable old contracts

## Risk Considerations

### Technical Risks
- Gas optimization for liquidation loops
- Oracle manipulation protection
- Reentrancy guards on all transfers

### Economic Risks
- Direct socialization impact on traders
- Liquidation penalty optimization
- ADL queue fairness
- Cascading liquidation risks without buffer

### User Experience
- Clear documentation
- Liquidation price calculators
- Risk management tools
- Educational content

## Success Metrics

1. Zero system insolvencies
2. Minimal socialized loss events
3. Liquidation success rate > 99%
4. User satisfaction with transparency
5. Competitive fee structure maintained

## Timeline

- Week 1-2: Core data structures and position management
- Week 3-4: Liquidation engine and collateral waterfall
- Week 5-6: Socialized losses and insurance fund
- Week 7-8: Testing and optimization
- Week 9-10: UI integration and migration tools
- Week 11-12: Mainnet deployment and monitoring

## Additional Considerations

### Oracle Integration
- Primary: Internal VWAP mark price
- Secondary: Chainlink price feeds
- Tertiary: Other DEX prices
- Use median of three for liquidations

### Keeper Incentives
- 0.5% of liquidated position value
- Gas refund + premium
- Priority queue for active keepers

### Compliance
- Clear terms of service
- Risk disclosures
- Jurisdiction considerations
- No pursuing users for negative balances

This implementation plan provides a comprehensive roadmap for building a robust isolated margin trading system with proper risk management and user protections.
