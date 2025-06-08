import { NextResponse } from 'next/server';
import { capitalPool } from '../../../lib/capitalPool';

export async function GET() {
  try {
    const addresses: string[] = [];
    for (let i = 0; i < 20; i++) {
      try {
        const addr = await (capitalPool as any).activeYieldAdapterAddresses(i);
        addresses.push(addr);
      } catch {
        break;
      }
    }
    return NextResponse.json({ addresses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
