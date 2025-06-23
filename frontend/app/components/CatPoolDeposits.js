"use client"
import { useAccount } from "wagmi"
import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { formatCurrency } from "../utils/formatting"
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo"
import { TrendingUp, Gift, ExternalLink } from "lucide-react"
import Image from "next/image"
import { getTokenLogo } from "../config/tokenNameMap"

export default function CatPoolDeposits({ displayCurrency, refreshTrigger }) {
  const { address } = useAccount()
  const { info, refresh } = useCatPoolUserInfo(address)
  const [pendingRewards, setPendingRewards] = useState("0")
  const [isClaimingRewards, setIsClaimingRewards] = useState(false)

  useEffect(() => {
    refresh()
    // Simulate fetching pending rewards - replace with actual contract call
    setPendingRewards("12.45")
  }, [refreshTrigger])

  const handleClaimRewards = async () => {
    setIsClaimingRewards(true)
    try {
      // TODO: Implement actual reward claiming logic
      console.log("Claiming rewards...")
      await new Promise((resolve) => setTimeout(resolve, 2000)) // Simulate transaction
      setPendingRewards("0")
    } catch (error) {
      console.error("Failed to claim rewards:", error)
    } finally {
      setIsClaimingRewards(false)
    }
  }

  if (!info || info.balance === "0") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Cat Pool Deposits</h3>
          <p className="text-gray-500 dark:text-gray-400">Start earning by depositing into the Cat Pool</p>
        </div>
      </div>
    )
  }

  const shares = Number(ethers.utils.formatUnits(info.balance || "0", 18))
  let value
  try {
    value = Number(ethers.utils.formatUnits(info.value || "0", valueDecimals))
  } catch {
    value = Number(info.value || 0)
  }
  const rewards = Number(pendingRewards)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cat Pool Deposits</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Your liquidity positions</p>
            </div>
          </div>
          {rewards > 0 && (
            <button
              onClick={handleClaimRewards}
              disabled={isClaimingRewards}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            >
              {isClaimingRewards ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Claiming...</span>
                </>
              ) : (
                <>
                  <Gift className="w-4 h-4" />
                  <span>Claim Rewards</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Value</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {formatCurrency(value, "USD", displayCurrency)}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-purple-600 dark:text-purple-400">LP Tokens</p>
                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">{shares.toFixed(4)}</p>
              </div>
              <div className="w-12 h-12 bg-purple-500 rounded-lg flex items-center justify-center">
                <Image
                  src={getTokenLogo("CATLP") || "/placeholder.svg"}
                  alt="CATLP"
                  width={24}
                  height={24}
                  className="rounded-full"
                />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-600 dark:text-green-400">Pending Rewards</p>
                <p className="text-2xl font-bold text-green-900 dark:text-green-100">
                  {formatCurrency(rewards, "USD", displayCurrency)}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-500 rounded-lg flex items-center justify-center">
                <Gift className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-750">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Asset
              </th>
              <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Balance
              </th>
              <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Value
              </th>
              <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Rewards
              </th>
              <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            <tr className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">CAT</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">CATLP</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Cat Pool LP Token</p>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <div className="text-sm font-medium text-gray-900 dark:text-white">{shares.toFixed(4)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">LP Tokens</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatCurrency(value, "USD", displayCurrency)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Current Value</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <div className="text-sm font-medium text-green-600 dark:text-green-400">
                  +{formatCurrency(rewards, "USD", displayCurrency)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Claimable</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <div className="flex items-center justify-end space-x-2">
                  {rewards > 0 && (
                    <button
                      onClick={handleClaimRewards}
                      disabled={isClaimingRewards}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 rounded-md transition-colors disabled:opacity-50"
                    >
                      {isClaimingRewards ? "Claiming..." : "Claim"}
                    </button>
                  )}
                  <button className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors">
                    <ExternalLink className="w-3 h-3 mr-1" />
                    Details
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
