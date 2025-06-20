import { ethers } from 'ethers';
import CapitalPool from '../abi/CapitalPool.json';
import { getProvider, provider } from './provider';
import deployments from '../app/config/deployments';

const DEFAULT_ADDRESS = deployments[0]?.capitalPool as string;

if (!DEFAULT_ADDRESS) {
  console.error('❌  CapitalPool address not configured');
  throw new Error('CapitalPool address not set');
}

export function getCapitalPool(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, CapitalPool, getProvider(deployment));
}

export const capitalPool = getCapitalPool();

export async function getCapitalPoolWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(address, CapitalPool, signer);
}

export function getCapitalPoolWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, getProvider(deployment));
  return new ethers.Contract(address, CapitalPool, signer);
}

// Helper to query the underlying ERC20 asset used by the capital pool
export async function getUnderlyingAssetAddress(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const cp = new ethers.Contract(address, ['function underlyingAsset() view returns (address)'], getProvider(deployment));
  return await cp.underlyingAsset();
}

export async function getUnderlyingAssetDecimals(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const assetAddr = await getUnderlyingAssetAddress(address, deployment);
  const token = new ethers.Contract(
    assetAddr,
    ['function decimals() view returns (uint8)'],
    getProvider(deployment),
  );
  return await token.decimals();
}

export async function getUnderlyingAssetBalance(address: string, poolAddr: string = DEFAULT_ADDRESS, deployment?: string) {
  const assetAddr = await getUnderlyingAssetAddress(poolAddr, deployment);
  const token = new ethers.Contract(
    assetAddr,
    ['function balanceOf(address) view returns (uint256)'],
    getProvider(deployment),
  );
  return await token.balanceOf(address);
}
