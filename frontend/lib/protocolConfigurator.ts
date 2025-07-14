// lib/protocolConfigurator.ts
import { ethers } from 'ethers';
import ProtocolConfigurator from '../abi/ProtocolConfigurator.json';
import { getProvider } from './provider';
import deployments from '../app/config/deployments';

const DEFAULT_ADDRESS = deployments[0]?.protocolConfigurator as string;

if (!DEFAULT_ADDRESS) {
  console.error('❌  ProtocolConfigurator address not configured');
  throw new Error('ProtocolConfigurator address not set');
}

export function getProtocolConfigurator(address: string = DEFAULT_ADDRESS, deployment?: string) {
  return new ethers.Contract(address, ProtocolConfigurator, getProvider(deployment));
}

export const protocolConfigurator = getProtocolConfigurator();

export async function getProtocolConfiguratorWithSigner(address: string = DEFAULT_ADDRESS) {
  try {
    if (typeof window === 'undefined') {
      throw new Error('Called server-side – no injected wallet available');
    }
    if (!window.ethereum) {
      throw new Error('window.ethereum not found – install a browser wallet');
    }
    const browserProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    await browserProvider.send('eth_requestAccounts', []);
    const signer = await browserProvider.getSigner();
    console.log('✅  Browser wallet connected – address:', await signer.getAddress());
    return new ethers.Contract(address, ProtocolConfigurator, signer);
  } catch (err) {
    console.error('🚨  getProtocolConfiguratorWithSigner failed:', err);
    throw err;
  }
}

export function getProtocolConfiguratorWriter(address: string = DEFAULT_ADDRESS, deployment?: string) {
  try {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      throw new Error('PRIVATE_KEY env var not set');
    }
    const signer = new ethers.Wallet(pk, getProvider(deployment));
    console.log('✅  Writer signer loaded – address:', signer.address);
    return new ethers.Contract(address, ProtocolConfigurator, signer);
  } catch (err) {
    console.error('🚨  getProtocolConfiguratorWriter failed:', err);
    throw err;
  }
}
