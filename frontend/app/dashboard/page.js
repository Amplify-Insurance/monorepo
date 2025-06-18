"use client"

import { useState } from "react"
import Link from "next/link"
import { ConnectButton } from '@rainbow-me/rainbowkit'
import CurrencyToggle from "../components/CurrencyToggle"
import ActiveCoverages from "../components/ActiveCoverages"
import UnderwritingPositions from "../components/UnderwritingPositions"
import { useAccount } from "wagmi"
import ClaimsSection from "../components/ClaimsSection"
import CatPoolDeposits from "../components/CatPoolDeposits"
import useUserPolicies from "../../hooks/useUserPolicies"
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails"
import { getCatPoolWithSigner } from "../../lib/catPool"
import useCatPoolRewards from "../../hooks/useCatPoolRewards"
import useCatPoolStats from "../../hooks/useCatPoolStats"
import useStakingInfo from "../../hooks/useStakingInfo"
import usePastProposals from "../../hooks/usePastProposals"
import useActiveProposals from "../../hooks/useActiveProposals"
import { getCommitteeWithSigner } from "../../lib/committee"
import { ethers } from "ethers"

export default function Dashboard() {
  const { address, isConnected } = useAccount()
  const [displayCurrency, setDisplayCurrency] = useState("native")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { policies } = useUserPolicies(address)
  const { details } = useUnderwriterDetails(address)
  const { rewards } = useCatPoolRewards(address)
  const { stats } = useCatPoolStats()
  const { info: stakingInfo } = useStakingInfo(address)
  const { proposals: pastProposals } = usePastProposals()
  const { proposals: activeProposals } = useActiveProposals()
  const [isClaimingRewards, setIsClaimingRewards] = useState(false)

  const hasActiveCoverages = (policies || []).length > 0
  const hasUnderwritingPositions =
    (details?.allocatedPoolIds || []).length > 0
  const showPositionsFirst = hasUnderwritingPositions && !hasActiveCoverages

  const handleClaim = async () => {
    if (!rewards || rewards.length === 0) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tokens = rewards.map((r) => r.token)
      const tx = await cp.claimProtocolAssetRewards(tokens)
      await tx.wait()
    } catch (err) {
      console.error('Claim failed', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClaimGovRewards = async () => {
    if (!pastProposals || pastProposals.length === 0) return
    setIsClaimingRewards(true)
    try {
      const committee = await getCommitteeWithSigner()
      for (const p of pastProposals) {
        try {
          const tx = await committee.claimReward(p.id)
          await tx.wait()
        } catch (err) {
          console.error(`Failed to claim reward for proposal ${p.id}`, err)
        }
      }
    } catch (err) {
      console.error('Failed to claim rewards', err)
    } finally {
      setIsClaimingRewards(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to view your dashboard</h1>
        <ConnectButton />
      </div>
    )
  }

  const activeCoveragesSection = (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-semibold mb-4">My Active Coverages</h2>
      <ActiveCoverages displayCurrency={displayCurrency} />
    </div>
  )

  const underwritingPositionsSection = (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-semibold mb-4">My Underwriting Positions</h2>
      <UnderwritingPositions displayCurrency={displayCurrency} />
    </div>
  )

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Manage your insurance positions</p>
        </div>

        <CurrencyToggle displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {showPositionsFirst ? underwritingPositionsSection : activeCoveragesSection}
        {showPositionsFirst ? activeCoveragesSection : underwritingPositionsSection}

        {/* Add Claims Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-semibold mb-4">Claims & Affected Positions</h2>
          <ClaimsSection displayCurrency={displayCurrency} />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">My Cat Pool Deposits</h2>
            <Link
              href="/catpool"
              className="py-1 px-3 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-md transition-colors"
            >
              Manage
            </Link>
          </div>
          <CatPoolDeposits displayCurrency={displayCurrency} />
        {rewards.length > 0 && (
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-lg font-medium">Claim Protocol Asset Rewards</h3>
              <div className="text-sm text-gray-500">
                Current APR: <span className="font-medium text-green-600">{(
                  Number(ethers.utils.formatUnits(stats.apr || '0', 18)) * 100
                ).toFixed(2)}%</span>
              </div>
              <ul className="text-sm space-y-1">
                {rewards.map((r) => (
                  <li key={r.token} className="flex justify-between">
                    <span>{r.token}</span>
                    <span>{(Number(r.amount) / 1e18).toFixed(4)}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={handleClaim}
                disabled={isSubmitting}
                className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
              >
                {isSubmitting ? 'Claiming...' : 'Claim'}
              </button>
            </div>
          )}
        </div>

        {stakingInfo && BigInt(stakingInfo.staked || '0') > 0n && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
            <h2 className="text-xl font-semibold mb-2">My Staked Gov Tokens</h2>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="inline-block min-w-full align-middle">
                <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm mb-4">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount Staked</th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Voting Power</th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Manage</th>
                        <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rewards</th>
                        <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Claim Rewards</th>
                        {activeProposals.length > 0 && (
                          <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      <tr>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          {Number(ethers.utils.formatUnits(stakingInfo.staked || '0', 18)).toFixed(4)}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          {stakingInfo.totalStaked && BigInt(stakingInfo.totalStaked) > 0n
                            ? (
                                Number(
                                  (BigInt(stakingInfo.staked) * 10000n) /
                                    BigInt(stakingInfo.totalStaked)
                                ) / 100
                              ).toFixed(2)
                            : '0'}%
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <Link
                            href="/staking"
                            className="py-1 px-3 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-md transition-colors"
                          >
                            Manage
                          </Link>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right">
                          {pastProposals.length}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={handleClaimGovRewards}
                            disabled={isClaimingRewards}
                            className="py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
                          >
                            {isClaimingRewards ? 'Claiming...' : 'Claim'}
                          </button>
                        </td>
                        {activeProposals.length > 0 && (
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap">Open Proposals</td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
