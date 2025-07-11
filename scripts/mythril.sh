#!/bin/bash
# Run Mythril analysis on all Solidity contracts
set -e

# ensure dependencies
if ! command -v myth > /dev/null 2>&1; then
    echo "Mythril not found, installing..."
    pip install mythril
fi
if [ ! -d node_modules ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# compile contracts first
npx hardhat compile

# run mythril on each contract source file
EXIT_CODE=0
for file in $(find contracts -name '*.sol'); do
    echo "Analyzing $file"
    myth analyze "$file" --execution-timeout 60 || EXIT_CODE=$?
done
exit $EXIT_CODE
