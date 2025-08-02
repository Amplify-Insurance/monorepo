// app/config.js
import { http } from 'wagmi';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
// --- FIX: Import the specific wallet connector ---
import { rainbowWallet } from '@rainbow-me/rainbowkit/wallets';
import { CHAINS, CHAIN_MAP } from './config/chains';

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

if (!projectId) {
  console.error(
    'Error: WalletConnect Project ID is not defined. Please add NEXT_PUBLIC_WC_PROJECT_ID to your .env.local file.',
  );
}

let defaultChainId = 8453;
if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem('chainId');
  if (stored) defaultChainId = parseInt(stored, 10);
}

export const config = getDefaultConfig({
  appName: 'LayerCover',
  projectId: projectId || 'DEFAULT_PROJECT_ID_IF_MISSING',
  chains: CHAINS,
  // --- FIX: Explicitly define which wallets to show ---
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [rainbowWallet],
    },
  ],
  transports: {
    [CHAIN_MAP[8453].id]: http(CHAIN_MAP[8453].rpcUrls.default.http[0]),
    [CHAIN_MAP[84532].id]: http(CHAIN_MAP[84532].rpcUrls.default.http[0]),
  },
  ssr: true,
});

export { defaultChainId };