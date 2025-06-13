import { useState, useEffect } from 'react'

export default function useProposals() {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const url = process.env.NEXT_PUBLIC_SUBGRAPH_URL
        if (!url) throw new Error('NEXT_PUBLIC_SUBGRAPH_URL not set')
        const query = `{
          governanceProposals(orderBy: id, orderDirection: desc) {
            id
            proposer
            poolId
            pauseState
            votingDeadline
            executed
            passed
            forVotes
            againstVotes
            abstainVotes
            votes {
              id
              voter
              vote
              weight
            }
          }
        }`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        })
        const json = await res.json()
        const items = json?.data?.governanceProposals || []
        setProposals(items.map((p) => ({
          ...p,
          id: Number(p.id),
          poolId: Number(p.poolId),
          votingDeadline: Number(p.votingDeadline),
          votes: p.votes.map((v) => ({
            id: v.id,
            voter: v.voter,
            vote: Number(v.vote),
            weight: v.weight
          }))
        })))
      } catch (err) {
        console.error('Failed to load proposals', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { proposals, loading }
}
