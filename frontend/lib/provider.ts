import { ethers } from 'ethers'

const FALLBACK_RPC =
  'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe'

export function getProvider(dep?: { rpcUrl?: string }) {
  const url =
    dep?.rpcUrl ??
    process.env.NEXT_PUBLIC_RPC_URL ?? // dev in the browser
    process.env.RPC_URL ?? // server / CI
    FALLBACK_RPC

  return new ethers.providers.StaticJsonRpcProvider(url, {
    name: 'base',
    chainId: 8453,
  })
}

export const provider = getProvider()
