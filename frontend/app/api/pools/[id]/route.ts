// app/api/pools/[id]/route.ts

import { NextResponse } from 'next/server';
// import your provider and contract instances
// import provider from '@/lib/provider'; 
// import { riskManager } from '@/lib/contracts';

export async function GET(
  request: Request,
  { params }: { params: { id: string } } // CORRECT: Destructure params from the second argument
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
        return NextResponse.json({ error: "Invalid pool ID" }, { status: 400 });
    }

    // Now you can safely use the ID to call your contract
    // const poolInfo = await riskManager.getPoolInfo(id);
    // const underwriters = await riskManager.poolSpecificUnderwriters(id); // Example

    // return NextResponse.json({ id, poolInfo, underwriters });
    return NextResponse.json({ success: true, id: id }); // Placeholder response

  } catch (error) {
    console.error(`Error fetching pool ${params.id}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}