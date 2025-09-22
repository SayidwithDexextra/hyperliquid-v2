# 🔄 Network Switching Guide

## 🎯 Quick Commands

### Deploy to Different Networks
```bash
# Local development (no size limits, fast)
npm run deploy:localhost

# HyperLiquid mainnet 
npm run deploy:hyperliquid

# HyperLiquid testnet
npm run deploy:hyperliquid-testnet

# Polygon (alternative)
npm run deploy:polygon
```

### Trade on Different Networks
```bash
# Trade on localhost
npm run trade

# Trade on HyperLiquid
npm run trade:hyperliquid
```

## 🔧 Method 2: Direct Hardhat Commands

```bash
# Deploy anywhere
npx hardhat run scripts/deploy.js --network [NETWORK_NAME]

# Interactive trading anywhere  
npx hardhat run scripts/interactive-trader.js --network [NETWORK_NAME]

# Available networks: localhost, hyperliquid, hyperliquid_testnet, polygon
```

## 📋 Method 3: Environment-Based Switching

Set default network in your shell:
```bash
export HARDHAT_NETWORK=localhost    # For local testing
export HARDHAT_NETWORK=hyperliquid  # For HyperLiquid
```

Then just run:
```bash
npm run deploy    # Uses HARDHAT_NETWORK
npm run trade     # Uses HARDHAT_NETWORK
```

## 🔄 Typical Development Workflow

### 1. Start Local Node (Terminal 1)
```bash
npx hardhat node
# Keeps running - provides local blockchain
```

### 2. Deploy & Test Locally (Terminal 2) 
```bash
# Deploy to localhost (no contract size limits)
npm run deploy:localhost

# Test trading locally
npm run trade
```

### 3. Deploy to HyperLiquid When Ready
```bash
# Make sure you have gas funds first!
npm run deploy:hyperliquid

# Start trading on HyperLiquid  
npm run trade:hyperliquid
```

## 📊 Network Differences

| Network | Speed | Gas Cost | Contract Size Limit | Best For |
|---------|-------|----------|---------------------|----------|
| localhost | ⚡ Instant | �� Free | ✅ Unlimited | Development & Testing |
| hyperliquid | 🔄 Real | 💰 Real costs | ⚠️ 24KB limit | Production |
| polygon | 🔄 Real | 💰 Low costs | ⚠️ 24KB limit | Alternative production |

## 🎯 Pro Tips

- **Always test locally first** - catch bugs without gas costs
- **Use localhost for large contracts** - no size limits
- **Keep separate deployment files** - each network gets its own JSON
- **Check gas balances** before mainnet deployments
