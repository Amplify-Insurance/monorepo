import { ethers } from 'ethers';

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??     // dev in the browser
  process.env.RPC_URL ??                 // server / CI
  'https://mainnet.base.org';  // fallback

export const provider = new ethers.providers.StaticJsonRpcProvider(
  RPC_URL,
  {
    name: 'base',
    chainId: 8453,
  },
);
