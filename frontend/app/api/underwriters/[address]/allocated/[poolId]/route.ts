import { NextResponse } from 'next/server';
import { underwriterManager } from '../../../../../../lib/underwriterManager';

export async function GET(_req: Request, { params }: { params: { address: string; poolId: string } }) {
  try {
    const allocated = await underwriterManager.isAllocatedToPool(params.address, BigInt(params.poolId));
    return NextResponse.json({ address: params.address, poolId: Number(params.poolId), allocated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
