import { ethers } from 'ethers'
import PolicyManager from '../abi/PolicyManager.json'
import { getProvider } from './provider'
import deployments from '../app/config/deployments'

const DEFAULT_ADDRESS = deployments[0]?.policyManager as string

if (!DEFAULT_ADDRESS) {
  console.error('❌  PolicyManager address not configured')
  throw new Error('PolicyManager address not set')
}

export function getPolicyManager(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, PolicyManager.abi, getProvider(deployment))
}

export const policyManager = getPolicyManager()

export async function getPolicyManagerWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, PolicyManager.abi, signer)
}

export function getPolicyManagerWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, PolicyManager.abi, signer)
}
