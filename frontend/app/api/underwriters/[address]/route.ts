// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { capitalPool } from '@/lib/capitalPool'
import { riskManager } from '@/lib/riskManager'

export async function GET(
  _req: Request,
  context: { params: Promise<{ address: string }> }
) {
  try {
    /* Unwrap the promise that lives on context.params */
    const { address } = await context.params
    const addr = address.toLowerCase()

    // ── 1. fetch underwriter account ──
    const account = await capitalPool.getUnderwriterAccount(addr)

    // ── 2. count pools ──
    let poolCount = 0n
    try {
      poolCount = await (riskManager as any).protocolRiskPoolsLength()
    } catch {
      while (true) {
        try {
          await riskManager.getPoolInfo(poolCount)
          poolCount++
        } catch {
          break
        }
      }
    }

    // ── 3. which pools this underwriter allocated ──
    const allocatedPoolIds: number[] = []
    for (let i = 0; i < Number(poolCount); i++) {
      try {
        const allocated = await riskManager.isAllocatedToPool(addr, BigInt(i))
        if (allocated) allocatedPoolIds.push(i)
      } catch {
        /* ignore pools that revert */
      }
    }

    const details = {
      totalDepositedAssetPrincipal: account[0],
      yieldChoice: account[1],
      masterShares: account[2],
      withdrawalRequestTimestamp: account[3],
      withdrawalRequestShares: account[4],
      allocatedPoolIds,
    }

    return NextResponse.json({ address: addr, details })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
