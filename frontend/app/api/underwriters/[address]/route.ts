import { NextResponse } from 'next/server';
import { capitalPool } from '../../../../lib/capitalPool';
import { riskManager } from '../../../../lib/riskManager';

export async function GET(
  _req: Request,
  { params }: { params: { address: string } }
) {
  try {
    const account = await capitalPool.getUnderwriterAccount(params.address);
    const allocations = await riskManager.underwriterAllocations(params.address);
    const details = {
      totalDepositedAssetPrincipal: account[0],
      yieldChoice: account[1],
      masterShares: account[2],
      withdrawalRequestTimestamp: account[3],
      withdrawalRequestShares: account[4],
      allocatedPoolIds: allocations,
    };
    return NextResponse.json({ address: params.address, details });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
