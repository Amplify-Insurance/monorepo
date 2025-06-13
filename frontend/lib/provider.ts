import { ethers } from 'ethers';
import deployments from '../app/config/deployments';

const DEFAULT_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? // browser
  process.env.RPC_URL ?? // server / CI
  'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe'; // fallback

const DEFAULT_CHAIN_ID = 8453;

export function getProvider(deploymentName?: string) {
  const dep = deployments.find((d) => d.name === deploymentName) ?? deployments[0] ?? ({} as any);
  const url = dep.rpcUrl ?? DEFAULT_RPC_URL;
  const chainId = dep.chainId ?? DEFAULT_CHAIN_ID;
  const name = dep.name ?? 'base';
  return new ethers.providers.StaticJsonRpcProvider(url, { name, chainId });
}

// Legacy default provider for convenience
export const provider = getProvider();
