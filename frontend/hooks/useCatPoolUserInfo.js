import { useState, useEffect } from 'react'

export default function useCatPoolUserInfo(address) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
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
    }
    load()
  }, [address])

  return { info, loading }
}
