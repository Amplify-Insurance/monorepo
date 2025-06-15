// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { getCapitalPool } from '@/lib/capitalPool'
import { getRiskManager } from '@/lib/riskManager'
import { getPoolRegistry } from '@/lib/poolRegistry'
import deployments from '../../../config/deployments'

export async function GET(
  _req: Request,
  context: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await context.params
    const addr = address.toLowerCase()

    const details: any[] = []

    for (const dep of deployments) {
      const cp = getCapitalPool(dep.capitalPool, dep.name)
      const rm = getRiskManager(dep.riskManager, dep.name)
      const pr = getPoolRegistry(dep.poolRegistry, dep.name)

      try {
        const account = await cp.getUnderwriterAccount(addr)

        let poolCount = 0n
        try {
          poolCount = await pr.getPoolCount()
        } catch {
          while (true) {
            try { await pr.getPoolData(poolCount); poolCount++ } catch { break }
          }
        }

        const allocatedPoolIds: number[] = []
        for (let i = 0; i < Number(poolCount); i++) {
          try {
            const allocated = await rm.isAllocatedToPool(addr, BigInt(i))
            if (allocated) allocatedPoolIds.push(i)
          } catch {}
        }

        details.push({
          deployment: dep.name,
          totalDepositedAssetPrincipal: account[0],
          yieldChoice: account[1],
          masterShares: account[2],
          withdrawalRequestTimestamp: account[3],
          withdrawalRequestShares: account[4],
          allocatedPoolIds,
        })
      } catch {}
    }

    return NextResponse.json({ address: addr, details })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
