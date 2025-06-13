// app/api/policies/user/[address]/route.ts
import { NextResponse } from 'next/server'
import { policyNft } from '@/lib/policyNft'
import { getRiskManager } from '@/lib/riskManager'
import { getProvider } from '@/lib/provider'
import deployments from '../../../../config/deployments'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    /* await the promise that lives on `params` */
    const { address } = await params
    const addr = address.toLowerCase()

    const nextId = await policyNft.nextId()
    const policies: any[] = []

    for (let i = 1n; i < nextId; i++) {
      try {
        const owner = await policyNft.ownerOf(i)
        if (owner.toLowerCase() === addr) {
          const p = await policyNft.getPolicy(i)
          let deployment: string | null = null
          for (const dep of deployments) {
            const rm = getRiskManager(dep.riskManager, getProvider(dep.name))
            try {
              await rm.getPoolInfo(p.poolId)
              deployment = dep.name
              break
            } catch {}
          }
          policies.push({ id: Number(i), deployment, ...p })
        }
      } catch {
        /* token burned / does not exist — ignore */
      }
    }

    return NextResponse.json({ address: addr, policies })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
