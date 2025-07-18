import { NextResponse } from 'next/server';
import { getPolicyManagerWriter } from '../../../../lib/policyManager';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { poolId, coverageAmount, initialPremiumDeposit, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const pm = getPolicyManagerWriter(dep.policyManager, dep.name);
    const tx = await pm.purchaseCover(poolId, coverageAmount, initialPremiumDeposit);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
