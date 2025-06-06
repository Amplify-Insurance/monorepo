import { NextResponse } from 'next/server';
import { coverPool } from '../../../lib/coverPool';

export async function GET() {
  try {
    const count = await coverPool.getNumberOfPools();
    return NextResponse.json({ count: Number(count) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
