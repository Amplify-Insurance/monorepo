import { useState, useEffect } from 'react'

export default function useReserveConfig() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/reserve-config')
        if (res.ok) {
          const data = await res.json()
          setConfig({
            coverCooldownPeriod: Number(data.coverCooldownPeriod || 0),
            claimFeeBps: Number(data.claimFeeBps || 0),
            underwriterNoticePeriod: Number(data.underwriterNoticePeriod || 0),
          })
        }
      } catch (err) {
        console.error('Failed to load reserve config', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { config, loading }
}
