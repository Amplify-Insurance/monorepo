import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import ERC20 from '../abi/ERC20.json'
import { getCatPoolWithSigner } from '../lib/catPool'

export default function useCatPoolUserInfo(address) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const cp = await getCatPoolWithSigner()
      const catShareAddr = await cp.catShareToken()
      const provider = new ethers.providers.Web3Provider(window.ethereum)
      const token = new ethers.Contract(catShareAddr, ERC20, provider)
      const [balance, totalSupply, liquid] = await Promise.all([
        token.balanceOf(address),
        token.totalSupply(),
        cp.liquidUsdc(),
      ])
      let value = 0n
      if (totalSupply > 0n) {
        value = (balance * liquid) / totalSupply
      }
      setInfo({
        address: address.toLowerCase(),
        balance: balance.toString(),
        value: value.toString(),
      })
    } catch (err) {
      console.error('Failed to load backstop pool user info', err)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  return { info, loading, refresh: load }
}
