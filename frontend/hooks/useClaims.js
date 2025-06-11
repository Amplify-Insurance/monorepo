import { useState, useEffect } from 'react'
import { riskManager } from '../lib/riskManager'
import { policyNft } from '../lib/policyNft'

export default function useClaims() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const url = process.env.NEXT_PUBLIC_SUBGRAPH_URL
        if (!url) throw new Error('NEXT_PUBLIC_SUBGRAPH_URL not set')

        const pageSize = 1000
        let skip = 0
        const events = []

        while (true) {
          const query = `{ genericEvents(first: ${pageSize}, skip: ${skip}, orderBy: timestamp, orderDirection: desc, where: { eventName: "ClaimProcessed" }) { blockNumber timestamp transactionHash data } }`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          })
          const json = await res.json()
          const batch = json?.data?.genericEvents || []
          events.push(...batch)
          if (batch.length < pageSize) break
          skip += pageSize
        }

        const claimsData = await Promise.all(
          events.map(async (ev) => {
            const [policyIdStr, poolIdStr, claimant, netPayoutStr] = ev.data.split(',')
            const policyId = Number(policyIdStr)
            const poolId = Number(poolIdStr)

            let coverage = 0n
            try {
              const pol = await policyNft.getPolicy(BigInt(policyId))
              coverage = BigInt(pol.coverage.toString())
            } catch (err) {
              console.error(`Failed to fetch policy ${policyId}`, err)
            }

            let scale = 0n
            try {
              const info = await riskManager.getPoolInfo(poolId)
              scale = BigInt(info.scaleToProtocolToken.toString())
            } catch (err) {
              console.error(`Failed to fetch pool ${poolId}`, err)
            }

            const protocolTokenAmountReceived = (coverage * scale).toString()
            const netPayout = BigInt(netPayoutStr)
            const claimFee = coverage > netPayout ? (coverage - netPayout).toString() : '0'

            return {
              transactionHash: ev.transactionHash,
              blockNumber: Number(ev.blockNumber),
              timestamp: Number(ev.timestamp),
              policyId,
              poolId,
              claimant,
              coverage: coverage.toString(),
              netPayoutToClaimant: netPayoutStr,
              claimFee,
              protocolTokenAmountReceived,
            }
          })
        )

        setClaims(claimsData)
      } catch (err) {
        console.error('Failed to load claims', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { claims, loading }
}
