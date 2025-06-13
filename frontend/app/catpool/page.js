"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { ethers } from "ethers"
import CatPoolModal from "../components/CatPoolModal"
import CatPoolDeposits from "../components/CatPoolDeposits"
import CurrencyToggle from "../components/CurrencyToggle"
import useCatPoolStats from "../../hooks/useCatPoolStats"
import useYieldAdapters from "../../hooks/useYieldAdapters"
import { getCatPoolWithSigner } from "../../lib/catPool"
import { formatCurrency, formatPercentage } from "../utils/formatting"

export default function CatPoolPage() {
  const { isConnected } = useAccount()
  const [displayCurrency, setDisplayCurrency] = useState("native")
  const [claimTokens, setClaimTokens] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const adapters = useYieldAdapters()
  const [selectedAdapter, setSelectedAdapter] = useState(null)

  useEffect(() => {
    if (!selectedAdapter && adapters && adapters.length > 0) {
      setSelectedAdapter(adapters[0])
    }
  }, [adapters, selectedAdapter])

  const { stats } = useCatPoolStats()

  const handleClaim = async () => {
    if (!claimTokens) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tokens = claimTokens.split(',').map((t) => t.trim()).filter(Boolean)
      const tx = await cp.claimProtocolAssetRewards(tokens)
      await tx.wait()
      setClaimTokens("")
    } catch (err) {
      console.error("Claim failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to manage the Cat Pool</h1>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Cat Insurance Pool</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Deposit USDC and earn underwriting yield</p>
        </div>
        <CurrencyToggle displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="text-sm text-gray-500 mb-1">Pool Liquidity</div>
          <div className="text-2xl font-bold">
            {formatCurrency(
              Number(ethers.utils.formatUnits(stats.liquidUsdc || '0', 6)),
              'USD',
              displayCurrency,
            )}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="text-sm text-gray-500 mb-1">Current APR</div>
          <div className="text-2xl font-bold text-green-600">
            {selectedAdapter
              ? formatPercentage(selectedAdapter.apr)
              : formatPercentage(
                  Number(ethers.utils.formatUnits(stats.apr || '0', 18)) * 100,
                )}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm text-gray-500 mb-1">My Deposits</h3>
          <CatPoolDeposits displayCurrency={displayCurrency} refreshTrigger={refreshKey} />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4 mb-6">
        {adapters.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Asset
            </label>
            <select
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedAdapter?.id ?? ''}
              onChange={(e) => {
                const found = adapters.find((a) => a.id === Number(e.target.value))
                setSelectedAdapter(found)
              }}
            >
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.assetSymbol || a.asset} - {a.apr.toFixed(2)}% APR
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setDepositOpen(true)}
            className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
          >
            Deposit
          </button>
          <button
            onClick={() => setWithdrawOpen(true)}
            className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-md"
          >
            Withdraw
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-xl font-semibold">Claim Protocol Asset Rewards</h2>
        <input
          type="text"
          placeholder="Token addresses (comma separated)"
          value={claimTokens}
          onChange={(e) => setClaimTokens(e.target.value)}
          className="w-full p-2 border rounded mb-3 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
        />
        <button
          onClick={handleClaim}
          disabled={isSubmitting || !claimTokens}
          className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
        >
          Claim
        </button>
      </div>
      <CatPoolModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        mode="deposit"
        token={selectedAdapter?.asset}
        apr={selectedAdapter?.apr ?? 0}
        assetSymbol={selectedAdapter?.assetSymbol || 'USDC'}
        onActionComplete={() => setRefreshKey((k) => k + 1)}
      />
      <CatPoolModal
        isOpen={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        mode="withdraw"
        onActionComplete={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}
