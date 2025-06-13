import { ethers } from 'ethers'
import MulticallReader from '../abi/MulticallReader.json'
import { getProvider, provider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_MULTICALL_READER_ADDRESS as string

export function getMulticallReader(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, MulticallReader, getProvider(deployment))
}

export const multicallReader = getMulticallReader()
