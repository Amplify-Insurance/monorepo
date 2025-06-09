// app/api/pools/list/route.ts
import { NextResponse } from 'next/server';
import { riskManager } from '../../../lib/riskManager';

export async function GET() {
  console.log('GET /api/pools/list caller');

  try {
    let count = 0n;
    try {
      count = await (riskManager as any).protocolRiskPoolsLength();
      console.log('protocolRiskPoolsLength:', count);
    } catch {
      while (true) {
        console.log('protocolRiskPoolsLength: null');
        try { await riskManager.getPoolInfo(count); count++; } catch { break; }
      }
    }
    return NextResponse.json({ count: Number(count) });
  } catch (err: any) {
    // 🔍 Log the full error object so you can inspect stack trace & metadata in the terminal
    console.error('error here', err);

    // Surface a concise message to the client
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    );
  }
}
