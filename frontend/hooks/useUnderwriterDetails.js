import { useState, useEffect } from 'react'

export default function useUnderwriterDetails(address) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
      try {
        const res = await fetch(`/api/underwriters/${address}`)
        if (res.ok) {
          const data = await res.json()
          setDetails(data.details)
        }
      } catch (err) {
        console.error('Failed to load underwriter details', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address])

  return { details, loading }
}
