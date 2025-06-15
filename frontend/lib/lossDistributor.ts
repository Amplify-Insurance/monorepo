import { ethers } from 'ethers'
import LossDistributor from '../abi/LossDistributor.json'
import { getProvider } from './provider'

const ADDRESS = process.env.NEXT_PUBLIC_LOSS_DISTRIBUTOR_ADDRESS as string

export function getLossDistributor(address: string = ADDRESS, deployment?: string) {
  return new ethers.Contract(address, LossDistributor, getProvider(deployment))
}

export const lossDistributor = getLossDistributor()

export async function getLossDistributorWithSigner(address: string = ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Wallet not found')
  }
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, LossDistributor, signer)
}

export function getLossDistributorWriter(address: string = ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, LossDistributor, signer)
}
