import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { getCommittee } from '../lib/committee'
import { STAKING_TOKEN_ADDRESS } from '../app/config/deployments'
import { getTokenDecimals, getTokenSymbol } from '../lib/erc20'
import { getProtocolName } from '../app/config/tokenNameMap'

export default function useUserBonds(address) {
  const [bonds, setBonds] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!address) return
    setLoading(true)
    try {
      const committee = getCommittee()
      const decimals = await getTokenDecimals(STAKING_TOKEN_ADDRESS)
      const symbol = await getTokenSymbol(STAKING_TOKEN_ADDRESS)
      const count = await committee.proposalCounter()
      const items = []
      for (let i = 1; i <= Number(count); i++) {
        const p = await committee.proposals(i)
        if (p.proposer.toLowerCase() !== address.toLowerCase()) continue
        if (Number(p.pType) !== 1) continue
        if (Number(p.status) === 6) continue

          const amount = ethers.utils.formatUnits(p.bondAmount, decimals)
          const statusMap = {
            0: 'Pending',
            1: 'Active',
            2: 'Succeeded',
            3: 'Defeated',
            4: 'Executed',
            5: 'Challenged',
            6: 'Resolved',
          }
          const status = statusMap[Number(p.status)] || 'Unknown'
          const depositDate = new Date(Number(p.creationTime) * 1000)
          const maturityDate = new Date(Number(p.challengeDeadline) * 1000)
          const canWithdraw =
            Number(p.status) === 5 && Date.now() / 1000 >= Number(p.challengeDeadline)
          items.push({
            id: Number(p.id),
            poolId: Number(p.poolId),
            protocol: getProtocolName(Number(p.poolId)),
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
    }

    load()
  }, [address])

  return { bonds, loading, reload: load }
}
