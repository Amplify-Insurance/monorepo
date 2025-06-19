// app/config.js
import { http } from 'wagmi';
// 1. Import getDefaultConfig
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// 2. Get WalletConnect Project ID from environment variables
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

if (!projectId) {
  // Still important: WalletConnect requires a projectId
  console.error(
    'Error: WalletConnect Project ID is not defined. Please add NEXT_PUBLIC_WC_PROJECT_ID to your .env.local file.',
  );
  // Consider throwing an error if WC is critical, or handle gracefully
  // For RainbowKit defaults to work best, a projectId is needed.
}

// 3. Define the Base mainnet chain
const baseMainnet = {
  id: 8453,
  name: 'Base',
  network: 'base-mainnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        // Use env variable in prod, fall back to public RPC in dev
        process.env.NEXT_PUBLIC_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'BaseScan',
      url: 'https://basescan.org',
    },
  },
  testnet: false,
};

// 4. Use getDefaultConfig to create wagmi/RainbowKit config
export const config = getDefaultConfig({
  appName: 'LayerCover',
  projectId: projectId || 'DEFAULT_PROJECT_ID_IF_MISSING',
  chains: [baseMainnet],
  transports: {
    [baseMainnet.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe',
    ),
  },
  ssr: true,
});
