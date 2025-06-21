import { NextResponse } from 'next/server'
import { getPoolRegistry } from '../../../lib/poolRegistry'
import { getCapitalPool } from '../../../lib/capitalPool'
import { getMulticallReader } from '../../../lib/multicallReader'
import { getPoolManager } from '../../../lib/poolManager'

import deployments from '../../config/deployments'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const pr = getPoolRegistry(dep.poolRegistry, dep.name)
    const cp = getCapitalPool(dep.capitalPool, dep.name)
    const pm = getPoolManager(dep.poolManager, dep.name)

    const multicall = getMulticallReader(dep.multicallReader, dep.name)

    const calls = [
      { target: dep.poolManager, callData: pm.interface.encodeFunctionData('coverCooldownPeriod') },
      { target: dep.poolRegistry, callData: pr.interface.encodeFunctionData('getPoolData', [0]) },
      { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('underwriterNoticePeriod') },
    ]

    const res = await multicall.tryAggregate(false, calls)

    const cooldown = res[0].success
      ? pm.interface.decodeFunctionResult('coverCooldownPeriod', res[0].returnData)[0]
      : 0n
    const poolData = res[1].success
      ? pr.interface.decodeFunctionResult('getPoolData', res[1].returnData)
      : null
    const claimFee = poolData ? (poolData.claimFeeBps ?? poolData[6]) : 0n
    const notice = res[2].success
      ? cp.interface.decodeFunctionResult('underwriterNoticePeriod', res[2].returnData)[0]
      : 0n
    return NextResponse.json({
      coverCooldownPeriod: cooldown.toString(),
      claimFeeBps: claimFee.toString(),
      underwriterNoticePeriod: notice.toString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
