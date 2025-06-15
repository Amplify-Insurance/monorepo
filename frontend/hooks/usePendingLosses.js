import { useState, useEffect } from 'react'

export default function usePendingLosses(address, poolId) {
  const [losses, setLosses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address || poolId === undefined) return
    async function load() {
      try {
        const res = await fetch(`/api/underwriters/${address}/losses/${poolId}`)
        if (res.ok) {
          const data = await res.json()
          setLosses(data.losses || [])
        }
      } catch (err) {
        console.error('Failed to load pending losses', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address, poolId])

  return { losses, loading }
}
