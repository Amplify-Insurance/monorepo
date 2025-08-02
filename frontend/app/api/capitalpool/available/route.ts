import { NextResponse } from 'next/server';
import { getCapitalPool, getUnderlyingAssetDecimals } from '../../../../lib/capitalPool';
import { getPoolRegistry } from '../../../../lib/poolRegistry';

import deployments from '../../../config/deployments';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCapitalPool(dep.capitalPool, dep.name);
    const pr = getPoolRegistry(dep.poolRegistry, dep.name);

    const [nav, unsettled, decimals, poolCount] = await Promise.all([
      cp.getTotalNAV(),
      cp.unsettledPayouts(),
      getUnderlyingAssetDecimals(dep.capitalPool, dep.name),
      pr.getPoolCount(),
    ]);

    const count = Number(poolCount);
    const poolData = await Promise.all(
      Array.from({ length: count }, (_, i) => pr.getPoolStaticData(i))
    );
    const sold = poolData.reduce((acc, data) => acc + BigInt(data[1].toString()), 0n);

    const available = BigInt(nav.toString()) - BigInt(unsettled.toString()) - sold;

    const [nav, unsettled, decimals] = await Promise.all([
      cp.getTotalNAV(),
      cp.unsettledPayouts(),
      getUnderlyingAssetDecimals(dep.capitalPool, dep.name),
    ]);
    const available = nav.sub(unsettled);
    return NextResponse.json({ available: available.toString(), decimals });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
