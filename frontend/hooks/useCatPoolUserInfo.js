import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import ERC20 from '../abi/ERC20.json'
import { getCatPoolWithSigner } from '../lib/catPool'
import { getMulticallReader } from '../lib/multicallReader'

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
      const token = new ethers.Contract(catShareAddr, ERC20.abi, provider)
      const multicall = getMulticallReader()
      const calls = [
        { target: catShareAddr, callData: token.interface.encodeFunctionData('balanceOf', [address]) },
        { target: catShareAddr, callData: token.interface.encodeFunctionData('totalSupply') },
        { target: cp.address, callData: cp.interface.encodeFunctionData('liquidUsdc') },
      ]
      const res = await multicall.tryAggregate(false, calls)
      const balance = res[0].success ? token.interface.decodeFunctionResult('balanceOf', res[0].returnData)[0] : 0n
      const totalSupply = res[1].success ? token.interface.decodeFunctionResult('totalSupply', res[1].returnData)[0] : 0n
      const liquid = res[2].success ? cp.interface.decodeFunctionResult('liquidUsdc', res[2].returnData)[0] : 0n
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
