export const TOKEN_NAME_MAP = {
  '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 'Aave USDC Cover',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0xb125e6687d4313864e53df431d5425969c15eb2f': 'Compound USDC Cover',
};

export const TOKEN_LOGO_MAP = {
  '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': '/images/protocols/aave.png',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': '/images/tokens/usdc.png',
  '0xb125e6687d4313864e53df431d5425969c15eb2f': '/images/protocols/compound.png',
};

export const TOKEN_DESCRIPTION_MAP = {
  '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 'Decentralized lending protocol',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'Decentralized lending protocol',
  '0xb125e6687d4313864e53df431d5425969c15eb2f': 'Decentralized lending protocol',
};


export function getTokenName(address) {
  if (!address) return '';
  return TOKEN_NAME_MAP[address.toLowerCase()] || address;
}

export function getTokenDescription(address) {
  if (!address) return '';
  return TOKEN_DESCRIPTION_MAP[address.toLowerCase()] || address;
}

export function getTokenLogo(address) {
  if (typeof address !== "string" || !address) return "/placeholder-logo.png";
  return TOKEN_LOGO_MAP[address.toLowerCase()] ?? "/placeholder-logo.png";
}
