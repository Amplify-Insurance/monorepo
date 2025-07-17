import { ethers } from 'ethers';
import deployments from '../app/config/deployments';
import { CHAIN_MAP } from '../app/config/chains';

let currentChainId = 8453;
if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem('chainId');
  if (stored) currentChainId = parseInt(stored, 10);
}

export function setCurrentChainId(id: number) {
  currentChainId = id;
}

function getRpcUrl() {
  const chain = CHAIN_MAP[currentChainId];
  return (
    chain?.rpcUrls?.default?.http[0] ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.RPC_URL ||
    'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe'
  );
}

/**
 * Return a StaticJsonRpcProvider for the given deployment name. If the
 * deployment is not found, fall back to the default RPC URL and chain ID.
 */
export function getProvider(deploymentName?: string) {
  let rpcUrl = getRpcUrl();
  let chainId = currentChainId;

  if (deploymentName) {
    const dep = deployments.find((d) => d.name === deploymentName);
    if (dep) {
      if (dep.rpcUrl) rpcUrl = dep.rpcUrl;
      if ((dep as any).chainId) chainId = (dep as any).chainId;
    }
  }

  return new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
    name: deploymentName || 'default',
    chainId,
  });
}

/** Default provider using the first configured deployment or env vars. */
export const provider = getProvider(deployments[0]?.name);
