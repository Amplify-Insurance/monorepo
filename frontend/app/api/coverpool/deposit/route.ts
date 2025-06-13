import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';
import { getRiskManagerWriter } from '../../../../lib/riskManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { amount, yieldChoice, poolIds, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCapitalPoolWriter(dep.capitalPool);
    const rm = getRiskManagerWriter(dep.riskManager);
    const tx = await cp.deposit(amount, yieldChoice);
    await tx.wait();
    if (poolIds && poolIds.length > 0) {
      const tx2 = await rm.allocateCapital(poolIds);
      await tx2.wait();
    }
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
