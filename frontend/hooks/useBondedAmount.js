import { useState, useEffect } from 'react'

export default function useBondedAmount(address) {
  const [amount, setAmount] = useState('0')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/committee/user/${address}`)
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setAmount(data.totalBonded || '0')
      } catch (err) {
        console.error('Failed to load bonded amount', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address])

  return { amount, loading }
}
