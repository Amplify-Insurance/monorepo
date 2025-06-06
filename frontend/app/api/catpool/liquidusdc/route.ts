import { NextResponse } from 'next/server';
import { catPool } from '../../../../lib/catPool';

export async function GET() {
  try {
    const amount = await catPool.liquidUsdc();
    return NextResponse.json({ liquidUsdc: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
