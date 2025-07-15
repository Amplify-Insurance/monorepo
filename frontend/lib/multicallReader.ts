import { ethers } from 'ethers'
import MulticallReader from '../abi/MulticallReader.json'
import { getProvider, provider } from './provider'
import deployments, { MULTICALL_READER_ADDRESS } from '../app/config/deployments'

const DEFAULT_ADDRESS = MULTICALL_READER_ADDRESS as string

export function getMulticallReader(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, MulticallReader.abi, getProvider(deployment))
}

export const multicallReader = getMulticallReader()
