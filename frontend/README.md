# Amplify Insurance Frontend

This directory contains a minimal Next.js dApp for interacting with the CoverPool contracts.

## Development

Install dependencies and start the development server:

```bash
cd frontend
npm install
npm run dev
```

Environment variables such as RPC endpoints are configured in `.env` (see `.env.example`). Contract addresses come from `deployments/deployedAddresses.json` which is written by the Hardhat deploy scripts. The file `app/config/deployments.js` reads this configuration so addresses do not need to be provided via environment variables. ABIs live under `frontend/abi`.

## Running a Local Subgraph

The frontend fetches historical data from a Graph Node. You can run one locally:

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
`http://localhost:8000/subgraphs/name/<SUBGRAPH_NAME>` so the UI queries your
local index.

## API Routes

Several API routes under `app/api` expose contract data:

- `GET /api/pools` – number of pools
- `GET /api/pools/list` – detailed info for all pools
- `GET /api/pools/[id]` – info and underwriters for a specific pool
- `GET /api/pools/[id]/history` – utilisation snapshots for a pool
- `GET /api/underwriters/[address]` – account details for an underwriter
- `GET /api/adapters` – active yield adapter addresses
- `GET /api/underwriters/[address]/allocated/[poolId]` – check an underwriter's pool allocation
- `GET /api/underwriters/[address]/losses/[poolId]` – pending losses for a pool
- `GET /api/underwriters/[address]/rewards/[poolId]` – pending reward tokens
- `GET /api/catpool/liquidusdc` – BackstopPool liquid USDC value
- `GET /api/catpool/apr` – BackstopPool adapter APR
- `GET /api/catpool/user/[address]` – BackstopPool account details
- `GET /api/catpool/rewards/[address]/[token]` – claimable distressed asset rewards
- `GET /api/committee/user/[address]` – unclaimed committee rewards
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
- `POST /api/committee/claim` – claim committee proposal rewards

## Multiple Deployments

The frontend can aggregate data from several deployments by adding entries to
`deployments/deployedAddresses.json`. Each object may also include optional RPC
and subgraph endpoints.

Supported keys:

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
- `committee` – `Committee` contract address (if governance is enabled)

Example configuration:

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
  }
]
```

If `rpcUrl` or `subgraphUrl` is omitted, the server will use the `RPC_URL` and
`SUBGRAPH_URL` variables from `.env`.

## Tests

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
