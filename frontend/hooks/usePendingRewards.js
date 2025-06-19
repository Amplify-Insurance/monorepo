import { useState, useEffect } from 'react'

export default function usePendingRewards(address, poolId, deployment) {
  const [amount, setAmount] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address || poolId == null || !deployment) return
    async function load() {
      try {
        const res = await fetch(`/api/underwriters/${address}/rewards/${poolId}?deployment=${deployment}`)
        if (res.ok) {
          const data = await res.json()
          const item = (data.rewards || []).find(r => r.deployment === deployment)
          setAmount(item ? item.pending : '0')
        }
      } catch (err) {
        console.error('Failed to load pending rewards', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address, poolId, deployment])

  return { amount, loading }
}
