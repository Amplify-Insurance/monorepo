import { NextResponse } from 'next/server'
import { coverPool } from '../../../lib/coverPool'

export async function GET() {
  try {
    const events = await coverPool.queryFilter(
      coverPool.filters.ClaimProcessed()
    )
    const claims = await Promise.all(
      events.map(async (ev) => {
        const {
          policyId,
          poolId,
          claimant,
          netPayoutToClaimant,
          claimFee,
          protocolTokenAmountReceived,
        } = ev.args as any
        const block = await ev.getBlock()
        return {
          transactionHash: ev.transactionHash,
          blockNumber: ev.blockNumber,
          timestamp: block.timestamp,
          policyId: Number(policyId),
          poolId: Number(poolId),
          claimant,
          netPayoutToClaimant: netPayoutToClaimant.toString(),
          claimFee: claimFee.toString(),
          protocolTokenAmountReceived: protocolTokenAmountReceived.toString(),
        }
      })
    )
    return NextResponse.json({ claims })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
