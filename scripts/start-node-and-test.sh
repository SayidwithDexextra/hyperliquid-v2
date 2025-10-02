#!/bin/bash

echo "Starting Hardhat node in background (high limits)..."
NODE_OPTIONS="--max-old-space-size=4096" npx hardhat node --hostname 127.0.0.1 --port 8545 > hardhat.log 2>&1 &
NODE_PID=$!

echo "Waiting for node to start..."
sleep 5

echo "Deploying contracts..."
HARDHAT_NETWORK=localhost npx hardhat run scripts/deploy.js --network localhost

echo "Running position netting test..."
HACK_MAX_CONCURRENCY=3 node scripts/test-position-netting-direct.js

echo "Killing Hardhat node..."
kill $NODE_PID

echo "Done!"
