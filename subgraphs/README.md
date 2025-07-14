# Subgraphs

This directory contains subgraph definitions for indexing the insurance
protocol contracts using [The Graph](https://thegraph.com/).

The `insurance` subgraph indexes events emitted by the protocol contracts
including `UnderwriterManager`, `RiskManager`, `ProtocolConfigurator`,
`CapitalPool`, `CatInsurancePool` and `PolicyNFT`. Each data source now has a
`deployment` context so multiple deployments can be indexed by duplicating the
entries in `subgraph.yaml` with different addresses and `deployment` names. The
repository includes blocks for both the original USDC deployment and a new ETH
deployment so they can be queried from a single subgraph. Update the placeholder
contract addresses before deployment. The manifest uses the new contract data
sources in place of the original monolithic `RiskManager` contract.

Entities include a `deployment` field allowing queries to filter by the
originating deployment.

It stores a minimal set of entities for demonstration purposes, including a
`ContractOwner` record that tracks the current owner address of each contract
via the `OwnershipTransferred` events.

## Building and Deploying

Install dependencies then generate the types and build the mappings:

```bash
cd subgraphs/insurance
npm install
npm run codegen
npm run build
```

Before deploying edit `subgraph.yaml` and replace the placeholder contract
addresses with the deployed values on your network. Once configured you can
deploy using the Graph CLI (requires an access token):

```bash
graph auth --product hosted-service <ACCESS_TOKEN>
npm run deploy -- --product hosted-service <GITHUB_USER>/<SUBGRAPH_NAME>
```

Refer to [The Graph documentation](https://thegraph.com/docs/en/deploying/subgra
phs/) for details on obtaining an access token and creating a subgraph.

## Running Locally

You can test the subgraph against a local Graph Node using Docker. The official
image exposes GraphQL on port **8000** and an admin API on **8020**:

```bash
docker run -p 8000:8000 -p 8020:8020 -p 8030:8030 -p 8040:8040 \
  ghcr.io/graphprotocol/graph-node:latest
```

Deploy the mappings to the local node:

```bash
cd subgraphs/insurance
npm run deploy -- --node http://localhost:8020/ --ipfs http://localhost:5001 \
  <SUBGRAPH_NAME>
```

Point the frontend at your local index by setting the following in
`frontend/.env`:

```bash
NEXT_PUBLIC_SUBGRAPH_URL=http://localhost:8000/subgraphs/name/<SUBGRAPH_NAME>
SUBGRAPH_URL=http://localhost:8000/subgraphs/name/<SUBGRAPH_NAME>
```

The UI will now query the locally indexed data instead of the hosted service.
