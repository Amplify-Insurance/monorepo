import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';
import { getProvider, provider } from './provider';

const rpc = process.env.NEXT_PUBLIC_RPC_URL;
console.log('RPC URL:', rpc);


const READ_ADDRESS =
  process.env.NEXT_PUBLIC_POLICY_NFT_ADDRESS ??
  process.env.POLICY_NFT_ADDRESS;

if (!READ_ADDRESS) {
  console.error('❌  POLICY_NFT_ADDRESS env var is missing');
  throw new Error('POLICY_NFT_ADDRESS not set');
}

export function getPolicyNft(address: string = READ_ADDRESS as string, deployment?: string) {
  return new ethers.Contract(address, PolicyNFT, getProvider(deployment));
}

export const policyNft = getPolicyNft();

export function getPolicyNftWriter(address: string = process.env.POLICY_NFT_ADDRESS as string, deployment?: string) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, getProvider(deployment));
  return new ethers.Contract(address, PolicyNFT, signer);
}
