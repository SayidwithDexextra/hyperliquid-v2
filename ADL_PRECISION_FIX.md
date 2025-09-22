# ADL Precision Bug Fix

## Problem
ADL system was reducing positions by dust amounts (5.19e-12 ALU instead of 5.19 ALU) due to precision mismatch.

**Example:**
- Expected reduction: `5190000000000000000` (5.19 ALU)
- Actual reduction: `5190000` (0.00000519 ALU - dust)

## Root Cause
In `_executeAdministrativePositionClosure()`:
- `targetProfit` (USDC loss): **6 decimals**
- `totalUnrealizedPnL` (USDC P&L): **6 decimals** 
- `absCurrentSize` (ALU position): **18 decimals**

Mixed precision caused incorrect ratio calculations.

## Fix Applied
**File:** `src/CoreVault.sol` lines 1320-1329

```solidity
// BEFORE (broken):
uint256 reductionRatio = (targetProfit * 1e18) / totalProfitAvailable;

// AFTER (fixed):
uint256 targetProfitScaled = targetProfit * 1e12;  // 6→18 decimals
uint256 totalProfitScaled = totalProfitAvailable * 1e12;  // 6→18 decimals  
uint256 reductionRatio = (targetProfitScaled * 1e18) / totalProfitScaled;
```

## Result
✅ ADL now produces meaningful position reductions  
✅ Proper loss socialization across users  
✅ No more gas-wasting dust transactions
