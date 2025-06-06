import { ethers } from 'ethers';
import PolicyNFT from '../abi/PolicyNFT.json';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export const policyNft = new ethers.Contract(
  process.env.POLICY_NFT_ADDRESS as string,
  PolicyNFT,
  provider
);
