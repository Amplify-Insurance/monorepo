import { NextResponse } from 'next/server';
import { getRiskManagerWriter } from '../../../../lib/riskManager';

export async function POST(req: Request) {
  try {
    const { poolId, coverageAmount, initialPremiumDeposit } = await req.json();
    const rm = getRiskManagerWriter();
    const tx = await rm.purchaseCover(poolId, coverageAmount, initialPremiumDeposit);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
