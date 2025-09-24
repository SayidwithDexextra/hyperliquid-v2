## Dynamic Maintenance Margin Ratio (MMR) — Plain‑English Guide

This document explains how our current Maintenance Margin Ratio (MMR) works, without using formulas or advanced math. It covers what inputs we look at, how we translate market conditions into a maintenance requirement, and how this affects liquidation behavior.

### What is MMR?
MMR is the minimum cushion of margin a position must maintain to be considered “healthy.” If a position’s equity falls below this required cushion, it becomes eligible for liquidation. In short: the higher the MMR, the more margin you need to keep the position alive.

### Why is our MMR dynamic?
Markets are not static. Two things can make a position riskier in the real world:
- How big the position is relative to the nearby liquidity that could realistically close it.
- How far the actual executable liquidity sits from the current mark price (price gaps).

We account for both. This makes the system fairer and more resilient. When liquidity is deep and close, MMR stays near its floor. When liquidity is thin or far away, MMR increases to reflect the higher risk of closing the position without losses spilling over.

### The four components of our MMR
- Fixed floor (penalty): A constant, non‑negotiable base requirement everyone pays. This is the hard minimum maintenance cushion.
- Size vs. Liquidity (the “fill” component): We look at how large your position is compared to the amount of opposite‑side size available in the top part of the book. The bigger you are relative to what’s there, the higher the risk, so the MMR increases.
- Price‑gap sensitivity (the “gap” component): We also look at where the real, executable liquidity is. If closing your size would actually trade far away from the current mark, we treat that as risk and add to the MMR.
- Cap: A hard upper limit so MMR never grows beyond a configured maximum.

### What inputs do we use?
- Your open position size.
- A snapshot of the order book’s top levels on the opposite side you would use to close. For a short, that’s the asks; for a long, that’s the bids. We call this the “depth window.”
- The current mark price for the market.
- The price levels and amounts in that depth window, so we can approximate where your closing trades would actually happen.

### How we translate inputs into MMR
1) We measure your size against the opposite‑side depth. If you are small compared to what’s sitting in the top of the book, this part stays small; if you’re a big chunk of the book, this part increases. This is the fill component.
2) We estimate the average price you would get if you actually closed your position right now using only the top of the book. If that estimated close is much worse than the mark (for shorts, higher; for longs, lower), we add risk via the gap component.
3) We add the fixed floor to the two dynamic parts, then clamp the result to the configured maximum.

Think of it as: fixed safety cushion + “how big are you vs the book” + “how far away is the real liquidity,” with a ceiling so it can’t run away.

### What is the “depth window” and why does it matter?
The depth window is how many price levels we look at on each side when checking liquidity. A larger window makes the system more forgiving (it sees more liquidity), while a smaller window makes it more conservative (it sees less). We default to a reasonable number of top levels so we focus on liquidity that is realistically close and executable.

### What is the “gap” in plain terms?
It’s the distance between the current mark price and the average price you’d likely get if you tried to close your whole position using just the top of the book. If the book is empty near the mark and the first real liquidity is far away, the gap is large. Large gaps mean higher risk of losses on close, so we raise MMR accordingly. No gaps or small gaps mean little or no extra risk from this part.

### Current defaults we set in deploy
- Fixed floor: 10%.
- Fill sensitivity: up to another 10% when you’re very large relative to nearby liquidity.
- Gap sensitivity: up to another 5% when executable liquidity is far from mark.
- Global cap: 20% maximum. Even if both dynamic parts want to add more, we stop at this cap.

In practice, that means MMR usually sits near the 10–12% range when the book is tight and deep, and it rises toward 20% when the book is thin or far away. It will not exceed 20%.

### How does this affect liquidation?
The MMR determines how much margin your position must keep. As liquidity gets worse (thinner or farther), MMR rises, which moves your liquidation threshold closer. That is by design: we want to nudge high‑risk positions to add margin or reduce size earlier, before they become dangerous to the system.

### What the user sees
- The interactive trader shows the liquidation threshold from the contract.
- It also displays an MMR breakdown: the fixed portion, the total dynamic portion, plus the observed “fill” and “gap” percentages that explain why your MMR is what it is.

### Tuning and governance knobs
Admins can set:
- The fixed floor.
- The maximum cap.
- How aggressively to scale with fill (size vs. depth).
- How aggressively to scale with price gaps.
- How many top price levels to consider for the depth window.

This lets you tailor risk to market reality. If markets are consistently deep and stable, you can afford a gentler slope. If markets are thin or gappy, stronger scaling encourages safer behavior.

### Practical examples without numbers
- “Healthy” market: There’s plenty of opposite‑side size near the mark. You are a small fraction of that size, and the average close price you’d actually hit is very close to the mark. Your MMR stays near the floor.
- “Thin” market: There isn’t much size near the mark. You are a large fraction of what’s available. Your MMR rises because closing you now would move the price.
- “Gappy” market: There is size, but it starts far away from the mark. Even if you’re not huge, the price you’d actually trade to close is meaningfully worse than the mark. Your MMR rises because of the gap risk.
- “Worst case”: Little or no realistic liquidity near the mark, and the first size is far away. Both fill and gap add risk. MMR quickly reaches the cap.

### Why this design is safer
- It’s proactive: we react to real book conditions, not just position size in a vacuum.
- It’s fair: small positions in liquid markets aren’t punished; risky situations are.
- It’s bounded: the cap prevents extreme requirements while still giving us the protection we need.
- It’s transparent: the trader UI explains your MMR using plain “fill” and “gap” percentages.

### Relationship to ADL (auto‑deleverage)
This MMR system reduces the chance we ever need ADL by nudging risky positions to act earlier (add margin or reduce size). If a liquidation still happens and there isn’t enough executable liquidity near mark, our ADL backstop can safely absorb the remainder without touching user collateral outside the margin allocated to the position.

---

If you want different behavior, change the knobs: increase or decrease the depth window, the fill sensitivity, the gap sensitivity, or the global cap. The model is deliberately simple, explainable, and controllable.


