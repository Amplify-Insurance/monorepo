import { NextResponse } from 'next/server';
import { getCatPoolWriter } from '../../../../lib/catPool';
import { getProvider } from '../../../../lib/provider';
import deployments from '../../../config/deployments';

export async function POST(req: Request) {
  try {
    const { shares, deployment: depName } = await req.json();
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const provider = getProvider(dep.name);
    const cp = getCatPoolWriter(dep.catPool, provider);
    const tx = await cp.withdrawLiquidity(shares);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
