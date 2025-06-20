import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { getCommittee } from '../lib/committee'
import { getStaking } from '../lib/staking'

export default function useActiveProposals() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const c = getCommittee()
        const staking = getStaking()

        const count = await c.proposalCounter()
        const quorumBps = await c.quorumBps()
        const totalStaked = await staking.totalStaked()
        const quorumVotes = (BigInt(totalStaked) * BigInt(quorumBps)) / 10000n

        const items = []
        for (let i = Number(count); i > 0; i--) {
          const p = await c.proposals(i)
          const status = Number(p.status)
          // Skip proposals that are finished
          if (status === 2 || status === 3 || status === 4 || status === 6) continue
          const executed = status === 4 || status === 6
          const passed = status === 4 || status === 6
          items.push({
            id: Number(p.id),
            poolId: Number(p.poolId),
            pauseState: Number(p.pType) === 1,
            votingDeadline: Number(p.votingDeadline),
            executed,
            passed,
            forVotes: parseFloat(ethers.utils.formatUnits(p.forVotes, 18)),
            againstVotes: parseFloat(ethers.utils.formatUnits(p.againstVotes, 18)),
            quorumVotes: parseFloat(ethers.utils.formatUnits(quorumVotes.toString(), 18)),
            totalStaked: parseFloat(ethers.utils.formatUnits(totalStaked, 18)),
            abstainVotes: 0,
            votes: []
          })
        }
        setProposals(items)
      } catch (err) {
        console.error('Failed to load active proposals', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { proposals, loading }
}
