import deployedConfig from '../../../deployedAddresses.json';

let deployments = [];

try {
  // Primary config file written by the deploy scripts

  const mapItem = (item, name = 'default') => ({
    name: item.name || name,
    riskManager: item.RiskManager,
    capitalPool: item.CapitalPool,
    catPool: item.CatInsurancePool,
    poolRegistry: item.PoolRegistry,
    poolManager: item.PolicyManager,
    priceOracle: item.PriceOracle,
    multicallReader: item.MulticallReader,
    lossDistributor: item.LossDistributor,
    rewardDistributor: item.RewardDistributor,
    policyNft: item.PolicyNFT,
    staking: item.StakingContract,
    committee: item.Committee,
    governanceToken: item.GovernanceToken,
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

if (!deployments.length) {
  const raw = process.env.NEXT_PUBLIC_DEPLOYMENTS;
  if (raw) {
    try {
      deployments = JSON.parse(raw);
    } catch (err) {
      console.error('Failed to parse NEXT_PUBLIC_DEPLOYMENTS', err);
    }
  }
}

if (!deployments.length) {
  deployments = [
    {
      name: 'default',
      riskManager: process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS,
      capitalPool: process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS,
      catPool: process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
      poolRegistry: process.env.NEXT_PUBLIC_POOL_REGISTRY_ADDRESS,
      poolManager: process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS,
      priceOracle: process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS,
      multicallReader: process.env.NEXT_PUBLIC_MULTICALL_READER_ADDRESS,
      lossDistributor: process.env.NEXT_PUBLIC_LOSS_DISTRIBUTOR_ADDRESS,
      rewardDistributor: process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS,
    },
  ];
}

export default deployments;

export function getDeployment(name) {
  return deployments.find((d) => d.name === name) || deployments[0];
}
