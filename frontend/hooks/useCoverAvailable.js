import { useState, useEffect } from 'react'

export default function useCoverAvailable(deployment) {
  const [amount, setAmount] = useState('0')
  const [decimals, setDecimals] = useState(18)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const depParam = deployment ? `?deployment=${deployment}` : ''
        const res = await fetch(`/api/capitalpool/available${depParam}`)
        if (res.ok) {
          const data = await res.json()
          setAmount(data.available ?? '0')
          setDecimals(data.decimals ?? 18)
        }
      } catch (err) {
        console.error('Failed to load cover available', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [deployment])

  return { amount, decimals, loading }
}
