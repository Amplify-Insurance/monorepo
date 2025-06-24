export default function bnToString(value: any): any {
  // 1️⃣ Native bigint
  if (typeof value === 'bigint') return value.toString();

  // 2️⃣ ethers.js BigNumber (v6 uses BigInt; but keep for compatibility)
  if (value && typeof value === 'object' && value._isBigNumber) {
    return value.toString();
  }

  // 3️⃣ Array (may also have named props)
  if (Array.isArray(value)) {
    const hasNamedKeys = Object.keys(value).some((k) => isNaN(Number(k)));
    if (hasNamedKeys) {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => isNaN(Number(k)))
          .map(([k, v]) => [k, bnToString(v)])
      );
    }
    return value.map(bnToString);
  }

  // 4️⃣ Plain object
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => isNaN(Number(k)))
        .map(([k, v]) => [k, bnToString(v)])
    );
  }

  return value;
}
