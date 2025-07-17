import { IdCard } from "lucide-react";
import { STAKING_TOKEN_ADDRESS } from "./deployments";

export const PROTOCOL_NAME_MAP = {
  0: 'Aave V3',
  1: 'Compound V3',
  2: 'Moonwell',
  3: 'Euler V2',
  4: 'USD+',
  5: 'DAI'

};

export const PROTOCOL_DESCRIPTION_MAP = {
  0: 'Decentralized lending protocol',
  1: 'Decentralized lending protocol',
  2: 'Decentralized lending protocol',
  3: 'Decentralized lending protocol',
  4: 'Yield Bearing Stablecoin',
  5: 'CDP Stablecoin',
};

export const PROTOCOL_LOGO_MAP = {
  0: '/images/protocols/aave.png',
  1: '/images/protocols/compound.png',
  2: '/images/protocols/moonwell.png',
  3: '/images/protocols/euler.png',
  4: '/images/stablecoins/usd_plus.svg',
  5: '/images/stablecoins/dai.svg',
};

// Categorise protocols so the frontend can filter markets. The default value is
// 'protocol' unless explicitly listed as a stablecoin.
export const PROTOCOL_TYPE_MAP = {
  0: 'protocol',
  1: 'protocol',
  2: 'protocol',
  3: 'protocol',
  4: 'stablecoin',
  5: 'stablecoin',
};


export const UNDERLYING_TOKEN_MAP = {
  "usdc": 'USDC',
}

export const UNDERLYING_TOKEN_LOGO_MAP = {
  "usdc": '/images/tokens/usdc.png',
}

export const TOKEN_NAME_MAP = {
  "0xc6Bc407706B7140EE8Eef2f86F9504651b63e7f9": 'USDC',
  "0x4447863cddABbF2c3dAC826f042e03c91927A196": "USDM",
  "0x2502F488D481Df4F5054330C71b95d93D41625C2": "DAI",
  "0x3695Dd1D1D43B794C0B13eb8be8419Eb3ac22bf7": "USDT",
};

export const TOKEN_LOGO_MAP = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": '/images/tokens/usdc.png',
  "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB": '/images/tokens/usdc.png',
  "0xb125E6687d4313864e53df431d5425969c15Eb2F": "/images/tokens/usdc.png",
  "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22": "/images/tokens/usdc.png",
  "0x0A1a3b5f2041F33522C4efc754a7D096f880eE16": "/images/tokens/usdc.png",
  "0x4200000000000000000000000000000000000006": '/images/tokens/eth.png',
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": '/images/stablecoins/usd_plus.svg',
  "0xB79DD08EA68A908A97220C76d19A6aA9cBDE4376": '/images/stablecoins/dai.svg'
};


if (STAKING_TOKEN_ADDRESS) {
  TOKEN_NAME_MAP[STAKING_TOKEN_ADDRESS] = 'Staking Token';
  TOKEN_LOGO_MAP[STAKING_TOKEN_ADDRESS] = '/images/tokens/placeholder-token.svg';
}

export function getProtocolType(id) {
  return PROTOCOL_TYPE_MAP[id] || 'protocol';
}

export function getTokenName(id) {
  if (!id) return id;
  const key = typeof id === "string" ? id : `${id}`;
  return TOKEN_NAME_MAP[key] || TOKEN_NAME_MAP[key.toLowerCase()] || id;
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
  return (
    TOKEN_LOGO_MAP[key] ||
    TOKEN_LOGO_MAP[key.toLowerCase()] ||
    "/placeholder-logo.png"
  );
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
