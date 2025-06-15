# Subgraphs

This directory contains subgraph definitions for indexing the insurance
protocol contracts using [The Graph](https://thegraph.com/).

The `insurance` subgraph indexes events emitted by `RiskManagerV2`,
`CapitalPool`, `CatInsurancePool` and `PolicyNFT`. Each data source now has a
`deployment` context so multiple deployments can be indexed by duplicating the
entries in `subgraph.yaml` with different addresses and `deployment` names.
Update the placeholder contract addresses before deployment. The manifest uses
the new `RiskManagerV2` data source in place of the original `RiskManager`
contract.

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
