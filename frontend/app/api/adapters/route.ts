import { NextResponse } from 'next/server';
import { getCapitalPool } from '../../../lib/capitalPool';
import { getProvider } from '../../../lib/provider';
import { ethers } from 'ethers';
import deployments from '../../config/deployments';

const ADAPTER_ABI = [
  'function currentApr() view returns (uint256)',
  'function asset() view returns (address)',
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const provider = getProvider(dep.name);

    const cp = getCapitalPool(dep.capitalPool, provider);

    const adapters: { address: string; apr: string; asset: string }[] = [];
    for (let i = 0; i < 20; i++) {
      try {
        const addr = await (cp as any).activeYieldAdapterAddresses(i);
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
