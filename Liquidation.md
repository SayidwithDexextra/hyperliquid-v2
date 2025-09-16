# Liquidation Mechanism in HyperLiquid v2

## Overview

The HyperLiquid v2 smart contracts employ an implicit liquidation model rather than a traditional, explicit liquidation function. Instead of allowing third-party liquidators to close under-collateralized positions, the system prevents insolvency through a robust set of margin requirements and position netting checks that are enforced on every trade. This document details how this mechanism functions for both long and short positions.

## Core Concepts

The liquidation system is built upon a few core concepts within the `CentralizedVault.sol` contract:

1.  **Margin Requirement**: Every open position requires a certain amount of the user's collateral to be locked as "margin." This is a percentage of the position's notional value and is enforced by the `_calculateAndLockMargin` internal function.

2.  **Unrealized Profit and Loss (PnL)**: The `getUnrealizedPnL` function continuously calculates the floating profit or loss of all open positions for a user based on the current mark price of the asset.

3.  **Portfolio Value and Available Collateral**: A user's total financial health is represented by their "Portfolio Value," which is the sum of their total collateral and their unrealized PnL. "Available Collateral" is the portion of their collateral that is not locked for existing positions or reserved for open orders. Unrealized losses directly reduce a user's available collateral.

## Liquidation of a Short Position

A user is in a short position when they have a negative position `size`. They profit if the asset's price goes down and lose if it goes up.

1.  **Trigger Condition**: When the price of the asset rises, the short position incurs an unrealized loss. This loss is subtracted from the user's available collateral.
2.  **"Soft" Liquidation**: The user is considered "undermargined" or subject to liquidation when their available collateral is insufficient to meet the margin requirements for their open positions. There is no single event or function call that triggers liquidation. Instead, the following occurs:
    *   The user will be unable to open new positions, increase existing ones, or withdraw collateral because the margin checks, like `require(availableCollateral >= marginToLock, "CentralizedVault: insufficient collateral for position margin");`, will fail.
3.  **Position Closure**: The position can only be closed by an opposing trade (i.e., a buy order that matches their short sell). When the position is closed, the `_executePositionNetting` function calculates the realized PnL.
4.  **Final Solvency Check**: The critical check occurs in the `_applyNettingResult` function. If closing the position results in a loss, the contract ensures the user can cover it:
    ```solidity
    require(userCollateral[user] >= nettingResult.realizedPnL, "CentralizedVault: insufficient collateral for loss");
    ```
    If this check fails, the entire transaction reverts. This prevents the position from being closed at a loss that would make the user insolvent.

## Liquidation of a Long Position

A user is in a long position when they have a positive position `size`. They profit if the asset's price goes up and lose if it goes down. The liquidation process is analogous to that of a short position.

1.  **Trigger Condition**: When the price of the asset falls, the long position incurs an unrealized loss, which reduces the user's available collateral.
2.  **"Soft" Liquidation**: Similar to a short position, the user becomes unable to transact or withdraw funds once their available collateral is depleted by unrealized losses.
3.  **Position Closure**: The position is closed by an opposing sell order.
4.  **Final Solvency Check**: The same `require` statement in `_applyNettingResult` ensures that any realized loss from closing the position does not exceed the user's total collateral.

## Summary

In essence, the HyperLiquid v2 protocol does not have a "liquidation engine." It manages risk proactively by:

*   **Enforcing Margin on Every Action**: All trades and withdrawals are gated by strict margin checks.
*   **Preventing Insolvent Trades**: The system is designed to revert any trade that would result in a user's insolvency.

This design places the responsibility on the trader to manage their margin and collateral, as the system's primary failsafe is to block further action rather than to forcibly close positions through a third party.

