import { ethers } from 'ethers';
import CatPool from '../abi/CatInsurancePool.json';

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

export const catPool = new ethers.Contract(
  process.env.CAT_POOL_ADDRESS as string,
  CatPool,
  provider
);

export function getCatPoolWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(process.env.CAT_POOL_ADDRESS as string, CatPool, signer);
}
