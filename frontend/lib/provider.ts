import { ethers } from 'ethers'

export const provider = new ethers.JsonRpcProvider(
  process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL,
)
