// app/api/pools/[id]/route.ts

import { NextResponse } from 'next/server';
// import your provider and contract instances
import { getRiskManager } from '../../../../lib/riskManager';
import { getProvider } from '../../../../lib/provider';
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
    const riskManager = getRiskManager(dep.riskManager, getProvider(dep.name));
    try {
      const poolInfo = await riskManager.getPoolInfo(idNum);
      return NextResponse.json({ id: idNum, deployment: dep.name, poolInfo });
    } catch {}
  }
  return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
}
}