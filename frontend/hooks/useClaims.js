import { useState, useEffect } from 'react'

export default function useClaims() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/claims')
        if (res.ok) {
          const data = await res.json()
          setClaims(data.claims || [])
        }
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
