import { ethers } from 'ethers'
import CatPool from '../abi/CatInsurancePool.json'
import { getProvider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS as string

export function getCatPool(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  return new ethers.Contract(address, CatPool, provider)
}

export const catPool = getCatPool()

export function getCatPoolWriter(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(address, CatPool, signer);
}

export async function getCatPoolWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(address, CatPool, signer);
}

export async function getUsdcAddress(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  const cp = new ethers.Contract(
    address,
    ['function usdc() view returns (address)'],
    provider,
  )
  return await cp.usdc();
}

export async function getUsdcDecimals(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  const addr = await getUsdcAddress(address, provider)
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    provider,
  );
  return await token.decimals();
}

export async function getCatShareAddress(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  const cp = new ethers.Contract(
    address,
    ['function catShareToken() view returns (address)'],
    provider,
  )
  return await cp.catShareToken();
}

export async function getCatShareDecimals(
  address: string = DEFAULT_ADDRESS,
  provider = getProvider(),
) {
  const addr = await getCatShareAddress(address, provider)
  const token = new ethers.Contract(
    addr,
    ['function decimals() view returns (uint8)'],
    provider,
  );
  return await token.decimals();
}



