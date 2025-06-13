import { ethers } from 'ethers'
import ERC20 from '../abi/ERC20.json'
import { getProvider } from './provider'


export function getERC20(address: string, provider = getProvider()) {
  return new ethers.Contract(address, ERC20, provider)
}

export async function getERC20WithSigner(address: string) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, ERC20, signer)
}

export async function getTokenSymbol(address: string, provider = getProvider()) {
  try {
    const c = getERC20(address, provider)
    return await c.symbol()
  } catch {
    return ''
  }
}

export async function getTokenName(address: string, provider = getProvider()) {
  try {
    const c = getERC20(address, provider)
    return await c.name()
  } catch {
    return ''
  }
}

export async function getTokenDecimals(
  address: string,
  provider = getProvider(),
) {
  try {
    const c = getERC20(address, provider)
    return await c.decimals()
  } catch {
    return 18
  }
}
