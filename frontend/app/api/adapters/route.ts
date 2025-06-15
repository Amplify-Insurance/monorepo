import { NextResponse } from 'next/server';
import { getCapitalPool } from '../../../lib/capitalPool';
import { getProvider } from '../../../lib/provider';
import { ethers } from 'ethers';
import deployments from '../../config/deployments';
import { YieldPlatform } from '../../config/yieldPlatforms';

const ADAPTER_ABI = [
  'function currentApr() view returns (uint256)',
  'function asset() view returns (address)',
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];

    const cp = getCapitalPool(dep.capitalPool, dep.name);
    const provider = getProvider(dep.name);

    const adapters: { id: number; address: string; apr: string; asset: string }[] = [];

    for (const id of [YieldPlatform.AAVE, YieldPlatform.COMPOUND, YieldPlatform.OTHER_YIELD]) {
      try {
        const addr = await (cp as any).baseYieldAdapters(id);
        if (addr && addr !== ethers.constants.AddressZero) {
          const contract = new ethers.Contract(addr, ADAPTER_ABI, provider);
          let apr = '0';
          let asset = ethers.constants.AddressZero;
          try {
            const res = await Promise.all([contract.currentApr(), contract.asset()]);
            apr = res[0].toString();
            asset = res[1];
          } catch {}
          adapters.push({ id, address: addr, apr, asset });
        }
      } catch {}
    }

    return NextResponse.json({ adapters });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
