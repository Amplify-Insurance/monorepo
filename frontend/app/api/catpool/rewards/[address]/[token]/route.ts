import { NextResponse } from 'next/server';
import { catPool } from '../../../../../../lib/catPool';

export async function GET(_req: Request, { params }: { params: { address: string; token: string } }) {
  try {
    const amount = await catPool.calculateClaimableProtocolAssetRewards(params.address, params.token);
    return NextResponse.json({ address: params.address, token: params.token, claimable: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
