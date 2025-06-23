
"use client"

import { useState } from "react"
import Link from "next/link"
import { ConnectButton } from "@rainbow-me/rainbowkit"
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
import useBondedAmount from "../../hooks/useBondedAmount"
import { ethers } from "ethers"
import { Vote, Shield, ExternalLink } from "lucide-react"
import { formatCurrency } from "../utils/formatting"

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
  const { amount: bondedAmount } = useBondedAmount(address)
  const [isClaimingRewards, setIsClaimingRewards] = useState(false)

  const hasActiveCoverages = (policies || []).length > 0
  const hasUnderwritingPositions = (details?.allocatedPoolIds || []).length > 0
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
      console.error("Claim failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClaimGovRewards = async () => {
    if (!pastProposals || pastProposals.length === 0) return
    setIsClaimingRewards(true)
    try {
      const ids = pastProposals.map((p) => p.id)
      const res = await fetch("/api/committee/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIds: ids }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to claim")
      }
    } catch (err) {
      console.error("Failed to claim rewards", err)
    } finally {
      setIsClaimingRewards(false)
    }
  }

  // Mock bond data - replace with actual data from hooks
  const userBonds = [
    {
      id: 1,
      poolId: "pool-1",
      protocol: "Aave",
      amount: "1000.00",
      status: "Active",
      depositDate: "2024-01-15",
      maturityDate: "2024-07-15",
      rewards: "45.50",
    },
    {
      id: 2,
      poolId: "pool-2",
      protocol: "Compound",
      amount: "750.00",
      status: "Slashed",
      depositDate: "2024-02-01",
      maturityDate: "2024-08-01",
      rewards: "0.00",
      slashedAmount: "150.00",
    },
    {
      id: 3,
      poolId: "pool-3",
      protocol: "Uniswap",
      amount: "500.00",
      status: "Matured",
      depositDate: "2023-12-01",
      maturityDate: "2024-06-01",
      rewards: "67.25",
    },
  ]

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
                Current APR:{" "}
                <span className="font-medium text-green-600">
                  {(Number(ethers.utils.formatUnits(stats.apr || "0", 18)) * 100).toFixed(2)}%
                </span>
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
                {isSubmitting ? "Claiming..." : "Claim"}
              </button>
            </div>
          )}
        </div>

        {stakingInfo && BigInt(stakingInfo.staked || "0") > 0n && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <Vote className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">My Staked Gov Tokens</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Your governance participation</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href="/staking"
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
                  >
                    Manage
                  </Link>
                  {pastProposals.length > 0 && (
                    <button
                      onClick={handleClaimGovRewards}
                      disabled={isClaimingRewards}
                      className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 shadow-sm hover:shadow-md"
                    >
                      {isClaimingRewards ? "Claiming..." : `Claim Rewards (${pastProposals.length})`}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                  <div>
                    <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Amount Staked</p>
                    <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {Number(ethers.utils.formatUnits(stakingInfo.staked || "0", 18)).toFixed(4)}
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Voting Power</p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {stakingInfo.totalStaked && BigInt(stakingInfo.totalStaked) > 0n
                        ? (
                            Number((BigInt(stakingInfo.staked) * 10000n) / BigInt(stakingInfo.totalStaked)) / 100
                          ).toFixed(2)
                        : "0"}
                      %
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">Claimable Rewards</p>
                    <p className="text-2xl font-bold text-green-900 dark:text-green-100">{pastProposals.length}</p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
                  <div>
                    <p className="text-sm font-medium text-orange-600 dark:text-orange-400">Status</p>
                    <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                      {activeProposals.length > 0 ? "Active" : "Up to Date"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {(activeProposals.length > 0 || pastProposals.length > 0 || userBonds.length > 0) && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">My Bonds</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Your bonded positions</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Link
                    href="/staking"
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
                  >
                    Manage
                  </Link>
                  {pastProposals.length > 0 && (
                    <button
                      onClick={handleClaimGovRewards}
                      disabled={isClaimingRewards}
                      className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 shadow-sm hover:shadow-md"
                    >
                      {isClaimingRewards ? "Claiming..." : `Claim Rewards (${pastProposals.length})`}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Active Bonds</p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {userBonds.filter((b) => b.status === "Active").length}
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                  <div>
                    <p className="text-sm font-medium text-purple-600 dark:text-purple-400">Total Bonded</p>
                    <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {formatCurrency(
                        userBonds.reduce((sum, bond) => sum + Number.parseFloat(bond.amount), 0),
                        "USD",
                        displayCurrency,
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                  <div>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">Total Rewards</p>
                    <p className="text-2xl font-bold text-green-900 dark:text-green-100">
                      {formatCurrency(
                        userBonds.reduce((sum, bond) => sum + Number.parseFloat(bond.rewards), 0),
                        "USD",
                        displayCurrency,
                      )}
                    </p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
                  <div>
                    <p className="text-sm font-medium text-orange-600 dark:text-orange-400">Status</p>
                    <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                      {userBonds.filter((b) => b.status === "Active").length > 0 ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bonds Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-750">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Bond Details
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Rewards
                    </th>
                    <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Maturity
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {userBonds.map((bond) => (
                    <tr key={bond.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-bold text-xs">
                              {bond.protocol.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{bond.protocol}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Pool {bond.poolId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {formatCurrency(Number.parseFloat(bond.amount), "USD", displayCurrency)}
                        </div>
                        {bond.status === "Slashed" && bond.slashedAmount && (
                          <div className="text-xs text-red-500 dark:text-red-400">
                            -{formatCurrency(Number.parseFloat(bond.slashedAmount), "USD", displayCurrency)} slashed
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm font-medium text-green-600 dark:text-green-400">
                          +{formatCurrency(Number.parseFloat(bond.rewards), "USD", displayCurrency)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Earned</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            bond.status === "Active"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                              : bond.status === "Slashed"
                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                          }`}
                        >
                          {bond.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {new Date(bond.maturityDate).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {bond.status === "Active" ? "Matures" : "Matured"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {bond.status === "Active" && Number.parseFloat(bond.rewards) > 0 && (
                            <button className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 rounded-md transition-colors">
                              Claim
                            </button>
                          )}
                          {bond.status === "Matured" && (
                            <button className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors">
                              Withdraw
                            </button>
                          )}
                          <button className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors">
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Claims & Affected Positions moved to bottom */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-semibold mb-4">Claims & Affected Positions</h2>
          <ClaimsSection displayCurrency={displayCurrency} />
        </div>
      </div>
    </div>
  )
}