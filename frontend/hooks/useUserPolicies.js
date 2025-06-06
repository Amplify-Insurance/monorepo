import { useState, useEffect } from 'react'

export default function useUserPolicies(address) {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
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
    }
    load()
  }, [address])

  return { policies, loading }
}
