import { NextResponse } from 'next/server';
import { capitalPool } from '../../../lib/capitalPool';
import { provider } from '../../../lib/provider';
import { ethers } from 'ethers';

const APR_ABI = ['function currentApr() view returns (uint256)'];

export async function GET() {
  try {
    const adapters: { address: string; apr: string }[] = [];
    for (let i = 0; i < 20; i++) {
      try {
        const addr = await (capitalPool as any).activeYieldAdapterAddresses(i);
        const contract = new ethers.Contract(addr, APR_ABI, provider);
        let apr = '0';
        try {
          const res = await contract.currentApr();
          apr = res.toString();
        } catch {}
        adapters.push({ address: addr, apr });
      } catch {
        break;
      }
    }
    return NextResponse.json({ adapters });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
