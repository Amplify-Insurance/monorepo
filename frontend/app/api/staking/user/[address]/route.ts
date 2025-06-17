import { NextResponse } from 'next/server'
import { getStaking } from '../../../../../lib/staking'
import { getMulticallReader } from '../../../../../lib/multicallReader'
import deployments from '../../../../config/deployments'

export async function GET(req: Request, { params }: { params: { address: string } }) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const staking = getStaking(dep.staking, dep.name)
    const multicall = getMulticallReader(dep.multicallReader, dep.name)
    const addr = params.address.toLowerCase()
    const calls = [
      { target: dep.staking, callData: staking.interface.encodeFunctionData('stakedBalance', [addr]) },
      { target: dep.staking, callData: staking.interface.encodeFunctionData('totalStaked') },
    ]
    const res = await multicall.tryAggregate(false, calls)
    const staked = res[0].success
      ? staking.interface.decodeFunctionResult('stakedBalance', res[0].returnData)[0]
      : 0n
    const total = res[1].success
      ? staking.interface.decodeFunctionResult('totalStaked', res[1].returnData)[0]
      : 0n
    return NextResponse.json({ address: addr, staked: staked.toString(), totalStaked: total.toString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
