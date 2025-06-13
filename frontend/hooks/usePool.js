import { useState, useEffect } from 'react'


export default function usePool(id) {
  const [pool, setPool] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id === undefined || id === null) return
    async function load() {
      try {
        const res = await fetch(`/api/pools/${id}`)
        if (res.ok) {
          const data = await res.json()
          setPool(data)
        }
      } catch (err) {
        console.error('Failed to load pool', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  return { pool, loading }
}
