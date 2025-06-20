import { useState, useEffect } from 'react'
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
          if (p.executed) continue
          items.push({
            id: Number(p.id),
            poolId: Number(p.poolId),
            pauseState: Number(p.pType) === 1,
            votingDeadline: Number(p.votingDeadline),
            executed: p.executed,
            passed: false,
            forVotes: Number(p.forVotes),
            againstVotes: Number(p.againstVotes),
            quorumVotes: Number(quorumVotes),
            totalStaked: Number(totalStaked),
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
