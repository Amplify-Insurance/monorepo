"use client"
import { useAccount } from "wagmi"
import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { formatCurrency } from "../utils/formatting"
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo"
import useCatPoolRewards from "../../hooks/useCatPoolRewards"
import Image from "next/image"
import { TrendingUp, Gift, ExternalLink, Clock } from "lucide-react"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"
import { getTokenSymbol, getTokenName as getErc20TokenName } from "../../lib/erc20"
import {
  getCatPoolWithSigner,
  getUsdcAddress,
  getUsdcDecimals,
  getCatShareDecimals,
  drawFund,
} from "../../lib/catPool"
import ClaimRewardsModal from "./ClaimRewardsModal"
import RequestWithdrawalModal from "./RequestWithdrawalModal"
import Link from "next/link"
import useMaxWithdrawable from "../../hooks/useMaxWithdrawable"
import useCatPoolWithdrawalRequest from "../../hooks/useCatPoolWithdrawalRequest"

export default function CatPoolDeposits({ displayCurrency, refreshTrigger }) {
  const { address } = useAccount()
  const { info, refresh } = useCatPoolUserInfo(address)
  const { rewards } = useCatPoolRewards(address)
  const { request: withdrawalRequest, refresh: refreshWithdrawal, NOTICE_PERIOD } =
    useCatPoolWithdrawalRequest(address)
  const [valueDecimals, setValueDecimals] = useState(6)
  const [shareDecimals, setShareDecimals] = useState(18)
  const [underlyingToken, setUnderlyingToken] = useState("")
  const [underlyingSymbol, setUnderlyingSymbol] = useState("")
  const [underlyingName, setUnderlyingName] = useState("")
  const [isClaimingRewards, setIsClaimingRewards] = useState(false)
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false)
  const [isRequestingWithdrawal, setIsRequestingWithdrawal] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [pendingWithdrawal, setPendingWithdrawal] = useState(null)
  const { maxWithdrawablePct } = useMaxWithdrawable()

  
  useEffect(() => {
    refresh()
    refreshWithdrawal()

    async function loadTokenInfo() {
      try {
        const addr = await getUsdcAddress()
        setUnderlyingToken(addr)
        const [dec, shareDec, symbol, name] = await Promise.all([
          getUsdcDecimals(),
          getCatShareDecimals(),
          getTokenSymbol(addr),
          getErc20TokenName(addr),
        ])
        setValueDecimals(Number(dec))
        setShareDecimals(Number(shareDec))
        setUnderlyingSymbol(symbol)
        setUnderlyingName(name)
      } catch (err) {
        console.error("Failed to fetch underlying token info", err)
      }
    }
    loadTokenInfo()
  }, [refreshTrigger])

  useEffect(() => {
    async function computeWithdrawal() {
      if (!withdrawalRequest || !info) {
        setPendingWithdrawal(null)
        return
      }
      try {
        const dec = shareDecimals
        const sharesHuman = Number(
          ethers.utils.formatUnits(withdrawalRequest.shares, dec),
        )
        const userShares = Number(
          ethers.utils.formatUnits(info.balance || '0', dec),
        )
        const userValue = Number(
          ethers.utils.formatUnits(info.value || '0', valueDecimals),
        )
        const valuePerShare = userShares > 0 ? userValue / userShares : 0
        setPendingWithdrawal({
          amount: sharesHuman,
          value: sharesHuman * valuePerShare,
          requestedAt: new Date(withdrawalRequest.timestamp * 1000),
          availableAt: new Date(
            (withdrawalRequest.timestamp + NOTICE_PERIOD) * 1000,
          ),
        })
      } catch (err) {
        console.error('Failed to compute withdrawal info', err)
        setPendingWithdrawal(null)
      }
    }
    computeWithdrawal()
  }, [withdrawalRequest, info, NOTICE_PERIOD, valueDecimals, shareDecimals])

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
      const sharesBn = ethers.utils.parseUnits(
        Number(withdrawalData.amount).toFixed(shareDecimals),
        shareDecimals,
      )
      const tx = await cp.requestWithdrawal(sharesBn)
      setTxHash(tx.hash)
      await tx.wait()
      await refresh()
      await refreshWithdrawal()
      setShowWithdrawalModal(false)
    } catch (error) {
      console.error("Failed to request withdrawal:", error)
    } finally {
      setIsRequestingWithdrawal(false)
    }
  }

  const handleExecuteWithdrawal = async () => {
    if (!pendingWithdrawal) return
    try {
      const cp = await getCatPoolWithSigner()
      const sharesBn = ethers.utils.parseUnits(
        Number(pendingWithdrawal.amount).toFixed(shareDecimals),
        shareDecimals,
      )
      const tx = await cp.withdrawLiquidity(sharesBn)
      setTxHash(tx.hash)
      await tx.wait()
      await refresh()
      await refreshWithdrawal()
      setPendingWithdrawal(null)
    } catch (error) {
      console.error('Failed to withdraw:', error)
    }
  }

  const handleDrawFund = async () => {
    if (!pendingWithdrawal) return
    try {
      const dec = await getUsdcDecimals()
      const amountBn = ethers.utils.parseUnits(
        Number(pendingWithdrawal.value).toFixed(dec),
        dec,
      )
      const tx = await drawFund(amountBn)
      setTxHash(tx.hash)
      await refresh()
      await refreshWithdrawal()
      setPendingWithdrawal(null)
    } catch (error) {
      console.error('Failed to draw fund:', error)
    }
  }

  const handleCancelWithdrawal = async () => {
    if (!pendingWithdrawal) return
    try {
      const cp = await getCatPoolWithSigner()
      const tx = await cp.cancelWithdrawalRequest(0)
      setTxHash(tx.hash)
      await tx.wait()
      await refresh()
      await refreshWithdrawal()
      setPendingWithdrawal(null)
    } catch (error) {
      console.error('Failed to cancel withdrawal:', error)
    }
  }

  if (!info || info.balance === "0") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Backstop Pool Deposits</h3>
          <p className="text-gray-500 dark:text-gray-400">Start earning by depositing into the Backstop Pool</p>
        </div>
      </div>
    )
  }

  const shares = Number(ethers.utils.formatUnits(info.balance || "0", shareDecimals))
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

  const maxWithdrawableAmount = shares * maxWithdrawablePct
  const maxWithdrawableValue = value * maxWithdrawablePct

  const remainingShares = pendingWithdrawal
    ? Math.max(shares - pendingWithdrawal.amount, 0)
    : shares
  const remainingValue = pendingWithdrawal
    ? Math.max(value - pendingWithdrawal.value, 0)
    : value
  const withdrawalReady =
    pendingWithdrawal && pendingWithdrawal.availableAt <= new Date()

  const rewardsData = rewards.map((r) => ({
    symbol: getTokenName(r.token),
    token: r.token,
    amount: Number(ethers.utils.formatUnits(r.amount, 18)).toFixed(4),
    value: Number(ethers.utils.formatUnits(r.amount, 18)),
    type: "Backstop Pool Rewards",
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Backstop Pool Deposits</h3>
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
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
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
                  Requested
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
              {pendingWithdrawal && pendingWithdrawal.amount < shares && (
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
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{underlyingSymbol}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{underlyingName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{remainingShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">LP Tokens</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(remainingValue, "USD", displayCurrency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Current Value</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">-</td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    +{formatCurrency(pendingRewardsValue, "USD", displayCurrency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Claimable</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                    Active
                  </div>
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
              )}

              {pendingWithdrawal && (
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
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{underlyingSymbol}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{underlyingName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{pendingWithdrawal.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">LP Tokens</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(pendingWithdrawal.value, "USD", displayCurrency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Requested Value</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  {pendingWithdrawal.requestedAt.toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                    {withdrawalReady ? (
                      <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                        <Clock className="w-3 h-3 mr-1" />
                        Withdrawal Ready
                      </div>
                    ) : (
                      <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                        <Clock className="w-3 h-3 mr-1" />
                        Withdrawal Pending
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end space-x-2">
                      {withdrawalReady ? (
                        <>
                          <button
                            onClick={handleExecuteWithdrawal}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-md transition-colors"
                          >
                            Withdraw
                          </button>
                          <button
                            onClick={handleDrawFund}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-md transition-colors"
                          >
                            Draw Fund
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleCancelWithdrawal}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                        >
                          Cancel Withdrawal
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {!pendingWithdrawal && (
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
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{underlyingSymbol}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{underlyingName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">LP Tokens</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(value, "USD", displayCurrency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Current Value</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">-</td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    +{formatCurrency(pendingRewardsValue, "USD", displayCurrency)}
                  </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Claimable</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                      Active
                    </div>
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
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClaimRewardsModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        title="Claim Backstop Pool Rewards"
        description="Claim your pending rewards from the Backstop Pool liquidity provision."
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
        tokenDecimals={shareDecimals}
      />
    </>
  )
}
