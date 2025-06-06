import { NextResponse } from 'next/server';
import { getCoverPoolWriter } from '../../../../lib/coverPool';

export async function POST(req: Request) {
  try {
    const { policyId } = await req.json();
    const cp = getCoverPoolWriter();
    const tx = await cp.settlePremium(policyId);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
