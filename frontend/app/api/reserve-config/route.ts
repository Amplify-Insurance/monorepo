import { NextResponse } from 'next/server'
import { riskManager } from '../../../lib/riskManager'
import { capitalPool } from '../../../lib/capitalPool'

export async function GET() {
  try {
    const [cooldown, claimFee, notice] = await Promise.all([
      (riskManager as any).COVER_COOLDOWN_PERIOD(),
      (riskManager as any).CLAIM_FEE_BPS(),
      (capitalPool as any).UNDERWRITER_NOTICE_PERIOD(),
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
