const raw = process.env.NEXT_PUBLIC_DEPLOYMENTS;
let deployments = [];

if (raw) {
  try {
    deployments = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse NEXT_PUBLIC_DEPLOYMENTS', err);
  }
}

if (!deployments.length) {
  try {
    // Fallback to addresses written by the deploy scripts
    const fs = require('fs');
    const path = require('path');
    const file = path.join(process.cwd(), '..', 'deployedAddresses.json');
    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      deployments = [
        {
          name: 'default',
          riskManager: json.RiskManager,
          capitalPool: json.CapitalPool,
          catPool: json.CatInsurancePool,
          poolRegistry: json.PoolRegistry,
          poolManager: json.PolicyManager,
          priceOracle: json.PriceOracle,
          multicallReader: json.MulticallReader,
          lossDistributor: json.LossDistributor,
          rewardDistributor: json.RewardDistributor,
        },
      ];
    }
  } catch (err) {
    console.error('Failed to load deployedAddresses.json', err);
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
