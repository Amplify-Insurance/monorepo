import { ethers } from 'ethers';
import 'server-only';           // keeps this file out of the browser bundle

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??     // dev in the browser
  process.env.RPC_URL ??                 // server / CI
  'https://rpc.tenderly.co/v1/testnet/<your-vnet-uuid>';  // hard-coded fallback

export const provider = new ethers.providers.StaticJsonRpcProvider(
  RPC_URL,
  {
    name: 'tenderly-vnet',   // cosmetic label
    chainId: 8450,           // matches your TVN override
  },
);
