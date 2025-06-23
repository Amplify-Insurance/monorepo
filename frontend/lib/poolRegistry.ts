import { ethers } from 'ethers'
import PoolRegistry from '../abi/PoolRegistry.json'
import { getProvider } from './provider'
import deployments from '../app/config/deployments'

const DEFAULT_ADDRESS = deployments[0]?.poolRegistry as string

if (!DEFAULT_ADDRESS) {
  console.error('❌  PoolRegistry address not configured')
  throw new Error('PoolRegistry address not set')
}

export function getPoolRegistry(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, PoolRegistry, getProvider(deployment))
}

export const poolRegistry = getPoolRegistry()

export async function getPoolRegistryWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, PoolRegistry, signer)
}

export function getPoolRegistryWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, PoolRegistry, signer)
}

/**
 * Fetch the claim fee for a pool from the PoolRegistry.
 */
export async function getClaimFeeBps(
  poolId: number,
  deployment?: string,
): Promise<number> {
  try {
    const pr = getPoolRegistry(undefined, deployment)
    const data = await pr.getPoolData(poolId)
    const fee = data.claimFeeBps ?? data[6]
    return Number(fee.toString())
  } catch (err) {
    console.error('Failed to load pool claim fee', err)
    return 0
  }
}
