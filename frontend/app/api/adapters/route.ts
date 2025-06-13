import { NextResponse } from 'next/server';
import { capitalPool } from '../../../lib/capitalPool';
import { getProvider } from '../../../lib/provider';
import { ethers } from 'ethers';

const ADAPTER_ABI = [
  'function currentApr() view returns (uint256)',
  'function asset() view returns (address)',
];

export async function GET() {
  try {
    const adapters: { address: string; apr: string; asset: string }[] = [];
    const provider = getProvider();
    for (let i = 0; i < 20; i++) {
      try {
        const addr = await (capitalPool as any).activeYieldAdapterAddresses(i);
        const contract = new ethers.Contract(addr, ADAPTER_ABI, provider);
        let apr = '0';
        let asset = ethers.constants.AddressZero;
        try {
          const res = await Promise.all([contract.currentApr(), contract.asset()]);
          apr = res[0].toString();
          asset = res[1];
        } catch {}
        adapters.push({ address: addr, apr, asset });
      } catch {
        break;
      }
    }
    return NextResponse.json({ adapters });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
