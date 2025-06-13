import { ethers } from 'ethers';
import deployments from '../app/config/deployments';

const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  process.env.RPC_URL ??
  'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe';

const DEFAULT_CHAIN_ID = 8453;

/**
 * Return a StaticJsonRpcProvider for the given deployment name. If the
 * deployment is not found, fall back to the default RPC URL and chain ID.
 */
export function getProvider(deploymentName?: string) {
  let rpcUrl = DEFAULT_RPC_URL;
  let chainId = DEFAULT_CHAIN_ID;

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
