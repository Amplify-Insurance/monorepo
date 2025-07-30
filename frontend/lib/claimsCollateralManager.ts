import { ethers } from 'ethers'
import ClaimsCollateralManager from '../abi/ClaimsCollateralManager.json'
import { getProvider } from './provider'
import deployments from '../app/config/deployments'

const DEFAULT_ADDRESS = (deployments[0] as any)?.claimsCollateralManager as string

if (!DEFAULT_ADDRESS) {
  console.error('❌  ClaimsCollateralManager address not configured')
  throw new Error('ClaimsCollateralManager address not set')
}

export function getClaimsCollateralManager(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, (ClaimsCollateralManager as any).abi, getProvider(deployment))
}

export const claimsCollateralManager = getClaimsCollateralManager()

export async function getClaimsCollateralManagerWithSigner(address: string = DEFAULT_ADDRESS) {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Wallet not found')
  }
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, (ClaimsCollateralManager as any).abi, signer)
}

export function getClaimsCollateralManagerWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set')
  const signer = new ethers.Wallet(pk, getProvider(deployment))
  return new ethers.Contract(address, (ClaimsCollateralManager as any).abi, signer)
}
