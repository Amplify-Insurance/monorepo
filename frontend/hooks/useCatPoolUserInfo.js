import { useState, useEffect, useCallback } from 'react'

export default function useCatPoolUserInfo(address) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const res = await fetch(`/api/catpool/user/${address}`)
      if (res.ok) {
        const data = await res.json()
        setInfo(data)
      }
    } catch (err) {
      console.error('Failed to load cat pool user info', err)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  return { info, loading, refresh: load }
}
