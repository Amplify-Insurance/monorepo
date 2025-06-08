import { ethers } from 'ethers';
import RiskManager from '../abi/RiskManager.json';
import { provider } from './provider';
import 'server-only';

export const riskManager = new ethers.Contract(
  process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS as string,
  RiskManager,
  provider,
);

export async function getRiskManagerWithSigner() {
  if (typeof window === 'undefined' || !window.ethereum)
    throw new Error('Wallet not found');

  const browserProvider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = await browserProvider.getSigner();

  return new ethers.Contract(
    process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS as string,
    RiskManager,
    signer,
  );
}

export function getRiskManagerWriter() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  const signer = new ethers.Wallet(pk, provider);
  return new ethers.Contract(
    process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS as string,
    RiskManager,
    signer,
  );
}
