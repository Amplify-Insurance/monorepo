import { NextResponse } from 'next/server'
import { getLossDistributor } from '@/lib/lossDistributor'
import { getRiskManager } from '@/lib/riskManager'
import deployments from '../../../../../../config/deployments'

export async function GET(_req: Request, { params }: { params: { address: string; poolId: string } }) {
  try {
    const addr = params.address.toLowerCase()
    const id = BigInt(params.poolId)
    const results: any[] = []
    for (const dep of deployments) {
      const rm = getRiskManager(dep.riskManager, dep.name)
      const ld = getLossDistributor(dep.lossDistributor, dep.name)
      try {
        const pledge = await rm.underwriterTotalPledge(addr)
        const pending = await ld.getPendingLosses(addr, id, pledge)
        results.push({ deployment: dep.name, pending: pending.toString() })
      } catch {}
    }
    return NextResponse.json({ address: addr, poolId: Number(params.poolId), losses: results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
