import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { shares, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCapitalPoolWriter(dep.capitalPool, dep.name);
    const tx = await cp.requestWithdrawal(shares);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
