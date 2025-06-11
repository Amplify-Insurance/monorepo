import { useState, useEffect } from 'react'

export default function useAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/analytics')
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch (err) {
        console.error('Failed to load analytics data', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { data, loading }
}
