import { NextResponse } from 'next/server';
import { coverPool } from '../../../../lib/coverPool';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    const info = await coverPool.getPoolInfo(id);
    const underwriters = await coverPool.getPoolUnderwriters(id);
    return NextResponse.json({ id, info, underwriters });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
