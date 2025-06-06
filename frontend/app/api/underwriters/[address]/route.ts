import { NextResponse } from 'next/server';
import { coverPool } from '../../../../lib/coverPool';

export async function GET(
  _req: Request,
  { params }: { params: { address: string } }
) {
  try {
    const details = await coverPool.getUnderwriterAccountDetails(params.address);
    return NextResponse.json({ address: params.address, details });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
