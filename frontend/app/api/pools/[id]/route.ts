// app/api/pools/[id]/route.ts

import { NextResponse } from 'next/server';
// import your provider and contract instances
import { getPoolRegistry } from '../../../../lib/poolRegistry';
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
    try {
      const data = await poolRegistry.getPoolData(idNum);
      const rate = await poolRegistry.getPoolRateModel(idNum);
      const poolInfo = {
        protocolTokenToCover: data[0],
        totalCapitalPledgedToPool: data[1],
        totalCoverageSold: data[2],
        capitalPendingWithdrawal: data[3],
        isPaused: data[4],
        feeRecipient: data[5],
        rateModel: rate,
      };
      return NextResponse.json({ id: idNum, deployment: dep.name, poolInfo });
    } catch {}
  }
  return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
}
