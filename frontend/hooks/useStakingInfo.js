import { useState, useEffect } from 'react'

export default function useStakingInfo(address) {
  const [info, setInfo] = useState({ staked: '0', totalStaked: '0' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) return
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/staking/user/${address}`)
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setInfo({ staked: data.staked || '0', totalStaked: data.totalStaked || '0' })
      } catch (err) {
        console.error('Failed to load staking info', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address])

  return { info, loading }
}
