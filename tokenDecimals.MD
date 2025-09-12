// tokenDecimals.ts
export const TOKEN_DECIMALS: Record<string, number> = {
    ETH: 18,
    WETH: 18,
    USDC: 6,
    USDT: 6,
    DAI: 18,
    // add any others here
  };
  

Inside contracts:

Store values in base units (wei, smallest token unit)

Never store floats or decimals

If you must scale between assets of different precision (e.g., ETH 18 decimals ↔ USDC 6 decimals), explicitly rescale:


  function scaleTo18Decimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
    if (decimals == 18) return amount;
    return amount * (10 ** (18 - decimals));
}

function scaleFrom18Decimals(uint256 amount, uint8 decimals) internal pure returns (uint256) {
    if (decimals == 18) return amount;
    return amount / (10 ** (18 - decimals));
}
