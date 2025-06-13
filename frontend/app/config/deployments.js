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
  deployments = [
    {
      name: 'default',
      riskManager: process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS,
      capitalPool: process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS,
      catPool: process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
      priceOracle: process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS,
    },
  ];
}

export default deployments;

export function getDeployment(name) {
  return deployments.find((d) => d.name === name) || deployments[0];
}
