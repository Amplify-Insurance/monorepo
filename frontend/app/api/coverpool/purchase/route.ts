import { NextResponse } from 'next/server';
import { getRiskManagerWriter } from '../../../../lib/riskManager';

export async function POST(req: Request) {
  try {
    const { poolId, coverageAmount } = await req.json();
    const rm = getRiskManagerWriter();
    const tx = await rm.purchaseCover(poolId, coverageAmount);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
