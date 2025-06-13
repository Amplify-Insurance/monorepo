import { ethers } from 'ethers'
import PriceOracle from '../abi/PriceOracle.json'
import { provider } from './provider'

export const priceOracle = new ethers.Contract(
  process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS as string,
  PriceOracle,
  provider,
)

export async function getLatestUsdPrice(token: string) {
  const [price, decimals] = await priceOracle.getLatestUsdPrice(token)
  return { price, decimals }
}

export async function getUsdValue(token: string, amount: bigint | string) {
  return await priceOracle.getUsdValue(token, amount)
}
