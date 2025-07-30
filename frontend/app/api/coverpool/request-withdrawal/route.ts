import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';
import { getUnderwriterManagerWriter } from '../../../../lib/underwriterManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { shares, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCapitalPoolWriter(dep.capitalPool, dep.name);
    const rm = getUnderwriterManagerWriter(dep.underwriterManager, dep.name);
    const amount = await cp.sharesToValue(shares);
    const tx = await rm.requestWithdrawal(amount);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
