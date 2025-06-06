import { NextResponse } from 'next/server';
import { getCatPoolWriter } from '../../../../lib/catPool';

export async function POST(req: Request) {
  try {
    const { shares } = await req.json();
    const cp = getCatPoolWriter();
    const tx = await cp.withdrawLiquidity(shares);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
