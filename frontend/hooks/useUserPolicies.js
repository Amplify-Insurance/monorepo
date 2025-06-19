import { useState, useEffect, useCallback } from 'react'

export default function useUserPolicies(address) {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const res = await fetch(`/api/policies/user/${address}`)
      if (res.ok) {
        const data = await res.json()
        setPolicies(data.policies || [])
      }
    } catch (err) {
      console.error('Failed to load policies', err)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  return { policies, loading, refresh: load }
}
