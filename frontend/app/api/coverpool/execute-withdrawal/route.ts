import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';

export async function POST() {
  try {
    const cp = getCapitalPoolWriter();
    const tx = await cp.executeWithdrawal();
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
