import { useState, useEffect } from 'react'


export default function usePools() {
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      console.log('usePools hook initialized')
      try {
        const res = await fetch('/api/pools/list')
        if (res.ok) {
          const data = await res.json()
          setPools(data.pools || [])
        }
      } catch (err) {
        console.error('Failed to load pools', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { pools, loading }
}
