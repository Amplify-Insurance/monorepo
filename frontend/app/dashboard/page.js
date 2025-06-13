"use client"

import { useState } from "react"
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
import { ethers } from "ethers"

export default function Dashboard() {
  const { address, isConnected } = useAccount()
  const [displayCurrency, setDisplayCurrency] = useState("native")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { policies } = useUserPolicies(address)
  const { details } = useUnderwriterDetails(address)
  const { rewards } = useCatPoolRewards(address)
  const { stats } = useCatPoolStats()

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
          <h2 className="text-xl font-semibold mb-4">My Cat Pool Deposits</h2>
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
      </div>
    </div>
  )
}
