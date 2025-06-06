import { NextResponse } from 'next/server';
import { getCoverPoolWriter } from '../../../../lib/coverPool';

export async function POST(req: Request) {
  try {
    const { policyId, proof } = await req.json();
    const cp = getCoverPoolWriter();
    const tx = await cp.processClaim(policyId, proof);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
