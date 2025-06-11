import { useState, useEffect } from 'react'

export default function useCatPoolStats() {
  const [stats, setStats] = useState({ liquidUsdc: '0', apr: '0' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [liqRes, aprRes] = await Promise.all([
          fetch('/api/catpool/liquidusdc'),
          fetch('/api/catpool/apr'),
        ])
        let liquid = '0'
        let apr = '0'
        if (liqRes.ok) {
          const data = await liqRes.json()
          liquid = data.liquidUsdc ?? '0'
        }
        if (aprRes.ok) {
          const data = await aprRes.json()
          apr = data.apr ?? '0'
        }
        setStats({ liquidUsdc: liquid, apr })
      } catch (err) {
        console.error('Failed to load cat pool stats', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { stats, loading }
}
