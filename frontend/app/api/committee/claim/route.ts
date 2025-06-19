import { NextResponse } from 'next/server'
import { getCommitteeWriter } from '../../../../lib/committee'
import deployments from '../../../config/deployments'

export async function POST(req: Request) {
  try {
    const { proposalIds, deployment: depName } = await req.json()
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const committee = getCommitteeWriter(dep.committee, dep.name)
    for (const id of proposalIds as number[]) {
      const tx = await committee.claimReward(id)
      await tx.wait()
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
