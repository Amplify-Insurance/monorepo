import { ethers } from 'ethers';
import CapitalPool from '../abi/CapitalPool.json';
import { provider } from './provider';

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS as string;

export function getCapitalPool(address: string = DEFAULT_ADDRESS) {
  return new ethers.Contract(address, CapitalPool, provider);
}

export const capitalPool = getCapitalPool();

export async function getCapitalPoolWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(address, CapitalPool, signer);
}

export function getCapitalPoolWriter(address: string = DEFAULT_ADDRESS) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(address, CapitalPool, signer);
}

// Helper to query the underlying ERC20 asset used by the capital pool
export async function getUnderlyingAssetAddress(address: string = DEFAULT_ADDRESS) {
  const cp = new ethers.Contract(address, ['function underlyingAsset() view returns (address)'], provider);
  return await cp.underlyingAsset();
}

export async function getUnderlyingAssetDecimals(address: string = DEFAULT_ADDRESS) {
  const assetAddr = await getUnderlyingAssetAddress(address);
  const token = new ethers.Contract(
    assetAddr,
    ['function decimals() view returns (uint8)'],
    provider,
  );
  return await token.decimals();
}

export async function getUnderlyingAssetBalance(address: string, poolAddr: string = DEFAULT_ADDRESS) {
  const assetAddr = await getUnderlyingAssetAddress(poolAddr);
  const token = new ethers.Contract(
    assetAddr,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return await token.balanceOf(address);
}
