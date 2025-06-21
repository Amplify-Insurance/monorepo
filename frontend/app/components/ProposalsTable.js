"use client"
import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
// Data is provided via props so this table can display
// either active on-chain proposals or historical ones
// loaded from the subgraph.
import { getCommitteeWithSigner } from "../../lib/committee"
import { getStakingWithSigner } from "../../lib/staking"
import { useAccount } from "wagmi"
import VoteConfirmationModal from "./VoteConfirmationModal"
import usePools from "../../hooks/usePools"
import { getProtocolName, getTokenName } from "../config/tokenNameMap"

export default function ProposalsTable({ proposals, loading }) {
  const [expanded, setExpanded] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const { isConnected } = useAccount()
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [pendingVote, setPendingVote] = useState(null)
  const [votingPower, setVotingPower] = useState(0)
  const [voterPage, setVoterPage] = useState({})
  const { pools } = usePools()

  const toggle = (id) => {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleVoteClick = (proposalId, voteType) => {
    const proposal = proposals.find((p) => p.id === proposalId)
    setPendingVote({ proposalId, voteType, proposal })
    // In a real app, you'd fetch the user's actual voting power from the contract
    // For now, we'll use a placeholder value
    setVotingPower(1000) // This should be fetched from the staking contract
    setShowVoteModal(true)
  }

  const handleVoteConfirm = async () => {
    if (!pendingVote || !isConnected) return
    setIsSubmitting(true)
    try {
      const committee = await getCommitteeWithSigner()
      const tx = await committee.vote(pendingVote.proposalId, pendingVote.voteType)
      await tx.wait()
      setShowVoteModal(false)
      setPendingVote(null)
    } catch (err) {
      console.error("Vote failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVoteCancel = () => {
    setShowVoteModal(false)
    setPendingVote(null)
  }

  const handleClaim = async (id) => {
    if (!isConnected) return
    setIsClaiming(true)
    try {
      const committee = await getCommitteeWithSigner()
      const tx = await committee.claimReward(id)
      await tx.wait()
    } catch (err) {
      console.error("Claim failed", err)
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
      console.error("Withdraw bond failed", err)
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
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Proposal
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                  Deadline
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                  Status
                </th>
                <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {proposals.map((p) => {
                // --- Data processing and variable setup ---
                const pool = pools.find((pl) => Number(pl.id) === p.poolId);
                const protocolName = getProtocolName(p.poolId);
                const tokenName = pool ? getTokenName(pool.protocolTokenToCover) : "N/A";
                const status = p.executed ? (p.passed ? "Passed" : "Failed") : "Active";
                const isExpanded = expanded.includes(p.id);

                const statusClass =
                  status === "Active"
                    ? "text-blue-600 dark:text-blue-400"
                    : status === "Passed"
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400";

                // --- Create an array to hold the rows for this proposal ---
                const proposalRows = [
                  // 1. The main, always-visible table row
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {protocolName} - {tokenName}
                      </div>
                      <div className="mt-1 sm:hidden text-xs">
                        <span className={statusClass}>{status}</span>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {new Date(p.votingDeadline * 1000).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className={`text-sm font-medium ${statusClass}`}>{status}</div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => toggle(p.id)}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto"
                      >
                        <span className="hidden sm:inline">{isExpanded ? "Hide" : "View"}</span>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>,
                ];

                // 2. If expanded, push the second, detailed row into the array
                if (isExpanded) {
                  proposalRows.push(
                    <tr key={`${p.id}-details`}>
                      <td colSpan={4} className="px-3 sm:px-6 py-6 bg-gray-50 dark:bg-gray-900/50">
                        <div className="max-w-4xl mx-auto">
                          {/* Proposal Header */}
                          <div className="mb-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Proposal Details</h3>
                            <div className="flex flex-wrap gap-4 text-sm">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                <span className="text-gray-600 dark:text-gray-400">
                                  {protocolName} - {tokenName}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                <span className="text-gray-600 dark:text-gray-400">Action: {p.pauseState ? "Pause" : "Unpause"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                <span className="text-gray-600 dark:text-gray-400">
                                  Deadline: {new Date(p.votingDeadline * 1000).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Voting Results */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                            {/* Vote Counts */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                              <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Vote Results</h4>
                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                                    <span className="font-medium text-green-700 dark:text-green-300">For</span>
                                  </div>
                                  <span className="text-lg font-bold text-green-700 dark:text-green-300">{p.forVotes}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                                    <span className="font-medium text-red-600 dark:text-red-300">Against</span>
                                  </div>
                                  <span className="text-lg font-bold text-red-600 dark:text-red-300">{p.againstVotes}</span>
                                </div>
                              </div>
                            </div>

                            {/* Quorum Progress */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                              <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Quorum Progress</h4>
                              <div className="space-y-3">
                                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                                  <span>Progress</span>
                                  <span>{Math.min(((p.forVotes + p.againstVotes) / p.quorumVotes) * 100, 100).toFixed(1)}%</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${Math.min(((p.forVotes + p.againstVotes) / p.quorumVotes) * 100, 100)}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                  <span>
                                    {p.forVotes + p.againstVotes} / {p.quorumVotes} votes
                                  </span>
                                  <span>{(((p.forVotes + p.againstVotes) / p.totalStaked) * 100).toFixed(2)}% of total stake</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Voter Details */}
                          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
                            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                              <h4 className="text-base font-semibold text-gray-900 dark:text-white">Voter Details</h4>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-900/50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Voter Address</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vote</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Weight</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:border-gray-700">
                                  {p.votes
                                    .slice((voterPage[p.id] || 0) * 9, (voterPage[p.id] || 0) * 9 + 9)
                                    .map((v) => (
                                      <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                          <div className="font-mono text-sm text-gray-900 dark:text-gray-300 break-all">
                                            {v.voter.slice(0, 6)}...{v.voter.slice(-4)}
                                          </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                          <span
                                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${v.vote === 1
                                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                                : v.vote === 0
                                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                                  : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                              }`}
                                          >
                                            {v.vote === 1 ? "For" : v.vote === 0 ? "Against" : "Abstain"}
                                          </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{v.weight}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                            {p.votes.length > 9 && (
                              <div className="flex items-center justify-between px-6 py-2 text-sm border-t border-gray-200 dark:border-gray-700">
                                <button
                                  onClick={() => setVoterPage((prev) => ({ ...prev, [p.id]: Math.max(0, (prev[p.id] || 0) - 1) }))}
                                  disabled={(voterPage[p.id] || 0) === 0}
                                  className="px-2 py-1 rounded disabled:opacity-50"
                                >
                                  Prev
                                </button>
                                <span>
                                  {(voterPage[p.id] || 0) + 1} / {Math.ceil(p.votes.length / 9)}
                                </span>
                                <button
                                  onClick={() => setVoterPage((prev) => ({ ...prev, [p.id]: Math.min(Math.ceil(p.votes.length / 9) - 1, (prev[p.id] || 0) + 1) }))}
                                  disabled={(voterPage[p.id] || 0) >= Math.ceil(p.votes.length / 9) - 1}
                                  className="px-2 py-1 rounded disabled:opacity-50"
                                >
                                  Next
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex flex-col sm:flex-row gap-4">
                            {p.executed && (
                              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                                <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                  <div className={`w-3 h-3 rounded-full ${p.passed ? "bg-green-500" : "bg-red-500"}`}></div>
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">Result: {p.passed ? "Passed" : "Failed"}</span>
                                </div>
                                <button onClick={() => handleClaim(p.id)} disabled={isClaiming} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors duration-200 disabled:cursor-not-allowed">
                                  {isClaiming ? "Claiming..." : "Claim Reward"}
                                </button>
                                <button onClick={() => handleWithdrawBond(p.poolId)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors duration-200">
                                  Withdraw Bond
                                </button>
                              </div>
                            )}

                            {!p.executed && p.votingDeadline * 1000 > Date.now() && (
                              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                                <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Voting Active</span>
                                </div>
                                <button onClick={() => handleVoteClick(p.id, 1)} disabled={isSubmitting} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg font-medium transition-colors duration-200 disabled:cursor-not-allowed">
                                  Vote For
                                </button>
                                <button onClick={() => handleVoteClick(p.id, 0)} disabled={isSubmitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium transition-colors duration-200 disabled:cursor-not-allowed">
                                  Vote Against
                                </button>
                                <button onClick={() => handleVoteClick(p.id, 2)} disabled={isSubmitting} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors duration-200 disabled:cursor-not-allowed">
                                  Abstain
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                // 3. Return the array of rows. React will render them sequentially.
                return proposalRows;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <VoteConfirmationModal
        isOpen={showVoteModal}
        onClose={handleVoteCancel}
        onConfirm={handleVoteConfirm}
        proposal={pendingVote?.proposal}
        voteType={pendingVote?.voteType}
        votingPower={votingPower}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}