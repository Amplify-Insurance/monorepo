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

// 3. Define your Tenderly Virtual Network (TVN) chain
const tenderlyVNet = {
  id: 8450, // 🔑 Your TVN chain ID
  name: 'Tenderly Virtual Network',
  network: 'tenderly-vnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        // Use env variable in prod, fall back to hard‑coded fork URL in dev
        process.env.NEXT_PUBLIC_RPC_URL ||
        'https://virtual.base.rpc.tenderly.co/b8bd0aaa-d917-4ed7-986d-a489973fb537',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Tenderly Explorer',
      url: 'https://dashboard.tenderly.co/explorer/vnet/73b21e81-f0cb-44f6-b934-11fdfc02dcd8',
    },
  },
  testnet: true, // Mark as testnet so RainbowKit shows the ⚠️ pill by default
};

// 4. Use getDefaultConfig to create wagmi/RainbowKit config
export const config = getDefaultConfig({
  appName: 'DeFi Insurance Platform',
  projectId: projectId || 'DEFAULT_PROJECT_ID_IF_MISSING',
  // 👇 Register your TVN as the only chain for now
  chains: [tenderlyVNet],
  transports: {
    [tenderlyVNet.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL ||
      'https://virtual.base.rpc.tenderly.co/b8bd0aaa-d917-4ed7-986d-a489973fb537',
    ),
  },
  ssr: true,
});
