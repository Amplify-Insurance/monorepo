import { ethers } from 'ethers';
import CatPool from '../abi/CatInsurancePool.json';
import { getProvider, provider } from './provider';

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string;

export function getCatPool(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, CatPool, getProvider(deployment));
}
export const catPool = getCatPool();

export function getCatPoolWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, getProvider(deployment));
  return new ethers.Contract(address, CatPool, signer);
}

export async function getCatPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    DEFAULT_ADDRESS,
    CatPool,
    signer,
  );
}

export async function getUsdcAddress(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const cp = new ethers.Contract(
    address,
    ['function usdc() view returns (address)'],
    getProvider(deployment),
  );
  return await cp.usdc();
}

export async function getUsdcDecimals(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const addr = await getUsdcAddress(address, deployment);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    getProvider(deployment),
  );
  return await token.decimals();
}

export async function getCatShareAddress(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const cp = new ethers.Contract(
    address,
    ['function catShareToken() view returns (address)'],
    getProvider(deployment),
  );
  return await cp.catShareToken();
}

export async function getCatShareDecimals(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const addr = await getCatShareAddress(address, deployment);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    getProvider(deployment),
  );
  return await token.decimals();
}



