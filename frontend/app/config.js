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
  appName: 'DeFi Insurance Platform', // Your app name
  projectId: projectId || 'DEFAULT_PROJECT_ID_IF_MISSING', // REQUIRED! Add your WalletConnect Project ID or a fallback
  chains: [base],
  // Optional: Add transports here if you want to use specific RPCs instead of defaults
  // transports: {
  //   [base.id]: http('https://base.blockpi.network/v1/rpc/public'),
  // },
  ssr: true, // Recommended for Next.js Required for App Router
});