# CoverPool Contracts

This repository contains a Hardhat project implementing a prototype insurance system for on‑chain assets.  The project is centred around the **CoverPool** contract which allows underwriters to provide liquidity and sell cover for specific protocol risks.  Policy positions are represented by NFTs and a separate **CatInsurancePool** acts as an additional backstop fund.

## Directory Layout

```
contracts/               Solidity sources
├─ CoverPool.sol         Main pool that handles underwriting and claims
├─ CatInsurancePool.sol  Pool that collects a share of premiums and covers losses
├─ CatShare.sol          ERC20 token representing CatInsurancePool shares
├─ PolicyNFT.sol         ERC721 token representing active cover
├─ oShare.sol            ERC20 receipt token for underwriter deposits
├─ MockERC20.sol         Simple ERC20 used in tests
├─ MockYieldAdapter.sol  Test adapter implementing IYieldAdapter
├─ SdaiAdapter.sol       Example adapter for depositing into sDAI
├─ adapters/
│  ├─ AaveV3Adapter.sol     IYieldAdapter wrapper for Aave V3
│  └─ CompoundV3Adapter.sol IYieldAdapter wrapper for Compound V3
└─ interfaces/           Minimal interfaces used by adapters

hardhat.config.ts        Hardhat configuration
package.json             Project dependencies and scripts
test/                    Mocha/Chai tests
```

## Requirements

- Node.js (>=18)
- npm

Install dependencies with:

```bash
npm install
```

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

The default network configuration uses Hardhat's in‑memory chain.  Modify `hardhat.config.ts` to add or customise networks.

## Contracts Overview

- **CoverPool** – Core contract where underwriters deposit stablecoins, allocate capital to specific risk pools and earn premium income.  Premiums are calculated using utilisation‑based rate models.  Claims burn policy NFTs and distribute losses among the relevant underwriters.  Optionally integrates with yield adapters for idle capital.
- **CatInsurancePool** – Collects a portion of premiums from `CoverPool` and can provide extra liquidity during large claims.  Liquidity providers receive `CatShare` tokens representing their share of the pool and can claim protocol assets recovered from claims.
- **PolicyNFT** – ERC721 that tracks each active policy.  Policies store coverage amount, associated risk pool and the timestamp of last paid premium.
- **Yield Adapters** – Contracts implementing `IYieldAdapter` allow depositing idle funds into external protocols (e.g. an sDAI adapter or mocks for testing).

## Running a Local Node

To experiment with the contracts interactively you can start a local Hardhat node:

```bash
npx hardhat node
```

In a separate terminal deploy contracts and run scripts using the `--network localhost` option.

## Further Reading

The unit tests under `test/` demonstrate common interactions such as underwriting deposits, premium payments and withdrawals.  Examine `test/CoverPool.test.js` for detailed examples of calling the contracts.


## Frontend

A minimal Next.js project lives under `frontend/` for interacting with the contracts.
Install dependencies and run the development server with:

```bash
cd frontend
npm install
npm run dev
```

Environment variables such as the RPC endpoint and deployed contract addresses can
be configured in `.env` (see `.env.example`). Several API routes under
`app/api` demonstrate reading data from the contracts. Examples
include:

- `GET /api/pools` – number of pools
- `GET /api/pools/list` – detailed info for all pools
- `GET /api/pools/[id]` – info and underwriters for a specific pool
- `GET /api/underwriters/[address]` – account details for an underwriter
- `GET /api/adapters` – active yield adapter addresses
- `GET /api/underwriters/[address]/allocated/[poolId]` – check an underwriter's pool allocation
- `GET /api/catpool/liquidusdc` – CatInsurancePool liquid USDC value
- `GET /api/catpool/rewards/[address]/[token]` – claimable distressed asset rewards
- `GET /api/policies/[id]` – fetch details for a Policy NFT

## License

This project is licensed under the **Business Source License 1.1**. See [LICENSE](./LICENSE) for details.



flowchart TD
    %% ─────────────── Participants ───────────────
    U[User / dApp]:::ext
    RM[RiskManager]:::core
    CP[CapitalPool]:::core
    subgraph Pools
        direction TB
        P0[RiskPool 0 <br> (Protocol A)]
        P1[RiskPool 1 <br> (Protocol B)]
        Pn[…]
    end
    Token[Underlying<br>ERC-20]:::asset
    CovNFT[Coverage Token<br>(ERC-721 / 1155)]:::asset
    RateModel[(RateModel<br>struct)]:::lib

    %% ─────────────── Relations ───────────────
    %% purchase flow
    U -- "purchaseCover(poolId, amount)" --> RM
    RM -- "mints" --> CovNFT
    RM -- "transfers premium" --> CP
    %% provide flow
    U -- "ERC-20 approve()" --> Token
    U -- "deposit(amount)" --> CP
    CP -- "allocateCapital(ids)" --> RM
    %% capital allocation
    RM -- "add/remove liquidity" --> Pools
    Pools -- "protocol loss events\n call out to RM" --> RM
    RM -- "pay claims\n (burn NFT, pay out)" --> CovNFT
    RM -- "draw liquidity" --> CP
    %% misc links
    RM -- "uses" --> RateModel
    CP -- "holds collateral" --> Token

    %% ─────────────── Styles ───────────────
    classDef core     fill:#d0e3ff,stroke:#4285f4,color:#000;
    classDef asset    fill:#fff8dc,stroke:#d48b00,color:#000;
    classDef ext      fill:#e8e8e8,stroke:#777,color:#000;