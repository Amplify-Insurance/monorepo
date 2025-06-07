// app/config.js
import { http } from 'wagmi';
import { base } from 'wagmi/chains';
// 1. Import getDefaultConfig
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// 2. Get WalletConnect Project ID from environment variables
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

if (!projectId) {
  // Still important: WalletConnect requires a projectId
  console.error("Error: WalletConnect Project ID is not defined. Please add NEXT_PUBLIC_WC_PROJECT_ID to your .env.local file.");
  // Consider throwing an error if WC is critical, or handle gracefully
  // For RainbowKit defaults to work best, a projectId is needed.
}

// 3. Use getDefaultConfig to create wagmi config
export const config = getDefaultConfig({
  appName: 'DeFi Insurance Platform',
  projectId: projectId || 'DEFAULT_PROJECT_ID_IF_MISSING',
  chains: [base],
  transports: {
    [base.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL ||
        'https://virtual.base.rpc.tenderly.co/cf8f88d7-1bdc-45f4-9260-f7d32fff3ba6',
    ),
  },
  ssr: true,
});