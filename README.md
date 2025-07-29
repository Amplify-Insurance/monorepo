# CoverPool Contracts

Amplify Insurance is building a modular, open-source insurance marketplace where underwriters supply USDC liquidity, policy-holders buy cover on specific DeFi or real-world risks, and the whole life-cycle is enforced by Solidity smart-contracts. The code lives in a Hardhat monorepo; the `contracts/` package is the heart of the system, and all figures below refer to that codebase.

## Amplify Insurance’s on-chain cover protocol – high-level summary

### Core building blocks

- **CapitalPool** – a vault that accepts underwriter deposits, sends idle funds to external “yield adapters”, and keeps an accounting of profits, losses and withdrawal queues.
- **PolicyManager** – the single user-facing entry point: it mints an ERC-721 `PolicyNFT` for every policy sold, tracks premiums, and burns the NFT on expiry or claim.
- **RiskManager** – orchestrates the movement of funds between pools during allocations, premium collection and claim payouts, using the `LossDistributor` and `RewardDistributor` helpers for pro-rata maths.
- **PoolRegistry** – a registry where each “risk pool” lives with its utilisation-based premium curve, whitelist of accepted collateral and active yield adapter.

### Liquidity & premium flows

Underwriters deposit USDC → `CapitalPool` optionally stakes it in Aave, Compound, Euler, Moonwell or Morpho via plug-in adapters → yield flows back to the pool. When a policy-holder buys cover, `PolicyManager` pulls capital from the relevant risk pool, mints a `PolicyNFT` and streams premiums (block-by-block) back to underwriters. A small slice of every premium goes to the `BackstopPool` – a catastrophe back-stop fund issued as `CatShare` ERC-20 tokens. The README diagrams (“Underwriter Capital Flow” & “Distressed Capital Flow”) illustrate these paths in detail.

## Directory Layout

```
contracts/               Solidity sources
├─ core/                 Core contracts
│  ├─ CapitalPool.sol       Underwriter vault and yield adapter hooks
│  ├─ PoolRegistry.sol      Registry of risk pools and rate models
│  ├─ PolicyManager.sol     User-facing policy lifecycle logic
│  └─ RiskManager.sol       Coordinates allocation, claims and payouts
├─ external/             Optional backstop modules
│  └─ BackstopPool.sol  Secondary pool funded by premiums
├─ governance/           DAO style governance
│  ├─ Committee.sol
│  └─ Staking.sol
├─ utils/                Misc utilities
│  ├─ ContractRegistry.sol
│  ├─ DeploymentRegistry.sol
│  ├─ MulticallReader.sol
│  ├─ LossDistributor.sol
│  └─ RewardDistributor.sol
├─ adapters/             Yield strategy implementations
│  ├─ AaveV3Adapter.sol
│  ├─ CompoundV3Adapter.sol
│  ├─ EulerAdapter.sol
│  ├─ MoonwellAdapter.sol
│  └─ MorhpoAdapter.sol
├─ tokens/               ERC20/721 tokens used by the protocol
│  ├─ CatShare.sol
│  ├─ PolicyNFT.sol
│  └─ OShare.sol
├─ oracles/              Price feeds
│  └─ PriceOracle.sol
├─ interfaces/           Shared protocol interfaces
└─ test/                 Mock contracts for unit tests

frontend/                Next.js dApp for interacting with the contracts
scripts/                 Deployment and helper scripts
subgraphs/               The Graph subgraph definitions
test/                    JavaScript test suite
hardhat.config.js        Hardhat configuration
package.json             Project dependencies and scripts
```

## Requirements

- Node.js (>=18)
- npm (>=9)
- Network access to the npm registry

Install dependencies with:

```bash
npm install
```
You can also run Hardhat commands via `scripts/hardhat.sh` which
automatically installs dependencies if `node_modules` is missing.

## Usage

Compile contracts with:

```bash
npx hardhat compile
```

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

## Contracts Overview

- **CapitalPool** – Holds underwriter funds and interacts with yield adapters. Losses and withdrawals are accounted here.
- **PolicyManager** – User entrypoint for purchasing cover. Mints and burns `PolicyNFT` tokens.
- **RiskManager** – Coordinates pool allocations, claims processing and rewards through `LossDistributor` and `RewardDistributor`.
- **PoolRegistry** – Stores pool parameters, rate models and active adapters for each risk pool.
- **BackstopPool** – Collects a share of premiums and provides additional liquidity during large claims. Calling `setRewardDistributor` now configures the distributor's cat pool automatically so users can claim protocol asset rewards without extra setup.
- **Governance (Committee & Staking)** – Simple on‑chain governance used for pausing pools and slashing misbehaving stakers.
- **DeploymentRegistry** – Records the addresses of all protocol components for each deployment.

## Running a Local Node

To experiment with the contracts interactively you can start a local Hardhat node:

```bash
npx hardhat node
```

In a separate terminal deploy contracts and run scripts using the `--network localhost` option.

## Running a Local Subgraph

The frontend fetches historical data from a Graph Node. You can index the
contracts locally by running the official Docker image:

```bash
docker run -p 8000:8000 -p 8020:8020 -p 8030:8030 -p 8040:8040 \
  ghcr.io/graphprotocol/graph-node:latest
```

Deploy the subgraph:

```bash
cd subgraphs/insurance
npm run deploy -- --node http://localhost:8020/ --ipfs http://localhost:5001 \
  <SUBGRAPH_NAME>
```

Set `NEXT_PUBLIC_SUBGRAPH_URL` and `SUBGRAPH_URL` in `frontend/.env` to
`http://localhost:8000/subgraphs/name/<SUBGRAPH_NAME>` so the UI queries the
local index.

## Further Reading

The unit tests under `test/` demonstrate common interactions such as underwriting deposits, premium payments and withdrawals.  Examine `test/RiskManager.test.js` for detailed examples of calling the contracts.

See [frontend/README.md](./frontend/README.md) for instructions on running the dApp and available API routes.



## License

This project is licensed under the **Business Source License 1.1**. See [LICENSE](./LICENSE) for details.

## Underwriter Capital Flow

```mermaid
graph TD
  %% Phase 1: De-allocating from a Risk Pool
  subgraph Phase1 ["Phase 1: De-allocating from a Risk Pool (RiskManager Contract)"]
    A[Start: Underwriter wants to withdraw capital from a pool]
    A --> B[1. Calls requestDeallocateFromPool poolId, amount]
    B --> C[Contract fetches pool data:<br/>totalPledged All LP capital<br/>totalSold Live policy coverage<br/>pendingWithdrawal Other LPs withdrawing]
    C --> D{Is amount ≤ freeCapital?<br/><br/>freeCapital = totalPledged − totalSold − pendingWithdrawal}
    D -->|No: Not Enough Free Capital| E[REJECTED<br/>Transaction reverts with InsufficientFreeCapital error]
    E --> F[Withdrawal Blocked<br/>Capital is locked to back live policies]
    D -->|Yes: Enough Free Capital| G[ACCEPTED<br/>Request is logged and notice period timer starts]
    G --> H[Underwriter must wait for the deallocationNoticePeriod to end]
    H --> I[2. After waiting, calls deallocateFromPool poolId]
    I --> J{Is Notice Period over?}
    J -->|No| K[REJECTED<br/>Transaction reverts with NoticePeriodActive error]
    K --> H
    J -->|Yes| L[SUCCESS<br/>Capital is de-allocated from the risk pool]
  end

  %% Phase 2: Withdrawing from the System
  subgraph Phase2 ["Phase 2: Withdrawing from the System (CapitalPool Contract)"]
    L --> M[Capital is now considered 'free' inside the main CapitalPool]
    M --> N[3. Underwriter calls executeWithdrawal on the CapitalPool contract]
    N --> O[Funds Returned<br/>Underwriter receives their capital]
  end

  %% Styling
  classDef rejected fill:#ffeded,stroke:#ff5555,stroke-width:2px
  classDef success fill:#e8f5e9,stroke:#55a65a,stroke-width:2px
  
  class F rejected
  class O success
```


```mermaid
graph TD
    Underwriter -->|deposit USDC| CapitalPool
    CapitalPool -->|invest| YieldAdapter
    YieldAdapter -->|yield| CapitalPool
    Policyholder -->|buy policy| PolicyManager
    PolicyManager -->|mint NFT| PolicyNFT
    PolicyManager -->|notify| RiskManager
    Policyholder -->|pay premium| PolicyManager
    PolicyManager -->|rewards| RewardDistributor
    PolicyManager -->|share| BackstopPool
```

## Distressed Capital Flow During Claims

```mermaid
graph TD
    Policyholder -->|file claim| RiskManager
    RiskManager -->|distribute loss| LossDistributor
    RiskManager -->|draw backstop| BackstopPool
    RiskManager -->|request payout| CapitalPool
    CapitalPool -->|withdraw funds| YieldAdapter
    CapitalPool -->|pay out| Policyholder
    Underwriter -.->|capital reduced| CapitalPool
    BackstopPool -->|protocol assets| RewardDistributor
```
