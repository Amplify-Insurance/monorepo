import { NextResponse } from 'next/server';
import { getCapitalPoolWriter } from '../../../../lib/capitalPool';
import { getRiskManagerWriter } from '../../../../lib/riskManager';

export async function POST(req: Request) {
  try {
    const { amount, yieldChoice, poolIds } = await req.json();
    const cp = getCapitalPoolWriter();
    const rm = getRiskManagerWriter();
    const tx = await cp.deposit(amount, yieldChoice);
    await tx.wait();
    if (poolIds && poolIds.length > 0) {
      const tx2 = await rm.allocateCapital(poolIds);
      await tx2.wait();
    }
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
