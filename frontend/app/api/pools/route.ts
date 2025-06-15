// app/api/pools/list/route.ts
import { NextResponse } from 'next/server';
import { poolRegistry } from '../../../lib/poolRegistry';

export async function GET() {
  console.log('GET /api/pools/list caller');

  try {
    let count = 0n;
    try {
      count = await poolRegistry.getPoolCount();
      console.log('getPoolCount:', count);
    } catch {
      while (true) {
        console.log('getPoolCount: null');
        try { await poolRegistry.getPoolData(count); count++; } catch { break; }
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
