import { ethers } from 'ethers';
import CapitalPool from '../abi/CapitalPool.json';
import { provider } from './provider';

export const capitalPool = new ethers.Contract(
  process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS as string,
  CapitalPool,
  provider,
);

export async function getCapitalPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS as string,
    CapitalPool,
    signer,
  );
}

export function getCapitalPoolWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS as string,
    CapitalPool,
    signer,
  );
}
