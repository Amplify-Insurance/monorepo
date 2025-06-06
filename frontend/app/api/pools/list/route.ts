import { NextResponse } from 'next/server';
import { coverPool } from '../../../../lib/coverPool';

export async function GET() {
  try {
    const count = await coverPool.getNumberOfPools();
    const pools = [] as any[];
    for (let i = 0; i < Number(count); i++) {
      const info = await coverPool.getPoolInfo(i);
      pools.push({ id: i, ...info });
    }
    return NextResponse.json({ pools });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
