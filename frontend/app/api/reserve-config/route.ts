import { NextResponse } from 'next/server'
import { getRiskManager } from '../../../lib/riskManager'
import { getCapitalPool } from '../../../lib/capitalPool'
import deployments from '../../config/deployments'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment')
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0]
    const rm = getRiskManager(dep.riskManager, dep.name)
    const cp = getCapitalPool(dep.capitalPool, dep.name)

    const [cooldown, claimFee, notice] = await Promise.all([
      (rm as any).COVER_COOLDOWN_PERIOD(),
      (rm as any).CLAIM_FEE_BPS(),
      (cp as any).UNDERWRITER_NOTICE_PERIOD(),
    ])
    return NextResponse.json({
      coverCooldownPeriod: cooldown.toString(),
      claimFeeBps: claimFee.toString(),
      underwriterNoticePeriod: notice.toString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
