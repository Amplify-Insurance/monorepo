import { NextResponse } from 'next/server';
import { coverPool } from '../../../lib/coverPool';

export async function GET() {
  try {
    const addresses = await coverPool.getActiveYieldAdapterAddresses();
    return NextResponse.json({ addresses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
