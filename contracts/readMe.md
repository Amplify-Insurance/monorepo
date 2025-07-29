# Amplify Insurance Smart Contracts

This directory contains the Solidity sources for the Amplify Insurance protocol. The contracts implement an on-chain insurance marketplace where underwriters supply USDC liquidity and policy-holders buy cover on specific risks. All lifecycle actions are enforced by these smart contracts.

## Directory structure

```
core/            Core contracts
external/        Optional backstop modules
adapters/        Yield strategy integrations
oracles/         Price feeds
governance/      DAO style governance
utils/           Misc utilities
tokens/          ERC20/ERC721 tokens
interfaces/      Shared protocol interfaces
```

### Core
- **CapitalPool.sol** – Main vault for underwriter deposits and yield adapter hooks
- **PoolRegistry.sol** – Stores risk pool parameters and active adapters
- **PolicyManager.sol** – User entrypoint for buying and settling policies
- **RiskManager.sol** – Handles allocations, claims and payouts
- **UnderwriterManager.sol** – Tracks underwriter pledges and risk points
- **ProtocolConfigurator.sol** – Admin contract for updating system settings

### External
- **BackstopPool.sol** – Secondary pool funded by premiums for large claim events

### Adapters
- **AaveV3Adapter.sol** – Deposits idle capital into Aave V3 for yield
- **CompoundV3Adapter.sol** – Deposits idle capital into Compound V3
- **MockAaveV3Adapter.sol**, **MockCompoundV3Adapter.sol** – Test adapters used in the unit suite

### Governance
- **Committee.sol** – Simple voting contract for approving protocol changes
- **Staking.sol** – Users stake governance tokens to gain voting weight

### Oracles
- **PriceOracle.sol** – Reads Chainlink feeds to provide token prices

### Utilities
- **ContractRegistry.sol** – Lookup table of active contract addresses
- **DeploymentRegistry.sol** – Records addresses for each deployment
- **MulticallReader.sol** – Batch view functions for gas savings
- **LossDistributor.sol** – Tracks pro‑rata loss accounting for underwriters
- **RewardDistributor.sol** – Distributes rewards from premiums or seized assets

### Tokens
- **CatShare.sol** – ERC20 representing liquidity in the BackstopPool
- **OShare.sol** – Governance token used for staking and voting
- **PolicyNFT.sol** – ERC721 issued for every active policy
- **USDCoin.sol** – Minimal ERC20 placeholder used in local testing

### Interfaces
Shared interfaces live here and are imported across the system.

## Building and testing

Install dependencies and compile the contracts:

```bash
npm install
npx hardhat compile
```

## Usage

Run the test suite with:

```bash
npx hardhat test
```

Run Slither static analysis with:

```bash
npm run slither
```

Run Mythril security analysis with:

```bash
npm run test:mythril
```

Run Manticore symbolic execution with:

```bash
npm run test:manticore
```

Deploy the **PriceOracle** and register Chainlink feeds on Base with:

```bash
npx hardhat run scripts/deploy-oracle.js --network base
```

Then update `frontend/.env` using the printed `PriceOracle` and `MulticallReader`
addresses so the frontend can display token prices and batch queries.

The default network configuration uses Hardhat's in‑memory chain.  Modify `hardhat.config.js` to add or customise networks. Running scripts on a remote network requires access to the configured RPC endpoint.


## Running a Local Node

To experiment with the contracts interactively you can start a local Hardhat node:

```bash
npx hardhat node
```

In a separate terminal deploy contracts and run scripts using the `--network localhost` option.

Static analysis helpers are available via `npm run slither`, `npm run test:mythril` and `npm run test:manticore`.
