import { NextResponse } from 'next/server';
import { coverPool } from '../../../../../../lib/coverPool';

export async function GET(_req: Request, { params }: { params: { address: string; poolId: string } }) {
  try {
    const allocated = await coverPool.getIsUnderwriterAllocatedToPool(params.address, BigInt(params.poolId));
    return NextResponse.json({ address: params.address, poolId: Number(params.poolId), allocated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
