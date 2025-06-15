#!/bin/bash
# Run Hardhat commands with automatic dependency installation
set -e
if [ ! -d node_modules ]; then
    echo "Installing npm dependencies..."
    npm install
fi
npx hardhat "$@"

