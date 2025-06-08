import { ethers } from 'ethers';
import 'server-only';           // keeps this file out of the browser bundle

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
