import { NextResponse } from 'next/server';
import { getCoverPoolWriter } from '../../../../lib/coverPool';

export async function POST() {
  try {
    const cp = getCoverPoolWriter();
    const tx = await cp.executeWithdrawal();
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
