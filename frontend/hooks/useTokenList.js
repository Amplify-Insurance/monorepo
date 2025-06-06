import { useState, useEffect } from 'react'
import { getTokenSymbol, getTokenName } from '../lib/erc20'

export default function useTokenList(pools) {
  const [tokens, setTokens] = useState([])

  useEffect(() => {
    if (!pools || pools.length === 0) {
      setTokens([])
      return
    }
    async function load() {
      try {
        const unique = [...new Set(pools.map(p => p.protocolTokenToCover))]
        const list = await Promise.all(
          unique.map(async (addr) => ({
            address: addr,
            symbol: (await getTokenSymbol(addr)) || addr.slice(0, 6),
            name: (await getTokenName(addr)) || addr,
          }))
        )
        setTokens(list)
      } catch (err) {
        console.error('Failed to load token list', err)
      }
    }
    load()
  }, [pools])

  return tokens
}
