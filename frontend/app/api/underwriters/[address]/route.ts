import { NextResponse } from 'next/server';
import { capitalPool } from '../../../../lib/capitalPool';
import { riskManager } from '../../../../lib/riskManager';

export async function GET(
  _req: Request,
  { params }: { params: { address: string } }
) {
  try {
    const account = await capitalPool.getUnderwriterAccount(params.address);

    // ── Determine the list of pools this underwriter has allocated capital to ──
    let poolCount = 0n;
    try {
      poolCount = await (riskManager as any).protocolRiskPoolsLength();
    } catch {
      // Fallback for older contract versions lacking the length helper
      while (true) {
        try {
          await riskManager.getPoolInfo(poolCount);
          poolCount++;
        } catch {
          break;
        }
      }
    }

    const allocatedPoolIds: number[] = [];
    for (let i = 0; i < Number(poolCount); i++) {
      try {
        const allocated = await riskManager.isAllocatedToPool(
          params.address,
          BigInt(i),
        );
        if (allocated) allocatedPoolIds.push(i);
      } catch {
        // ignore pools that error out
        continue;
      }
    }

    const details = {
      totalDepositedAssetPrincipal: account[0],
      yieldChoice: account[1],
      masterShares: account[2],
      withdrawalRequestTimestamp: account[3],
      withdrawalRequestShares: account[4],
      allocatedPoolIds,
    };
    return NextResponse.json({ address: params.address, details });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
