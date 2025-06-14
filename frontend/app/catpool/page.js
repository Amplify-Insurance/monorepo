"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { ethers } from "ethers"
import { HelpCircle, TrendingUp, DollarSign, Wallet, ChevronDown } from "lucide-react"
import Image from "next/image"
import CatPoolModal from "../components/CatPoolModal"
import CatPoolDeposits from "../components/CatPoolDeposits"
import CurrencyToggle from "../components/CurrencyToggle"
import useCatPoolStats from "../../hooks/useCatPoolStats"
import useYieldAdapters from "../../hooks/useYieldAdapters"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import { getTokenLogo } from "../config/tokenNameMap"

export default function CatPoolPage() {
  const { isConnected } = useAccount()
  const [displayCurrency, setDisplayCurrency] = useState("native")
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [infoOpen, setInfoOpen] = useState(false)

  const adapters = useYieldAdapters()
  const [selectedAdapter, setSelectedAdapter] = useState(null)

  useEffect(() => {
    if (!selectedAdapter && adapters && adapters.length > 0) {
      setSelectedAdapter(adapters[0])
    }
  }, [adapters, selectedAdapter])

  const { stats } = useCatPoolStats()

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md w-full">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <Wallet className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">Connect Your Wallet</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Connect your wallet to manage the Cat Insurance Pool and start earning yield
            </p>
            <ConnectButton />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Cat Insurance Pool</h1>
                  <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
                    <SheetTrigger className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
                      <HelpCircle className="w-5 h-5" />
                    </SheetTrigger>
                    <SheetContent side="right" className="w-1/3 sm:max-w-none">
                      <SheetHeader>
                        <SheetTitle>Catastrophe Insurance</SheetTitle>
                      </SheetHeader>
                      <div className="mt-4 text-sm space-y-3">
                        <p>
                          Catastrophe insurance acts as a reserve for extreme losses. Depositors provide USDC to earn a
                          share of underwriting premiums.
                        </p>
                        <p>
                          If a severe event wipes out a pool, these funds reimburse affected policyholders, ensuring the
                          protocol remains solvent.
                        </p>
                      </div>
                    </SheetContent>
                  </Sheet>
                </div>
                <p className="text-gray-600 dark:text-gray-300">Deposit USDC and earn underwriting yield</p>
              </div>
            </div>
          </div>
          <CurrencyToggle displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Pool Liquidity</div>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(Number(ethers.utils.formatUnits(stats.liquidUsdc || "0", 6)), "USD", displayCurrency)}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Available for coverage</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Current APR</div>
              <TrendingUp className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400">
              {selectedAdapter
                ? formatPercentage(selectedAdapter.apr)
                : formatPercentage(Number(ethers.utils.formatUnits(stats.apr || "0", 18)) * 100)}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Annual percentage rate</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">My Deposits</div>
              <Wallet className="w-5 h-5 text-purple-500" />
            </div>
            <CatPoolDeposits displayCurrency={displayCurrency} refreshTrigger={refreshKey} />
          </div>
        </div>

        {/* Main Action Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 space-y-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Manage Position</h2>

          {/* Asset Selection */}
          {adapters.length > 0 && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select Asset</label>
              <div className="relative">
                <div className="flex items-center space-x-3 p-4 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 cursor-pointer">
                  <Image
                    src={getTokenLogo(selectedAdapter?.asset) || "/placeholder.svg"}
                    alt={selectedAdapter?.assetSymbol || "Asset"}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                  <select
                    className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 focus:outline-none cursor-pointer appearance-none"
                    value={selectedAdapter?.id ?? ""}
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
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setDepositOpen(true)}
              className="flex items-center justify-center space-x-2 py-4 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <DollarSign className="w-5 h-5" />
              <span>Deposit</span>
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              className="flex items-center justify-center space-x-2 py-4 px-6 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Wallet className="w-5 h-5" />
              <span>Withdraw</span>
            </button>
          </div>
        </div>

        {/* Modals */}
        <CatPoolModal
          isOpen={depositOpen}
          onClose={() => setDepositOpen(false)}
          mode="deposit"
          token={selectedAdapter?.asset}
          apr={selectedAdapter?.apr ?? 0}
          assetSymbol={selectedAdapter?.assetSymbol || "USDC"}
          onActionComplete={() => setRefreshKey((k) => k + 1)}
        />
        <CatPoolModal
          isOpen={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          mode="withdraw"
          onActionComplete={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </div>
  )
}
