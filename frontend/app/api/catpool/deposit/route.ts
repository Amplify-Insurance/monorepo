import { NextResponse } from 'next/server';
import { getCatPoolWriter } from '../../../../lib/catPool';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { amount, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCatPoolWriter(dep.catPool);
    const tx = await cp.depositLiquidity(amount);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
