import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';
import { getProvider } from './provider';

const rpc = process.env.NEXT_PUBLIC_RPC_URL;
console.log('RPC URL:', rpc);


const READ_ADDRESS =
  process.env.NEXT_PUBLIC_POLICY_NFT_ADDRESS ??
  process.env.POLICY_NFT_ADDRESS;

if (!READ_ADDRESS) {
  console.error('❌  POLICY_NFT_ADDRESS env var is missing');
  throw new Error('POLICY_NFT_ADDRESS not set');
}

export const policyNft = new ethers.Contract(
  READ_ADDRESS as string,
  PolicyNFT,
  getProvider(),
);

export function getPolicyNftWriter(provider = getProvider()) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(process.env.POLICY_NFT_ADDRESS as string, PolicyNFT, signer);
}
