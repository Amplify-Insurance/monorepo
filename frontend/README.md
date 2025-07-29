# Frontend

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


A minimal Next.js project lives under `frontend/` for interacting with the contracts.
Install dependencies and run the development server with:

```bash
cd frontend
npm install
npm run dev
```

Environment variables such as the RPC endpoint are configured in `.env` (see
`.env.example`). Contract addresses are loaded solely from
`deployments/deployedAddresses.json` written by the Hardhat deploy scripts.
`frontend/app/config/deployments.js` reads this file and exposes the addresses to
the frontend. Environment variables are no longer used for contract addresses.

The ABIs for each contract live under `frontend/abi`, so only the addresses need
to be provided. Several API routes under `app/api` demonstrate reading data from
the contracts. Examples include:

## Endpoints

- `GET /api/pools` – number of pools
- `GET /api/pools/list` – detailed info for all pools
- `GET /api/pools/[id]` – info and underwriters for a specific pool
- `GET /api/pools/[id]/history` – utilisation snapshots for a pool
- `GET /api/underwriters/[address]` – account details for an underwriter
- `GET /api/adapters` – active yield adapter addresses
- `GET /api/underwriters/[address]/allocated/[poolId]` – check an underwriter's pool allocation
- `GET /api/underwriters/[address]/losses/[poolId]` – pending losses for a pool
- `GET /api/underwriters/[address]/rewards/[poolId]` – pending reward token balance
- `GET /api/catpool/liquidusdc` – BackstopPool liquid USDC value
- `GET /api/catpool/apr` – BackstopPool adapter APR
- `GET /api/catpool/user/[address]` – BackstopPool account details
- `GET /api/catpool/rewards/[address]/[token]` – claimable distressed asset rewards
- `GET /api/committee/user/[address]` – active proposal bonds for an address
- `GET /api/analytics` – protocol usage metrics
- `GET /api/claims` – list of processed claims
- `GET /api/prices/[token]` – latest token price
- `GET /api/reserve-config` – protocol configuration values
- `GET /api/staking/user/[address]` – staking info for an address
- `GET /api/policies/[id]` – fetch details for a Policy NFT
- `GET /api/policies/user/[address]` – Policy NFTs owned by an address
State‑changing routes use **POST** requests:
- `POST /api/catpool/deposit` – add USDC liquidity to the catastrophe pool
- `POST /api/catpool/withdraw` – withdraw USDC from the catastrophe pool
- `POST /api/catpool/claim` – claim protocol asset rewards
- `POST /api/coverpool/deposit` – underwriter deposit and allocation
- `POST /api/coverpool/request-withdrawal` – initiate a capital withdrawal
- `POST /api/coverpool/execute-withdrawal` – finalise a pending withdrawal
- `POST /api/coverpool/purchase` – purchase cover from a pool
- `POST /api/coverpool/claim` – process a claim
- `POST /api/coverpool/settle` – settle outstanding premiums
- `POST /api/committee/claim` – claim committee rewards

### Multiple Deployments

The frontend can aggregate contract data from several deployments by adding
entries to `deployments/deployedAddresses.json`. Each object may also include
optional RPC and Subgraph endpoints.

Each deployment object supports the following keys:

- `name` – label reported in API responses
- `riskManager` – `RiskManager` contract address
- `capitalPool` – `CapitalPool` contract address
- `catInsurancePool` – `BackstopPool` contract address
- `priceOracle` – `PriceOracle` contract address
- `multicallReader` – `MulticallReader` contract address
- `lossDistributor` – `LossDistributor` contract address
- `rewardDistributor` – `RewardDistributor` contract address
- `rpcUrl` – RPC endpoint for read‑only queries
- `subgraphUrl` – GraphQL endpoint for the deployment's subgraph

Example:

```json
[
  {
    "name": "base",
    "riskManager": "0xabc...",
    "capitalPool": "0xdef...",
    "catInsurancePool": "0xghi...",
    "lossDistributor": "0xlmn...",
    "rewardDistributor": "0xopq...",
    "priceOracle": "0xjkl...",
    "multicallReader": "0x123...",
    "rpcUrl": "https://base.publicnode.com",
    "subgraphUrl": "https://api.thegraph.com/subgraphs/name/project/base"
  },
  {
    "name": "optimism",
    "riskManager": "0x123...",
    "capitalPool": "0x456...",
    "catInsurancePool": "0x789...",
    "lossDistributor": "0xuvw...",
    "rewardDistributor": "0xyz...",
    "priceOracle": "0xabc...",
    "multicallReader": "0xdef...",
    "rpcUrl": "https://optimism.publicnode.com",
    "subgraphUrl": "https://api.thegraph.com/subgraphs/name/project/optimism"
  }
]
```

The API routes iterate over each deployment, combining results so callers see a
single aggregated view across all configured deployments.

To provide defaults when `rpcUrl` or `subgraphUrl` are omitted you can also set
the server‑side `RPC_URL` and `SUBGRAPH_URL` variables in `.env`.

### Running Tests

Frontend unit tests use **Vitest** with React Testing Library:

```bash
cd frontend
npm run test
```

Subgraph mappings can be tested with **matchstick-as**:

```bash
cd subgraphs/insurance
npm run test
```

Solidity fuzz tests use **Foundry**:

```bash
forge install
forge test
```

