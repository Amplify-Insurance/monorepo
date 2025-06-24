import { NextResponse } from 'next/server'
import { policyNft } from '../../../../lib/policyNft'
import { getPoolRegistry } from '@/lib/poolRegistry'
import { getPolicyManager } from '@/lib/policyManager'
import bnToString from '../../../../lib/bnToString'
import deployments from '../../../config/deployments'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = BigInt(params.id);
    const policy = await policyNft.getPolicy(id)

    let deployment: string | null = null
    let deploymentInfo: any = null
    for (const dep of deployments) {
      const pr = getPoolRegistry(dep.poolRegistry)
      try {
        const count = await pr.getPoolCount()
        if (BigInt(policy.poolId) < count) {
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
        const pending = await pm.pendingCoverIncreases(id, 0)
        pendingIncrease = BigInt(pending.amount)
        increaseActivationTimestamp = BigInt(pending.activationTimestamp)
      } catch {}
    }

    return NextResponse.json({
      id: Number(id),
      deployment,
      policy: {
        ...bnToString(policy),
        pendingIncrease: bnToString(pendingIncrease),
        increaseActivationTimestamp: bnToString(increaseActivationTimestamp),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
