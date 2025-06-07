# Subgraphs

This directory contains subgraph definitions for indexing the CoverPool
protocol contracts using [The Graph](https://thegraph.com/).

The `insurance` subgraph indexes events emitted by `CoverPool`,
`CatInsurancePool` and `PolicyNFT`. Update the contract addresses in
`subgraph.yaml` before deployment.

It stores a minimal set of entities for demonstration purposes, including a
`ContractOwner` record that tracks the current owner address of each contract
via the `OwnershipTransferred` events.

Run `npm install` then `npm run codegen && npm run build` inside the
subgraph directory to generate and build the subgraph.
