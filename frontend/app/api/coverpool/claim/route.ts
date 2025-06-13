import { NextResponse } from 'next/server';
import { getRiskManagerWriter } from '../../../../lib/riskManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { policyId, proof, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const rm = getRiskManagerWriter(dep.riskManager, dep.name);
    const tx = await rm.processClaim(policyId, proof);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
