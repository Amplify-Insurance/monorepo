import { NextResponse } from 'next/server'
import { getProvider } from '../../../../../lib/provider'
import { getStaking } from '../../../../../lib/staking'
import deployments from '../../../../config/deployments'

export async function GET(req: Request, { params }: { params: { address: string } }) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const staking = getStaking(dep.staking, dep.name)
    const addr = params.address.toLowerCase()
    const [staked, total] = await Promise.all([
      staking.stakedBalance(addr),
      staking.totalStaked(),
    ])
    return NextResponse.json({ address: addr, staked: staked.toString(), totalStaked: total.toString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
