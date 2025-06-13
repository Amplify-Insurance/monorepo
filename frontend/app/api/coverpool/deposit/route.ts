import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';
import { getRiskManagerWriter } from '../../../../lib/riskManager';
import { getProvider } from '../../../../lib/provider';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { amount, yieldChoice, poolIds, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const provider = getProvider(dep.name);
    const cp = getCapitalPoolWriter(dep.capitalPool, provider);
    const rm = getRiskManagerWriter(dep.riskManager, provider);
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
