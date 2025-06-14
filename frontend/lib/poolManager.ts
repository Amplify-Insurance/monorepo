import { ethers } from 'ethers'
import PoolManager from '../abi/PoolManager.json'
import { getProvider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS as string

if (!DEFAULT_ADDRESS) {
  console.error('\u274C  NEXT_PUBLIC_POOL_MANAGER_ADDRESS env var is missing')
  throw new Error('NEXT_PUBLIC_POOL_MANAGER_ADDRESS not set')
}

export function getPoolManager(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, PoolManager, getProvider(deployment))
}

export const poolManager = getPoolManager()

export async function getPoolManagerWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, PoolManager, signer)
}

export function getPoolManagerWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, PoolManager, signer)
}
