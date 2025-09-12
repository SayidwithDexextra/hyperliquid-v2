#!/bin/bash

echo "Starting Hardhat node in background..."
npx hardhat node > hardhat.log 2>&1 &
NODE_PID=$!

echo "Waiting for node to start..."
sleep 5

echo "Deploying contracts..."
npx hardhat run scripts/deploy.js --network localhost

echo "Running position netting test..."
node scripts/test-position-netting-direct.js

echo "Killing Hardhat node..."
kill $NODE_PID

echo "Done!"
