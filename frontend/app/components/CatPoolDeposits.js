"use client"
import { useAccount } from "wagmi"
import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { formatCurrency } from "../utils/formatting"
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo"
import useCatPoolRewards from "../../hooks/useCatPoolRewards"
import Image from "next/image"
import { TrendingUp, Gift, ExternalLink, Clock, X } from "lucide-react"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"
import {
  getCatPoolWithSigner,
  getUsdcAddress,
  getUsdcDecimals,
  getCatShareDecimals,
} from "../../lib/catPool"
import ClaimRewardsModal from "./ClaimRewardsModal"
import RequestWithdrawalModal from "./RequestWithdrawalModal"
import Link from "next/link"
import useMaxWithdrawable from "../../hooks/useMaxWithdrawable"

export default function CatPoolDeposits({ displayCurrency, refreshTrigger }) {
  const { address } = useAccount()
  const { info, refresh } = useCatPoolUserInfo(address)
  const { rewards } = useCatPoolRewards(address)
  const [valueDecimals, setValueDecimals] = useState(6)
  const [underlyingToken, setUnderlyingToken] = useState("")
  const [isClaimingRewards, setIsClaimingRewards] = useState(false)
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [pendingWithdrawal, setPendingWithdrawal] = useState(null)

  useEffect(() => {
    refresh()

    async function loadTokenInfo() {
      try {
        const addr = await getUsdcAddress()
        setUnderlyingToken(addr)
        const dec = await getUsdcDecimals()
        setValueDecimals(Number(dec))
      } catch (err) {
        console.error("Failed to fetch underlying token info", err)
      }
    }
    loadTokenInfo()


    // Simulate pending withdrawal - replace with actual contract call
    // setPendingWithdrawal({
    //   amount: 500.0,
    //   value: 500.0,
    //   requestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    //   availableAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days from now
    // })
  }, [refreshTrigger])

  const handleClaimRewards = async () => {
    if (!rewards || rewards.length === 0) return
    setIsClaimingRewards(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tokens = rewards.map((r) => r.token)
      const tx = await cp.claimProtocolAssetRewards(tokens)
      setTxHash(tx.hash)
      await tx.wait()
      setShowClaimModal(false)
    } catch (error) {
      console.error("Failed to claim rewards:", error)
    } finally {
      setIsClaimingRewards(false)
    }
  }

  const handleRequestWithdrawal = async (withdrawalData) => {
    setIsRequestingWithdrawal(true)
    try {
      const cp = await getCatPoolWithSigner()
      const dec = await getCatShareDecimals()
      const sharesBn = ethers.utils.parseUnits(
        withdrawalData.amount.toString(),
        dec,
      )
      const tx = await cp.requestWithdrawal(sharesBn)
      setTxHash(tx.hash)
      await tx.wait()

      setPendingWithdrawal({
        amount: withdrawalData.amount,
        value: withdrawalData.value,
        requestedAt: new Date(),
        availableAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })

      setShowWithdrawalModal(false)
    } catch (error) {
      console.error("Failed to request withdrawal:", error)
    } finally {
      setIsRequestingWithdrawal(false)
    }
  }

  const handleCancelWithdrawal = async () => {
    try {
      // TODO: Implement actual withdrawal cancellation logic
      console.log("Cancelling withdrawal...")
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Simulate transaction
      setPendingWithdrawal(null)
    } catch (error) {
      console.error("Failed to cancel withdrawal:", error)
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
  const pendingRewardsValue = rewards.reduce(
    (sum, r) => sum + Number(ethers.utils.formatUnits(r.amount, 18)),
    0,
  )

  const { maxWithdrawablePct } = useMaxWithdrawable()
  const maxWithdrawableAmount = shares * maxWithdrawablePct
  const maxWithdrawableValue = value * maxWithdrawablePct

  const rewardsData = rewards.map((r) => ({
    symbol: getTokenName(r.token),
    token: r.token,
    amount: Number(ethers.utils.formatUnits(r.amount, 18)).toFixed(4),
    value: Number(ethers.utils.formatUnits(r.amount, 18)),
    type: "Cat Pool Rewards",
  }))

  const daysUntilAvailable = pendingWithdrawal
    ? Math.ceil((pendingWithdrawal.availableAt - new Date()) / (1000 * 60 * 60 * 24))
    : 0

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cat Pool Deposits</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Your liquidity positions</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {pendingRewardsValue > 0 && (
                <button
                  onClick={() => setShowClaimModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  <Gift className="w-4 h-4" />
                  <span>Claim Rewards</span>
                </button>
              )}
              <button
                onClick={() => setShowWithdrawalModal(true)}
                disabled={!!pendingWithdrawal}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>Request Withdrawal</span>
              </button>
            </div>
          </div>
        </div>

        {/* Pending Withdrawal Notice */}
        {pendingWithdrawal && (
          <div className="px-6 py-4 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Withdrawal Request Pending</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {formatCurrency(pendingWithdrawal.value, "USD", displayCurrency)} available in {daysUntilAvailable}{" "}
                    days ({pendingWithdrawal.availableAt.toLocaleDateString()})
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelWithdrawal}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-md transition-colors"
              >
                <X className="w-3 h-3" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Total Value</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {formatCurrency(value, "USD", displayCurrency)}
                </p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">LP Tokens</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{shares.toFixed(4)}</p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Pending Rewards</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {formatCurrency(pendingRewardsValue, "USD", displayCurrency)}
                </p>
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
                  Status
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
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                      {underlyingToken && (
                        <Image
                          src={getTokenLogo(underlyingToken) || "/placeholder.svg"}
                          alt={getTokenName(underlyingToken)}
                          width={40}
                          height={40}
                          className="rounded-full"
                        />
                      )}
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
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    +{formatCurrency(pendingRewardsValue, "USD", displayCurrency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Claimable</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  {pendingWithdrawal ? (
                    <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                      <Clock className="w-3 h-3 mr-1" />
                      Withdrawal Pending
                    </div>
                  ) : (
                    <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                      Active
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end space-x-2">
                    {pendingRewardsValue > 0 && (
                      <button
                        onClick={() => setShowClaimModal(true)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                      >
                        Claim
                      </button>
                    )}
                    <Link
                      href="/catpool"
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Details
                    </Link>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ClaimRewardsModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        title="Claim Cat Pool Rewards"
        description="Claim your pending rewards from the Cat Pool liquidity provision."
        rewards={rewardsData}
        onClaim={handleClaimRewards}
        isSubmitting={isClaimingRewards}
        txHash={txHash}
      />

      <RequestWithdrawalModal
        isOpen={showWithdrawalModal}
        onClose={() => setShowWithdrawalModal(false)}
        onRequestWithdrawal={handleRequestWithdrawal}
        isSubmitting={isRequestingWithdrawal}
        userBalance={shares}
        userValue={value}
        maxWithdrawal={maxWithdrawableAmount}
        displayCurrency={displayCurrency}
      />
    </>
  )
}
