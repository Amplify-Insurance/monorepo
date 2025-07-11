#!/bin/bash
# Run Manticore symbolic execution on all Solidity contracts
set -e

# ensure dependencies
if ! command -v manticore > /dev/null 2>&1; then
    echo "Manticore not found, installing..."
    pip install manticore
fi
if [ ! -d node_modules ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# compile contracts first
npx hardhat compile

# run manticore on each contract source file
EXIT_CODE=0
for file in $(find contracts -name '*.sol'); do
    echo "Analyzing $file"
    manticore "$file" || EXIT_CODE=$?
done
exit $EXIT_CODE
