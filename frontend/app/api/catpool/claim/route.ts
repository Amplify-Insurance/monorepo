import { NextResponse } from 'next/server';
import { getCatPoolWriter } from '../../../../lib/catPool';

export async function POST(req: Request) {
  try {
    const { tokens } = await req.json();
    const cp = getCatPoolWriter();
    const tx = await cp.claimProtocolAssetRewards(tokens);
    await tx.wait();
    return NextResponse.json({ txHash: tx.hash });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
