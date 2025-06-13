import { ethers } from 'ethers'
import CatPool from '../abi/CatInsurancePool.json'
import { getProvider, provider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string

export function getCatPool(
  address: string = DEFAULT_ADDRESS,
  prov = getProvider(),
) {
  return new ethers.Contract(address, CatPool, prov)
}

export const catPool = getCatPool()

export function getCatPoolWriter(prov = provider) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, prov);
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
    CatPool,
    signer,
  );
}

export async function getCatPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
    CatPool,
    signer
  );
}

export async function getUsdcAddress(prov = getProvider()) {
  const cp = new ethers.Contract(
    process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
    ['function usdc() view returns (address)'],
    prov,
  );
  return await cp.usdc();
}

export async function getUsdcDecimals(prov = getProvider()) {
  const addr = await getUsdcAddress(prov);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    prov,
  );
  return await token.decimals();
}

export async function getCatShareAddress(prov = getProvider()) {
  const cp = new ethers.Contract(
    process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string,
    ['function catShareToken() view returns (address)'],
    prov,
  );
  return await cp.catShareToken();
}

export async function getCatShareDecimals(prov = getProvider()) {
  const addr = await getCatShareAddress(prov);
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    prov,
  );
  return await token.decimals();
}



