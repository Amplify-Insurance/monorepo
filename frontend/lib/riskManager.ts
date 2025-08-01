// lib/riskManager.ts
import { ethers } from 'ethers';
import RiskManager from '../abi/RiskManager.json';
import { getProvider, provider } from './provider';
import deployments from '../app/config/deployments';

/* ───────────────────────────────
   Validate & create read-only contract
────────────────────────────────── */

const DEFAULT_ADDRESS = deployments[0]?.riskManager as string;

if (!DEFAULT_ADDRESS) {
  console.error('❌  RiskManager address not configured');
  throw new Error('RiskManager address not set');
}

export function getRiskManager(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, RiskManager.abi, getProvider(deployment));
}

export const riskManager = getRiskManager();

/* ───────────────────────────────
   Browser signer (MetaMask, Coinbase Wallet…)
────────────────────────────────── */

export async function getRiskManagerWithSigner(address: string = DEFAULT_ADDRESS) {
  try {
    if (typeof window === 'undefined') {
      throw new Error('Called server-side – no injected wallet available');
    }
    if (!window.ethereum) {
      throw new Error('window.ethereum not found – install a browser wallet');
    }

    // Request account access if needed
    const browserProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    await browserProvider.send('eth_requestAccounts', []);

    const signer = await browserProvider.getSigner();
    console.log('✅  Browser wallet connected – address:', await signer.getAddress());

    return new ethers.Contract(address, RiskManager.abi, signer);
  } catch (err) {
    console.error('🚨  getRiskManagerWithSigner failed:', err);
    throw err;            // propagate so callers can handle it, too
  }
}

/* ───────────────────────────────
   Server/CI writer (private-key signer)
────────────────────────────────── */

export function getRiskManagerWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  try {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      throw new Error('PRIVATE_KEY env var not set');
    }

    const signer = new ethers.Wallet(pk, getProvider(deployment));
    console.log('✅  Writer signer loaded – address:', signer.address);

    return new ethers.Contract(address, RiskManager.abi, signer);
  } catch (err) {
    console.error('🚨  getRiskManagerWriter failed:', err);
    throw err;
  }
}
