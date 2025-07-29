"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import MarketsTable from "../components/MarketsTable"
import UnderwriterPanel from "../components/UnderwriterPanel"
import CurrencyToggle from "../components/CurrencyToggle"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useSearchParams } from "next/navigation"


export default function Markets() {
  const { isConnected } = useAccount()
  const searchParams = useSearchParams()
  const [displayCurrency, setDisplayCurrency] = useState("native") // 'native' or 'usd'
  const [activeTab, setActiveTab] = useState("purchase") // 'purchase' or 'underwrite'

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "underwrite") {
      setActiveTab("underwrite")
    }
  }, [searchParams])

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Insurance Markets</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Purchase or provide coverage</p>
        </div>

        <div className="flex items-center gap-4">
          <CurrencyToggle displayCurrency={displayCurrency} setDisplayCurrency={setDisplayCurrency} />
          {!isConnected && <ConnectButton
          // Optional props for customization:
          // accountStatus="address" // options: address, avatar, dot
          // chainStatus="icon" // options: icon, name, none
          // showBalance={false} // options: true, false
          />}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            className={`px-6 py-4 text-sm font-medium ${activeTab === "purchase"
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            onClick={() => setActiveTab("purchase")}
          >
            Purchase Cover
          </button>
          <button
            className={`px-6 py-4 text-sm font-medium ${activeTab === "underwrite"
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            onClick={() => setActiveTab("underwrite")}
          >
            Provide Coverage
          </button>
        </div>

        <div className="p-4 md:p-6">
          {activeTab === "purchase" ? (
            <MarketsTable displayCurrency={displayCurrency} mode="purchase" />
          ) : (
            <UnderwriterPanel displayCurrency={displayCurrency} />
          )}
        </div>
      </div>
    </div>
  )
}
