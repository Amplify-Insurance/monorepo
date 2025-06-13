import { useState, useEffect } from 'react'
import usePools from './usePools'

export default function useCatPoolRewards(address) {
  const { pools } = usePools()
  const [rewards, setRewards] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
      setLoading(true)
      try {
        const tokens = [...new Set(pools.map(p => p.protocolTokenToCover))]
        const results = await Promise.all(
          tokens.map(async (token) => {
            try {
              const res = await fetch(`/api/catpool/rewards/${address}/${token}`)
              if (!res.ok) return null
              const data = await res.json()
              const amt = BigInt(data.claimable || '0')
              if (amt === 0n) return null
              return { token, amount: data.claimable }
            } catch {
              return null
            }
          })
        )
        setRewards(results.filter(Boolean))
      } catch (err) {
        console.error('Failed to load cat pool rewards', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address, pools])

  return { rewards, loading }
}
