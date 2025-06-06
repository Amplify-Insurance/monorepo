import { ethers } from 'ethers';
import CoverPool from '../abi/CoverPool.json';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export const coverPool = new ethers.Contract(
  process.env.COVER_POOL_ADDRESS as string,
  CoverPool,
  provider
);
