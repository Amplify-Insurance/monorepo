// app/api/pools/[id]/route.ts

import { NextResponse } from 'next/server';
// import your provider and contract instances
import { riskManager } from '../../../../lib/riskManager';

export async function GET(
  request: Request,
  { params }: { params: { id: string } } // CORRECT: Destructure params from the second argument
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
        return NextResponse.json({ error: "Invalid pool ID" }, { status: 400 });
    }

    const poolInfo = await riskManager.getPoolInfo(id);
    return NextResponse.json({ id, poolInfo });

  } catch (error) {
    console.error(`Error fetching pool ${params.id}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}