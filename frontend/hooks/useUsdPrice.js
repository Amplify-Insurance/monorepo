import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

export default function useUsdPrice(token) {
  const [price, setPrice] = useState(null)

  useEffect(() => {
    if (!token) return
    async function load() {
      try {
        const res = await fetch(`/api/prices/${token}`)
        if (res.ok) {
          const data = await res.json()
          const value = parseFloat(ethers.utils.formatUnits(data.price, data.decimals))
          setPrice(value)
        }
      } catch (err) {
        console.error('Failed to load price', err)
      }
    }
    load()
  }, [token])

  return price
}
