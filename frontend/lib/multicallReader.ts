import { ethers } from 'ethers'
import MulticallReader from '../abi/MulticallReader.json'
import { provider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_MULTICALL_READER_ADDRESS as string

export function getMulticallReader(address: string = DEFAULT_ADDRESS) {
  return new ethers.Contract(address, MulticallReader, provider)
}

export const multicallReader = getMulticallReader()
