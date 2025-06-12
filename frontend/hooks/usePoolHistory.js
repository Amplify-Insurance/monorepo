import { useState, useEffect } from 'react'

export default function usePoolHistory(poolId) {
  const [premiumHistory, setPremiumHistory] = useState([])
  const [utilHistory, setUtilHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (poolId === undefined || poolId === null) return
    async function load() {
      try {
        const url = process.env.NEXT_PUBLIC_SUBGRAPH_URL
        if (!url) throw new Error('NEXT_PUBLIC_SUBGRAPH_URL not set')
        const pageSize = 1000
        let skip = 0
        const snapshots = []
        while (true) {
          const query = `{ poolUtilizationSnapshots(first: ${pageSize}, skip: ${skip}, where: { pool: \"${poolId}\" }, orderBy: timestamp, orderDirection: asc) { timestamp utilizationBps premiumRateBps } }`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
          })
          const json = await res.json()
          const batch = json?.data?.poolUtilizationSnapshots || []
          snapshots.push(...batch)
          if (batch.length < pageSize) break
          skip += pageSize
        }
        const prem = snapshots.map(s => ({
          date: new Date(Number(s.timestamp) * 1000).toISOString().split('T')[0],
          value: Number(s.premiumRateBps) / 100,
        }))
        const util = snapshots.map(s => ({
          date: new Date(Number(s.timestamp) * 1000).toISOString().split('T')[0],
          value: Number(s.utilizationBps) / 100,
        }))
        setPremiumHistory(prem)
        setUtilHistory(util)
      } catch (err) {
        console.error('Failed to load pool history', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [poolId])

  return { premiumHistory, utilHistory, loading }
}
