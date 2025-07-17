export const BASE_MAINNET = {
  id: 8453,
  name: 'Base',
  network: 'base-mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'https://base-mainnet.g.alchemy.com/v2/1aCtyoTdLMNn0TDAz_2hqBKwJhiKBzIe'] } },
  blockExplorers: { default: { name: 'BaseScan', url: 'https://basescan.org' } },
  testnet: false,
};

export const BASE_SEPOLIA = {
  id: 84532,
  name: 'Base Sepolia',
  network: 'base-sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } },
  testnet: true,
};

export const CHAINS = [BASE_MAINNET, BASE_SEPOLIA];
export const CHAIN_MAP = {
  [BASE_MAINNET.id]: BASE_MAINNET,
  [BASE_SEPOLIA.id]: BASE_SEPOLIA,
};
