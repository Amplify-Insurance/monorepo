import { NextResponse } from 'next/server';
import { catPool } from '../../../../../../lib/catPool';

export async function GET(_req: Request, { params }: { params: Promise<{ address: string; token: string }> }) {
  const { address, token } = await params;
  try {
    const amount = await catPool.calculateClaimableProtocolAssetRewards(address, token);
    return NextResponse.json({ address, token, claimable: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
