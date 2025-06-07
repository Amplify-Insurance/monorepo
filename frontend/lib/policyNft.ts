import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

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
