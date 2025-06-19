"use client"
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
// Data is provided via props so this table can display
// either active on-chain proposals or historical ones
// loaded from the subgraph.
import { getCommitteeWithSigner } from '../../lib/committee'
import { getStakingWithSigner } from '../../lib/staking'
import { useAccount } from 'wagmi'

export default function ProposalsTable({ proposals, loading }) {
  const [expanded, setExpanded] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const { isConnected } = useAccount()

  const toggle = (id) => {
    setExpanded((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleVote = async (id, vote) => {
    if (!isConnected) return
    setIsSubmitting(true)
    try {
      const committee = await getCommitteeWithSigner()
      const tx = await committee.vote(id, vote)
      await tx.wait()
    } catch (err) {
      console.error('Vote failed', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClaim = async (id) => {
    if (!isConnected) return
    setIsClaiming(true)
    try {
      const committee = await getCommitteeWithSigner()
      const tx = await committee.claimReward(id)
      await tx.wait()
    } catch (err) {
      console.error('Claim failed', err)
    } finally {
      setIsClaiming(false)
    }
  }

  const handleWithdrawBond = async (poolId) => {
    if (!isConnected) return
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.withdrawBond(poolId)
      await tx.wait()
    } catch (err) {
      console.error('Withdraw bond failed', err)
    }
  }

  if (loading) return <p>Loading proposals...</p>

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <div className="inline-block min-w-full align-middle">
        <div className="overflow-hidden shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Proposal</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Deadline</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Status</th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {proposals.map((p) => (
                <>
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Pool {p.poolId} - {p.pauseState ? 'Pause' : 'Unpause'}</div>
                      <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                        {p.executed ? (p.passed ? 'Passed' : 'Failed') : 'Active'}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">{new Date(p.votingDeadline * 1000).toLocaleDateString()}</div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">{p.executed ? (p.passed ? 'Passed' : 'Failed') : 'Active'}</div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => toggle(p.id)} className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto">
                        <span className="hidden sm:inline">{expanded.includes(p.id) ? 'Hide' : 'View'}</span>
                        {expanded.includes(p.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                  {expanded.includes(p.id) && (
                    <tr>
                      <td colSpan={4} className="px-3 sm:px-6 py-4">
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 sm:p-4">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Votes</h4>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                              <thead>
                                <tr>
                                  <th className="px-2 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Voter</th>
                                  <th className="px-2 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Vote</th>
                                  <th className="px-2 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Weight</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {p.votes.map((v) => (
                                  <tr key={v.id}>
                                    <td className="px-2 py-1 font-mono text-xs break-all">{v.voter}</td>
                                    <td className="px-2 py-1">{v.vote === 1 ? 'For' : v.vote === 0 ? 'Against' : 'Abstain'}</td>
                                    <td className="px-2 py-1">{v.weight}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {p.executed && (
                            <div className="mt-3 text-sm flex items-center gap-3">
                              <span>Result: {p.passed ? 'Passed' : 'Failed'}</span>
                              <button
                                onClick={() => handleClaim(p.id)}
                                disabled={isClaiming}
                                className="py-1 px-3 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                              >
                                Claim Reward
                              </button>
                              <button
                                onClick={() => handleWithdrawBond(p.poolId)}
                                className="py-1 px-3 bg-blue-600 text-white rounded hover:bg-blue-700"
                              >
                                Withdraw Bond
                              </button>
                            </div>
                          )}
                          {!p.executed && p.votingDeadline * 1000 > Date.now() && (
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => handleVote(p.id, 1)}
                                disabled={isSubmitting}
                                className="py-1 px-3 text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                Vote For
                              </button>
                              <button
                                onClick={() => handleVote(p.id, 0)}
                                disabled={isSubmitting}
                                className="py-1 px-3 text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                              >
                                Vote Against
                              </button>
                              <button
                                onClick={() => handleVote(p.id, 2)}
                                disabled={isSubmitting}
                                className="py-1 px-3 text-white bg-gray-600 rounded hover:bg-gray-700 disabled:opacity-50"
                              >
                                Abstain
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
