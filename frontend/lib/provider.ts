import { ethers } from 'ethers'

type Deployment = {
  name: string
  rpcUrl?: string
  chainId?: number
}

let deployments: Deployment[] = []
const raw = process.env.NEXT_PUBLIC_DEPLOYMENTS
if (raw) {
  try {
    deployments = JSON.parse(raw)
  } catch (err) {
    console.error('Failed to parse NEXT_PUBLIC_DEPLOYMENTS', err)
  }
}

export function getProvider(deploymentName?: string) {
  const dep = deploymentName
    ? deployments.find((d) => d.name === deploymentName)
    : undefined

  const url =
    dep?.rpcUrl ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.RPC_URL ??
    'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe'

  const chainId = Number(
    dep?.chainId ??
      process.env.NEXT_PUBLIC_CHAIN_ID ??
      process.env.CHAIN_ID ??
      8453,
  )

  return new ethers.providers.StaticJsonRpcProvider(url, {
    name: dep?.name ?? 'base',
    chainId,
  })
}
