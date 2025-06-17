import { NextResponse } from 'next/server'
import { getRiskManager } from '../../../lib/riskManager'
import { getCapitalPool } from '../../../lib/capitalPool'
import { getMulticallReader } from '../../../lib/multicallReader'
import deployments from '../../config/deployments'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const rm = getRiskManager(dep.riskManager, dep.name)
    const cp = getCapitalPool(dep.capitalPool, dep.name)
    const multicall = getMulticallReader(dep.multicallReader, dep.name)

    const calls = [
      { target: dep.riskManager, callData: rm.interface.encodeFunctionData('COVER_COOLDOWN_PERIOD') },
      { target: dep.riskManager, callData: rm.interface.encodeFunctionData('CLAIM_FEE_BPS') },
      { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('UNDERWRITER_NOTICE_PERIOD') },
    ]

    const res = await multicall.tryAggregate(false, calls)

    const cooldown = res[0].success
      ? rm.interface.decodeFunctionResult('COVER_COOLDOWN_PERIOD', res[0].returnData)[0]
      : 0n
    const claimFee = res[1].success
      ? rm.interface.decodeFunctionResult('CLAIM_FEE_BPS', res[1].returnData)[0]
      : 0n
    const notice = res[2].success
      ? cp.interface.decodeFunctionResult('UNDERWRITER_NOTICE_PERIOD', res[2].returnData)[0]
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
