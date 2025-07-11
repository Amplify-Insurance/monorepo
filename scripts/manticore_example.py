#!/usr/bin/env python3
"""Example Manticore script for symbolic execution.

This deploys the `MockERC20` test contract and explores symbolic calls to
`mint` and `burn`. Results are written to a local `mcore_*` directory.

Usage:
    python3 scripts/manticore_example.py
"""

from manticore.ethereum import ManticoreEVM

# create blockchain with a funded user account
m = ManticoreEVM()
user = m.create_account(balance=10**18)

# load solidity source
with open("contracts/test/MockERC20.sol", "r") as f:
    source = f.read()

# deploy the contract with constructor arguments
token = m.solidity_create_contract(
    source,
    owner=user,
    contract_name="MockERC20",
    args=("MockToken", "MOCK", 18),
)

# make symbolic mint/burn amounts
amount = m.make_symbolic_value(name="amount")

# owner mints to user then burns from user
token.mint(user, amount)
token.burn(user, amount)

# explore all paths
m.run()
print(f"Results saved in {m.workspace}")
