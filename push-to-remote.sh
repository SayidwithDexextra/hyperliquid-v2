#!/bin/bash

# Script to push the HyperLiquid v2 codebase to a new Git repository

echo "=== Git Repository Push Script ==="
echo

# Check if remote URL is provided
if [ -z "$1" ]; then
    echo "Usage: ./push-to-remote.sh <remote-url>"
    echo "Example: ./push-to-remote.sh https://github.com/yourusername/hyperliquid-v2.git"
    echo "         ./push-to-remote.sh git@github.com:yourusername/hyperliquid-v2.git"
    exit 1
fi

REMOTE_URL=$1

echo "Adding remote origin: $REMOTE_URL"
git remote add origin "$REMOTE_URL"

echo
echo "Pushing to remote repository..."
git push -u origin master

echo
echo "Repository successfully pushed!"
echo
echo "Your repository structure includes:"
echo "- Smart Contracts (src/): OrderBook, CentralizedVault, FuturesMarketFactory, TradingRouter"
echo "- Test Suite (test/): Comprehensive test coverage"
echo "- Scripts (scripts/): Trading demos, deployment, and utility scripts"
echo "- Configuration: Hardhat setup and deployment configs"
echo
echo "Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Run tests: npx hardhat test"
echo "3. Deploy locally: npx hardhat node && npm run deploy:local"
echo "4. Use interactive trader: node scripts/interactive-trader.js"
