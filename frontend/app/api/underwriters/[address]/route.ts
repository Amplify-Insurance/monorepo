// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { getCapitalPool } from '@/lib/capitalPool'
import { getRiskManager } from '@/lib/riskManager'
import { getProvider } from '@/lib/provider'
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
      const provider = getProvider(dep)
      const cp = getCapitalPool(dep.capitalPool, provider)
      const rm = getRiskManager(dep.riskManager, provider)

      try {
        const account = await cp.getUnderwriterAccount(addr)

        let poolCount = 0n
        try {
          poolCount = await (rm as any).protocolRiskPoolsLength()
        } catch {
          while (true) {
            try { await rm.getPoolInfo(poolCount); poolCount++ } catch { break }
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
