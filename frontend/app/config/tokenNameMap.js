import { IdCard } from "lucide-react";


// export const TOKEN_NAME_MAP = {
//   '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 'Aave USDC Cover',
//   '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
//   '0xb125e6687d4313864e53df431d5425969c15eb2f': 'Compound USDC Cover',
// };

// export const TOKEN_LOGO_MAP = {
//   '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': '/images/protocols/aave.png',
//   '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': '/images/tokens/usdc.png',
//   '0xb125e6687d4313864e53df431d5425969c15eb2f': '/images/protocols/compound.png',
// };

// export const TOKEN_DESCRIPTION_MAP = {
//   '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 'Decentralized lending protocol',
//   '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'Decentralized lending protocol',
//   '0xb125e6687d4313864e53df431d5425969c15eb2f': 'Decentralized lending protocol',
// };



export const TOKEN_NAME_MAP = {
  0: 'Aave V3',
  1: 'Compound V3',
  2: 'Moonwell',
  3: 'Euler V2',

};

export const TOKEN_DESCRIPTION_MAP = {
  0: 'Decentralized lending protocol',
  1: 'Decentralized lending protocol',
  2: 'Decentralized lending protocol',
  3: 'Decentralized lending protocol',
};

export const TOKEN_LOGO_MAP = {
  0: '/images/protocols/aave.png',
  1: '/images/protocols/compound.png',
  2: '/images/protocols/moonwell.png',
  3: '/images/protocols/euler.png',
};


export function getTokenName(id) {
  return TOKEN_NAME_MAP[id] || id;
}

export function getTokenDescription(id) {
  return TOKEN_DESCRIPTION_MAP[id] || id;
}

export function getTokenLogo(id) {
  return TOKEN_LOGO_MAP[id] ?? "/placeholder-logo.png";
}
