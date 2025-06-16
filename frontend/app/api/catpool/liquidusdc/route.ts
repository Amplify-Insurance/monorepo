import { NextResponse } from 'next/server';
import { getCatPool } from '../../../../lib/catPool';
import deployments from '../../../config/deployments';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCatPool(dep.catPool, dep.name);
    const amount = await cp.liquidUsdc();
    return NextResponse.json({ liquidUsdc: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
