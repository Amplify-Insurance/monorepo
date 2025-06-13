import { ethers } from 'ethers'
import PolicyNFT from '../abi/PolicyNFT.json'
import { getProvider } from './provider'

const DEFAULT_ADDRESS =
  process.env.NEXT_PUBLIC_POLICY_NFT_ADDRESS ?? process.env.POLICY_NFT_ADDRESS

export function getPolicyNft(
  address: string = DEFAULT_ADDRESS as string,
  provider = getProvider(),
) {
  return new ethers.Contract(address, PolicyNFT, provider)
}

export const policyNft = getPolicyNft()

export function getPolicyNftWriter(
  address: string = DEFAULT_ADDRESS as string,
  provider = getProvider(),
) {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(address, PolicyNFT, signer);
}
