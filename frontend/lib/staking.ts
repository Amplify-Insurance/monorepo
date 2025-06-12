import { ethers } from 'ethers'
import Staking from '../abi/Staking.json'
import { provider } from './provider'

export const staking = new ethers.Contract(
  process.env.NEXT_PUBLIC_STAKING_ADDRESS as string,
  Staking,
  provider
)

export async function getStakingWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()

  return new ethers.Contract(
    process.env.NEXT_PUBLIC_STAKING_ADDRESS as string,
    Staking,
    signer
  )
}
