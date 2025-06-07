import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';
import 'server-only';

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  process.env.RPC_URL ??
  'https://rpc.tenderly.co/v1/testnet/<your-vnet-uuid>';

export const provider = new ethers.providers.StaticJsonRpcProvider(
  RPC_URL,
  {
    name: 'tenderly-vnet',   // label is just cosmetic
    chainId: 8450,           // your custom Tenderly chain-id
  },
);

const rpc = process.env.NEXT_PUBLIC_RPC_URL;
console.log('RPC URL:', rpc);


export const policyNft = new ethers.Contract(
  process.env.POLICY_NFT_ADDRESS as string,
  PolicyNFT,
  provider
);

export function getPolicyNftWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(process.env.POLICY_NFT_ADDRESS as string, PolicyNFT, signer);
}
