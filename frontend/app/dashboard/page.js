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

export default function Dashboard() {
  const { address, isConnected } = useAccount()
  const [displayCurrency, setDisplayCurrency] = useState("native")
  const [claimTokens, setClaimTokens] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { policies } = useUserPolicies(address)
  const { details } = useUnderwriterDetails(address)

  const hasActiveCoverages = (policies || []).length > 0
  const hasUnderwritingPositions =
    (details?.allocatedPoolIds || []).length > 0
  const showPositionsFirst = hasUnderwritingPositions && !hasActiveCoverages

  const handleClaim = async () => {
    if (!claimTokens) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tokens = claimTokens.split(',').map((t) => t.trim()).filter(Boolean)
      const tx = await cp.claimProtocolAssetRewards(tokens)
      await tx.wait()
      setClaimTokens('')
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
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-lg font-medium">Claim Protocol Asset Rewards</h3>
            <input
              type="text"
              placeholder="Token addresses (comma separated)"
              value={claimTokens}
              onChange={(e) => setClaimTokens(e.target.value)}
              className="w-full p-2 border rounded text-gray-900 dark:text-gray-100 dark:bg-gray-700"
            />
            <button
              onClick={handleClaim}
              disabled={isSubmitting || !claimTokens}
              className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
            >
              {isSubmitting ? 'Claiming...' : 'Claim'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
