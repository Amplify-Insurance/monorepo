import { ethers } from 'ethers'
import Committee from '../abi/Committee.json'
import { getProvider, provider } from './provider'

const ADDRESS = process.env.NEXT_PUBLIC_COMMITTEE_ADDRESS as string

if (!ADDRESS) {
  console.error('❌  NEXT_PUBLIC_COMMITTEE_ADDRESS env var is missing')
  throw new Error('NEXT_PUBLIC_COMMITTEE_ADDRESS not set')
}

export function getCommittee(prov = getProvider()) {
  return new ethers.Contract(ADDRESS, Committee, prov)
}

export const committee = getCommittee()

export async function getCommitteeWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()

  return new ethers.Contract(ADDRESS, Committee, signer)
}
