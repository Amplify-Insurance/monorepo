export const YieldPlatform = {
  NONE: 0,
  AAVE: 1,
  COMPOUND: 2,
  OTHER_YIELD: 3,
};

export const YIELD_PLATFORM_INFO = {
  [YieldPlatform.NONE]: { name: 'None', logo: '/placeholder-logo.png' },
  [YieldPlatform.AAVE]: { name: 'Aave', logo: '/images/protocols/aave.png' },
  [YieldPlatform.COMPOUND]: { name: 'Compound', logo: '/images/protocols/compound.png' },
  [YieldPlatform.OTHER_YIELD]: { name: 'Other Yield', logo: '/placeholder-logo.png' },
};

export function getYieldPlatformInfo(id) {
  return (
    YIELD_PLATFORM_INFO[id] || { name: 'Unknown', logo: '/placeholder-logo.png' }
  );
}
