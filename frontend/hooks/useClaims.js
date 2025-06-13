import { useState, useEffect } from 'react'

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
        const results = []

        while (true) {
          const query = `{ claims(first: ${pageSize}, skip: ${skip}, orderBy: timestamp, orderDirection: desc) { policyId poolId claimant coverage netPayoutToClaimant claimFee protocolTokenAmountReceived timestamp transactionHash } }`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          })
          const json = await res.json()
          const batch = json?.data?.claims || []
          results.push(...batch)
          if (batch.length < pageSize) break
          skip += pageSize
        }

        const claimsData = results.map((c) => ({
          transactionHash: c.transactionHash,
          timestamp: Number(c.timestamp),
          policyId: Number(c.policyId),
          poolId: Number(c.poolId),
          claimant: c.claimant,
          coverage: c.coverage,
          netPayoutToClaimant: c.netPayoutToClaimant,
          claimFee: c.claimFee,
          protocolTokenAmountReceived: c.protocolTokenAmountReceived,
        }))

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
