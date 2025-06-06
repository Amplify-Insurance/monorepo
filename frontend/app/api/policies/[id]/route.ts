import { NextResponse } from 'next/server';
import { policyNft } from '../../../../lib/policyNft';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = BigInt(params.id);
    const policy = await policyNft.getPolicy(id);
    return NextResponse.json({ id: Number(id), policy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
