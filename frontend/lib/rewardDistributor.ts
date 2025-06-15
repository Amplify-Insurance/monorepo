import { ethers } from 'ethers'
import RewardDistributor from '../abi/RewardDistributor.json'
import { getProvider } from './provider'

const ADDRESS = process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS as string

export function getRewardDistributor(address: string = ADDRESS, deployment?: string) {
  return new ethers.Contract(address, RewardDistributor, getProvider(deployment))
}

export const rewardDistributor = getRewardDistributor()

export async function getRewardDistributorWithSigner(address: string = ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Wallet not found')
  }
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, RewardDistributor, signer)
}

export function getRewardDistributorWriter(address: string = ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, RewardDistributor, signer)
}
