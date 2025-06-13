import { ethers } from 'ethers'
import Staking from '../abi/Staking.json'
import { getProvider, provider } from './provider'

// Validate presence of the staking contract address
const ADDRESS = process.env.NEXT_PUBLIC_STAKING_ADDRESS as string

if (!ADDRESS) {
  console.error('❌  NEXT_PUBLIC_STAKING_ADDRESS env var is missing')
  throw new Error('NEXT_PUBLIC_STAKING_ADDRESS not set')
}

export function getStaking(prov = getProvider()) {
  return new ethers.Contract(ADDRESS, Staking, prov)
}

export const staking = getStaking()

export async function getStakingWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()

  return new ethers.Contract(ADDRESS, Staking, signer)
}
