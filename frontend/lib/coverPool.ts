import { ethers } from 'ethers'
import CoverPool from '../abi/CoverPool.json'
import { provider } from './provider'

export const coverPool = new ethers.Contract(
  process.env.COVER_POOL_ADDRESS as string,
  CoverPool,
  provider
);

export function getCoverPoolWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(process.env.COVER_POOL_ADDRESS as string, CoverPool, signer);
}
