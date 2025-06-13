import { NextResponse } from 'next/server';
import { getRiskManagerWriter } from '../../../../lib/riskManager';
import { getProvider } from '../../../../lib/provider';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { policyId, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const provider = getProvider(dep.name);
    const rm = getRiskManagerWriter(dep.riskManager, provider);
    const tx = await rm.settlePremium(policyId);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
