import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';
import { getProvider, provider } from './provider';
import deployments from '../app/config/deployments';

const rpc = process.env.NEXT_PUBLIC_RPC_URL;
console.log('RPC URL:', rpc);


const READ_ADDRESS = deployments[0]?.policyNft as string;

if (!READ_ADDRESS) {
  console.error('❌  PolicyNFT address not configured');
  throw new Error('POLICY_NFT_ADDRESS not set');
}

export function getPolicyNft(address: string = READ_ADDRESS as string, deployment?: string) {
  return new ethers.Contract(address, PolicyNFT, getProvider(deployment));
}

export const policyNft = getPolicyNft();

export function getPolicyNftWriter(address: string = READ_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, getProvider(deployment));
  return new ethers.Contract(address, PolicyNFT, signer);
}
