// app/api/policies/user/[address]/route.ts
import { NextResponse } from 'next/server'
import { policyNft } from '@/lib/policyNft'
import { getPoolRegistry } from '@/lib/poolRegistry'
import { getPolicyManager } from '@/lib/policyManager'
import bnToString from '../../../../../lib/bnToString'
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
          let deploymentInfo: any = null
          for (const dep of deployments) {
            const pr = getPoolRegistry(dep.poolRegistry)
            try {
              const count = await pr.getPoolCount()
              if (BigInt(p.poolId) < count) {
                deployment = dep.name
                deploymentInfo = dep
                break
              }
            } catch {}
          }
          let pendingIncrease = 0n
          let increaseActivationTimestamp = 0n
          if (deploymentInfo) {
            try {
              const pm = getPolicyManager(deploymentInfo.policyManager, deploymentInfo.name)
              const pending = await pm.pendingCoverIncreases(i, 0)
              pendingIncrease = BigInt(pending.amount)
              increaseActivationTimestamp = BigInt(pending.activationTimestamp)
            } catch {}
          }

          policies.push({
            id: Number(i),
            deployment,
            ...bnToString(p),
            pendingIncrease: bnToString(pendingIncrease),
            increaseActivationTimestamp: bnToString(
              increaseActivationTimestamp,
            ),
          })
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
