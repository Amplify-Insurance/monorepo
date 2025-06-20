import { NextResponse } from 'next/server'
import { getCommittee } from '../../../../../lib/committee'
import deployments from '../../../../config/deployments'

export async function GET(req: Request, { params }: { params: { address: string } }) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const committee = getCommittee(dep.committee, dep.name)

    const addr = params.address.toLowerCase()
    const count: bigint = await committee.proposalCounter()
    let total = 0n
    for (let i = 1n; i <= count; i++) {
      const p = await committee.proposals(i)
      if (p.proposer.toLowerCase() === addr && Number(p.status) !== 6) {
        total += BigInt(p.bondAmount)
      }
    }
    return NextResponse.json({ address: addr, totalBonded: total.toString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
