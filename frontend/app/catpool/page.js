"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { ethers } from "ethers"
import { HelpCircle } from "lucide-react"
import CatPoolModal from "../components/CatPoolModal"
import CatPoolDeposits from "../components/CatPoolDeposits"
import CurrencyToggle from "../components/CurrencyToggle"
import useCatPoolStats from "../../hooks/useCatPoolStats"
import useYieldAdapters from "../../hooks/useYieldAdapters"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet"
import { formatCurrency, formatPercentage } from "../utils/formatting"

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
          <div className="flex items-center">
            <h1 className="text-3xl font-bold">Cat Insurance Pool</h1>
            <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
              <SheetTrigger className="ml-2 text-gray-500 hover:text-gray-700">
                <HelpCircle className="w-4 h-4" />
              </SheetTrigger>
              <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                <SheetHeader>
                  <SheetTitle>Catastrophe Insurance</SheetTitle>
                </SheetHeader>
                <div className="mt-4 text-sm">
                  Catastrophe insurance acts as a reserve for extreme losses. Depositors provide USDC to earn a share of underwriting premiums. If a severe event wipes out a pool, these funds reimburse affected policyholders.
                </div>
              </SheetContent>
            </Sheet>
          </div>
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
