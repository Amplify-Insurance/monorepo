import { ethers } from 'ethers'
import PriceOracle from '../abi/PriceOracle.json'
import { getProvider, provider } from './provider'

const DEFAULT_ADDRESS = process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS as string;

export function getPriceOracle(
  address: string = DEFAULT_ADDRESS,
  prov = getProvider(),
) {
  return new ethers.Contract(address, PriceOracle, prov)
}

export const priceOracle = getPriceOracle();

export async function getLatestUsdPrice(token: string, oracle = priceOracle) {
  const [price, decimals] = await oracle.getLatestUsdPrice(token)
  return { price, decimals }
}

export async function getUsdValue(token: string, amount: bigint | string, oracle = priceOracle) {
  return await oracle.getUsdValue(token, amount)
}
