// app/api/pools/[id]/route.ts

import { NextResponse } from 'next/server';
// import your provider and contract instances
import { getPoolRegistry } from '../../../../lib/poolRegistry';
import { getUnderwriterManager } from '../../../../lib/underwriterManager';
import deployments from '../../../config/deployments';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const idNum = parseInt(params.id, 10);
  if (isNaN(idNum)) {
    return NextResponse.json({ error: 'Invalid pool ID' }, { status: 400 });
  }

  for (const dep of deployments) {
    const poolRegistry = getPoolRegistry(dep.poolRegistry, dep.name);
    const rm = getUnderwriterManager(dep.underwriterManager, dep.name);
    try {
      const data = await poolRegistry.getPoolStaticData(idNum);
      const rate = await poolRegistry.getPoolRateModel(idNum);
      const total = await rm.totalCapitalPledgedToPool(idNum);
      const pending = await rm.capitalPendingWithdrawal(idNum);
      const poolInfo = {
        protocolTokenToCover: data[0],
        totalCoverageSold: data[1],
        isPaused: data[2],
        feeRecipient: data[3],
        claimFeeBps: data[4],
        totalCapitalPledgedToPool: total.toString(),
        capitalPendingWithdrawal: pending.toString(),
        rateModel: rate,
      };
      return NextResponse.json({ id: idNum, deployment: dep.name, poolInfo });
    } catch {}
  }
  return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
}
