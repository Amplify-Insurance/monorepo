import { ethers } from 'ethers'
import Staking from '../abi/Staking.json'
import { getProvider, provider } from './provider'
import deployments from '../app/config/deployments'

// Validate presence of the staking contract address
const ADDRESS = deployments[0]?.staking as string

if (!ADDRESS) {
  console.error('❌  Staking address not configured')
  throw new Error('Staking address not set')
}

export function getStaking(address: string = ADDRESS, deployment?: string) {
  return new ethers.Contract(address, Staking, getProvider(deployment))
}

export const staking = getStaking()

export async function getStakingWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()

  return new ethers.Contract(ADDRESS, Staking, signer)
}
