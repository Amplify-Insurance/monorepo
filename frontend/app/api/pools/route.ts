// app/api/pools/list/route.ts
import { NextResponse } from 'next/server';
import { coverPool } from '../../../lib/coverPool';

export async function GET() {
  try {
    const count = await coverPool.getNumberOfPools();
    return NextResponse.json({ count: Number(count) });
  } catch (err: any) {
    // 🔍 Log the full error object so you can inspect stack trace & metadata in the terminal
    console.error('GET /api/pools/list failed', err);

    // Surface a concise message to the client
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    );
  }
}