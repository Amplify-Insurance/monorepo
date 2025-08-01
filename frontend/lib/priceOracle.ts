import { ethers } from 'ethers'
import PriceOracle from '../abi/PriceOracle.json'
import { getProvider, provider } from './provider'
import deployments, { PRICE_ORACLE_ADDRESS } from '../app/config/deployments'

const DEFAULT_ADDRESS = PRICE_ORACLE_ADDRESS as string;

export function getPriceOracle(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, PriceOracle.abi, getProvider(deployment));
}

export const priceOracle = getPriceOracle();

export async function getLatestUsdPrice(token: string, oracle = priceOracle) {
  const [price, decimals] = await oracle.getLatestUsdPrice(token)
  return { price, decimals }
}

export async function getUsdValue(token: string, amount: bigint | string, oracle = priceOracle) {
  return await oracle.getUsdValue(token, amount)
}
