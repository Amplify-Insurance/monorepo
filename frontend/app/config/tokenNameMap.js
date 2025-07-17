import { IdCard } from "lucide-react";
import { STAKING_TOKEN_ADDRESS } from "./deployments";
import { CHAIN_MAP } from "./chains";

let currentChainId = 8453;
if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem('chainId');
  if (stored) currentChainId = parseInt(stored, 10);
}
export function setCurrentChainId(id) {
  currentChainId = id;
}

export const PROTOCOL_NAME_MAP = {
  0: 'USDC',
  1: 'DAI',
  2: 'USDM',
  3: 'USDT',
};

export const PROTOCOL_DESCRIPTION_MAP = {
  0: 'Stablecoin',
  1: 'CDP Stablecoin',
  2: 'CDP Stablecoin',
  3: 'Stablecoin',
};

export const PROTOCOL_LOGO_MAP = {
  0: '/images/stablecoins/usdc.png',
  1: '/images/stablecoins/dai.svg',
  2: '/images/stablecoins/usdm.png',
  3: '/images/stablecoins/usdt.png',
};

// Categorise protocols so the frontend can filter markets. The default value is
// 'protocol' unless explicitly listed as a stablecoin.
export const PROTOCOL_TYPE_MAP = {
  0: 'stablecoin',
  1: 'stablecoin',
  2: 'stablecoin',
  3: 'stablecoin',
};


export const UNDERLYING_TOKEN_MAP = {
  "usdc": 'USDC',
}

export const UNDERLYING_TOKEN_LOGO_MAP = {
  "usdc": '/images/tokens/usdc.png',
}

const TOKEN_NAME_MAPS = {
  8453: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 'USDC',
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 'USD+',
    "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376": 'DAI',
    "0x4200000000000000000000000000000000000006": 'WETH',
  },
  84532: {
    "0xc6bc407706b7140ee8eef2f86f9504651b63e7f9": 'USDC',
    "0x3695dd1d1d43b794c0b13eb8be8419eb3ac22bf7": 'USDT',
    "0x4447863cddabbf2c3dac826f042e03c91927a196": 'USDM',
    "0x2502f488d481df4f5054330c71b95d93d41625c2": 'DAI',
  },
};

const TOKEN_LOGO_MAPS = {
  8453: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": '/images/tokens/usdc.png',
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": '/images/stablecoins/usd_plus.svg',
    "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376": '/images/stablecoins/dai.svg',
    "0x4200000000000000000000000000000000000006": '/images/tokens/eth.png',
  },
  84532: {
    "0xc6bc407706b7140ee8eef2f86f9504651b63e7f9": '/images/stablecoins/usdc.png',
    "0x2502f488d481df4f5054330c71b95d93d41625c2": '/images/stablecoins/dai.svg',
    "0x3695dd1d1d43b794c0b13eb8be8419eb3ac22bf7": '/images/stablecoins/usdt.png',
    "0x4447863cddabbf2c3dac826f042e03c91927a196": '/images/stablecoins/usdm.png',
  },
};

function currentNameMap() {
  return TOKEN_NAME_MAPS[currentChainId] || {};
}

function currentLogoMap() {
  return TOKEN_LOGO_MAPS[currentChainId] || {};
}

if (STAKING_TOKEN_ADDRESS) {
  const map = currentNameMap();
  const logos = currentLogoMap();
  map[STAKING_TOKEN_ADDRESS.toLowerCase()] = 'Staking Token';
  logos[STAKING_TOKEN_ADDRESS.toLowerCase()] = '/images/tokens/placeholder-token.svg';
}

export function getProtocolType(id) {
  return PROTOCOL_TYPE_MAP[id] || 'protocol';
}

export function getTokenName(id) {
  if (!id) return id;
  const key = typeof id === "string" ? id : `${id}`;
  const map = currentNameMap();
  return map[key] || map[key.toLowerCase()] || id;
}


export function getUnderlyingTokenName(id) {
  if (!id) return id;
  const key = typeof id === "string" ? id : `${id}`;
  return UNDERLYING_TOKEN_MAP[key] || UNDERLYING_TOKEN_MAP[key.toLowerCase()] || id;
}

export function getUnderlyingTokenLogo(id) {
  if (!id) return id;
  const key = typeof id === "string" ? id : `${id}`;
  return UNDERLYING_TOKEN_LOGO_MAP[key] || UNDERLYING_TOKEN_LOGO_MAP[key.toLowerCase()] || id;
}

export function getTokenLogo(id) {
  if (!id) return "/placeholder-logo.png";
  const key = typeof id === "string" ? id : `${id}`;
  const map = currentLogoMap();
  return map[key] || map[key.toLowerCase()] || "/placeholder-logo.png";
}



export function getProtocolName(id) {
  return PROTOCOL_NAME_MAP[id] || id;
}

export function getProtocolDescription(id) {
  return PROTOCOL_DESCRIPTION_MAP[id] || id;
}

export function getProtocolLogo(id) {
  return PROTOCOL_LOGO_MAP[id] ?? "/placeholder-logo.png";
}
