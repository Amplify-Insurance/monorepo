import { ethers } from 'ethers'
import ERC20 from '../abi/ERC20.json'
import { getProvider } from './provider'
import { getMulticallReader } from './multicallReader'

export function getERC20(address: string, deployment?: string) {
  return new ethers.Contract(address, ERC20.abi, getProvider(deployment))
}

export async function getERC20WithSigner(address: string) {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found')
  const browserProvider = new ethers.providers.Web3Provider(window.ethereum)
  const signer = await browserProvider.getSigner()
  return new ethers.Contract(address, ERC20.abi, signer)
}

export async function getTokenMetadata(address: string, deployment?: string) {
  try {
    const token = getERC20(address, deployment)
    const multicall = getMulticallReader(undefined, deployment)
    const calls = [
      { target: address, callData: token.interface.encodeFunctionData('symbol') },
      { target: address, callData: token.interface.encodeFunctionData('name') },
      { target: address, callData: token.interface.encodeFunctionData('decimals') },
    ]
    const res = await multicall.tryAggregate(false, calls)
    const symbol = res[0].success
      ? token.interface.decodeFunctionResult('symbol', res[0].returnData)[0]
      : ''
    const name = res[1].success
      ? token.interface.decodeFunctionResult('name', res[1].returnData)[0]
      : ''
    const decimals = res[2].success
      ? token.interface.decodeFunctionResult('decimals', res[2].returnData)[0]
      : 18n
    return { symbol, name, decimals: Number(decimals) }
  } catch {
    return { symbol: '', name: '', decimals: 18 }
  }
}

export async function getTokenSymbol(address: string, deployment?: string) {
  const meta = await getTokenMetadata(address, deployment)
  return meta.symbol
}

export async function getTokenName(address: string, deployment?: string) {
  const meta = await getTokenMetadata(address, deployment)
  return meta.name
}

export async function getTokenDecimals(address: string, deployment?: string) {
  const meta = await getTokenMetadata(address, deployment)
  return meta.decimals
}
