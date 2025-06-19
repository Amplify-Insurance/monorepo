import { ethers } from 'ethers'
import Committee from '../abi/Committee.json'
import { getProvider, provider } from './provider'
import deployments from '../app/config/deployments'

const ADDRESS =
  (deployments[0] && deployments[0].committee) ||
  (process.env.NEXT_PUBLIC_COMMITTEE_ADDRESS as string)

if (!ADDRESS) {
  console.error('❌  Committee address not configured')
  throw new Error('Committee address not set')
}

export function getCommittee(address: string = ADDRESS, deployment?: string) {
  return new ethers.Contract(address, Committee, getProvider(deployment))
}

export const committee = getCommittee()

export async function getCommitteeWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()

  return new ethers.Contract(ADDRESS, Committee, signer)
}

export function getCommitteeWriter(address: string = ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, Committee, signer)
}
