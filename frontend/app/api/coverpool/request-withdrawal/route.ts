import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';

export async function POST(req: Request) {
  try {
    const { shares } = await req.json();
    const cp = getCapitalPoolWriter();
    const tx = await cp.requestWithdrawal(shares);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
