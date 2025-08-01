import { NextResponse } from 'next/server';
import { getUnderwriterManagerWriter } from '../../../../lib/underwriterManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { amount, yieldChoice, poolIds, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const rm = getUnderwriterManagerWriter(dep.underwriterManager, dep.name);
    const tx = await rm.depositAndAllocate(amount, yieldChoice, poolIds ?? []);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
