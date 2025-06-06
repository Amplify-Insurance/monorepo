import { ethers } from 'ethers';
import CatPool from '../abi/CatInsurancePool.json';

const provider = new ethers.JsonRpcProvider(
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
);

export const catPool = new ethers.Contract(
  process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
  CatPool,
  provider
);

export function getCatPoolWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string, CatPool, signer);
}

export async function getCatPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');
  const browserProvider = new ethers.BrowserProvider(window.ethereum);
  const signer = await browserProvider.getSigner();
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
    CatPool,
    signer,
  );
}
