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

// Helper to query the underlying ERC20 asset used by the capital pool
export async function getUnderlyingAssetAddress() {
  const cp = new ethers.Contract(
    process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS as string,
    ['function underlyingAsset() view returns (address)'],
    provider,
  );
  return await cp.underlyingAsset();
}

export async function getUnderlyingAssetDecimals() {
  const assetAddr = await getUnderlyingAssetAddress();
  const token = new ethers.Contract(
    assetAddr,
    ['function decimals() view returns (uint8)'],
    provider,
  );
  return await token.decimals();
}

export async function getUnderlyingAssetBalance(address: string) {
  const assetAddr = await getUnderlyingAssetAddress();
  const token = new ethers.Contract(
    assetAddr,
    ['function balanceOf(address) view returns (uint256)'],
    provider,
  );
  return await token.balanceOf(address);
}
