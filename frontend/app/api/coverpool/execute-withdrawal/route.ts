import { NextResponse } from 'next/server';
import { getUnderwriterManagerWriter } from '../../../../lib/underwriterManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const rm = getUnderwriterManagerWriter(dep.underwriterManager, dep.name);
    const tx = await rm.executeWithdrawal(0);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
