import { ethers } from 'ethers'
import CoverPool from '../abi/CoverPool.json'
import { provider } from './provider'

export const coverPool = new ethers.Contract(
  process.env.NEXT_PUBLIC_COVER_POOL_ADDRESS as string,
  CoverPool,
  provider,
)

export async function getCoverPoolWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  // In ethers v5, use Web3Provider instead of BrowserProvider
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    process.env.NEXT_PUBLIC_COVER_POOL_ADDRESS as string,
    CoverPool,
    signer
  );
}

export function getCoverPoolWriter() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, provider)
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_COVER_POOL_ADDRESS as string,
    CoverPool,
    signer,
  )
}
