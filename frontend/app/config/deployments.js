import deployedConfig from '../../../deployments/deployedAddresses.json';
import governanceConfig from '../../../deployments/governance_deployedAddresses.json';

let deployments = [];

try {

  const mapItem = (item, name = 'default') => ({
    name: item.name || name,
    riskManager: item.RiskManager,
    capitalPool: item.CapitalPool,
    backstopPool: item.CatInsurancePool,
    poolRegistry: item.PoolRegistry,
    policyManager: item.PolicyManager,
    priceOracle: item.PriceOracle,
    multicallReader: item.MulticallReader,
    lossDistributor: item.LossDistributor,
    rewardDistributor: item.RewardDistributor,
    policyNft: item.PolicyNFT,
    staking: item.StakingContract || governanceConfig.StakingContract,
    committee: item.Committee || governanceConfig.Committee,
    governanceToken: item.GovernanceToken || governanceConfig.GovernanceToken,
    rpcUrl: item.rpcUrl,
    subgraphUrl: item.subgraphUrl,
  });

  const json = deployedConfig;
  if (Array.isArray(json)) {
    deployments = json.map((d, i) => mapItem(d, d.name || `deploy${i}`));
  } else if (json) {
    deployments = [mapItem(json)];
  }
} catch (err) {
  console.error('Failed to load deployedAddresses.json', err);
}


export default deployments;

export function getDeployment(name) {
  return deployments.find((d) => d.name === name) || deployments[0];
}

export const STAKING_TOKEN_ADDRESS =
  deployments[0] && deployments[0].governanceToken;

export const COMMITTEE_ADDRESS = deployments[0] && deployments[0].committee;

export const PRICE_ORACLE_ADDRESS =
  deployments[0] && deployments[0].priceOracle;

export const MULTICALL_READER_ADDRESS =
  deployments[0] && deployments[0].multicallReader;
