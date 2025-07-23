import { NextResponse } from 'next/server'
import { getRewardDistributor } from '@/lib/rewardDistributor'
import { getUnderwriterManager } from '@/lib/underwriterManager'
import { getPoolRegistry } from '@/lib/poolRegistry'
import deployments from '../../../../../config/deployments'

export async function GET(_req: Request, { params }: { params: { address: string; poolId: string } }) {
  try {
    const addr = params.address.toLowerCase()
    const id = BigInt(params.poolId)
    const results: any[] = []
    for (const dep of deployments) {
      const rd = getRewardDistributor(dep.rewardDistributor, dep.name)
      const rm = getUnderwriterManager(dep.underwriterManager, dep.name)
      const pr = getPoolRegistry(dep.poolRegistry, dep.name)
      try {
        const pool = await pr.getPoolStaticData(id)
        const pledge = await rm.underwriterPoolPledge(addr, id)
        const pending = await rd.pendingRewards(addr, id, pool.protocolTokenToCover, pledge)
        results.push({ deployment: dep.name, rewardToken: pool.protocolTokenToCover, pending: pending.toString() })
      } catch {}
    }
    return NextResponse.json({ address: addr, poolId: Number(params.poolId), rewards: results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
