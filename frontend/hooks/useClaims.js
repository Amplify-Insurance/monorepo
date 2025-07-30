import { useState, useEffect, useCallback } from 'react'

export default function useClaims() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/claims')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setClaims(data.claims || [])
    } catch (err) {
      console.error('Failed to load claims', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [load])

  return { claims, loading, refresh: load }
}
