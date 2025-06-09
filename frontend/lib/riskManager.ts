// lib/riskManager.ts
import { ethers } from 'ethers';
import RiskManager from '../abi/RiskManager.json';
import { provider } from './provider';

/* ───────────────────────────────
   Validate & create read-only contract
────────────────────────────────── */

const ADDRESS = process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS as string;

if (!ADDRESS) {
  console.error('❌  NEXT_PUBLIC_RISK_MANAGER_ADDRESS env var is missing');
  throw new Error('NEXT_PUBLIC_RISK_MANAGER_ADDRESS not set');
}

export const riskManager = new ethers.Contract(ADDRESS, RiskManager, provider);

/* ───────────────────────────────
   Browser signer (MetaMask, Coinbase Wallet…)
────────────────────────────────── */

export async function getRiskManagerWithSigner() {
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

    return new ethers.Contract(ADDRESS, RiskManager, signer);
  } catch (err) {
    console.error('🚨  getRiskManagerWithSigner failed:', err);
    throw err;            // propagate so callers can handle it, too
  }
}

/* ───────────────────────────────
   Server/CI writer (private-key signer)
────────────────────────────────── */

export function getRiskManagerWriter() {
  try {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      throw new Error('PRIVATE_KEY env var not set');
    }

    const signer = new ethers.Wallet(pk, provider);
    console.log('✅  Writer signer loaded – address:', signer.address);

    return new ethers.Contract(ADDRESS, RiskManager, signer);
  } catch (err) {
    console.error('🚨  getRiskManagerWriter failed:', err);
    throw err;
  }
}
