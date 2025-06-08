import { NextResponse } from 'next/server';
import { riskManager } from '../../../../../../lib/riskManager';

export async function GET(_req: Request, { params }: { params: { address: string; poolId: string } }) {
  try {
    const allocated = await riskManager.isAllocatedToPool(params.address, BigInt(params.poolId));
    return NextResponse.json({ address: params.address, poolId: Number(params.poolId), allocated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
