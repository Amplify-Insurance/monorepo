import { useState, useEffect, useCallback } from 'react' // Import useCallback
import { ethers } from 'ethers'
import { getCommittee } from '../lib/committee'
import { STAKING_TOKEN_ADDRESS } from '../app/config/deployments'
import { getTokenMetadata } from '../lib/erc20'
import { getProtocolName, getProtocolLogo } from '../app/config/tokenNameMap'

export default function useUserBonds(address) {
  const [bonds, setBonds] = useState([])
  const [loading, setLoading] = useState(true)

  // Wrap the 'load' function in useCallback
  const load = useCallback(async () => {
    if (!address) {
      setBonds([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const committee = getCommittee()
      const meta = await getTokenMetadata(STAKING_TOKEN_ADDRESS)
      const decimals = meta.decimals
      const symbol = meta.symbol
      const count = await committee.proposalCounter()
      const items = []
      for (let i = 1; i <= Number(count); i++) {
        const p = await committee.proposals(i)
        if (p.proposer.toLowerCase() !== address.toLowerCase()) continue
        if (Number(p.pType) !== 1) continue // Not a "Pause" proposal

        const amount = ethers.utils.formatUnits(p.bondAmount, decimals)
        const statusMap = {
          0: 'Active',
          1: 'Defeated',
          2: 'Challenged',
          3: 'Executed',
        }
        const status = statusMap[Number(p.status)] || 'Unknown'
        const depositDate = new Date(Number(p.creationTime) * 1000)
        const maturityDate = new Date(Number(p.challengeDeadline) * 1000)
        const canWithdraw = Number(p.status) === 3 && !p.bondWithdrawn
        
        items.push({
          id: Number(p.id),
          poolId: Number(p.poolId),
          protocol: getProtocolName(Number(p.poolId)),
          protocolLogo: getProtocolLogo(Number(p.poolId)),
          amount,
          symbol,
          status,
          depositDate,
          maturityDate,
          canWithdraw,
          rewards: ethers.utils.formatEther(p.totalRewardFees),
          slashedAmount: '0',
        })
      }
      setBonds(items)
    } catch (err) {
      console.error('Failed to load user bonds', err)
      setBonds([])
    } finally {
      setLoading(false)
    }
  }, [address]) // `load` is re-created only when `address` changes

  // useEffect now safely depends on the memoized `load` function
  useEffect(() => {
    load()
  }, [load])

  return { bonds, loading, reload: load }
}