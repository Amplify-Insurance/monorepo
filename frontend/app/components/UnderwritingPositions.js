"use client"
import { useState, useEffect, Fragment } from "react"
import { TrendingUp, ChevronDown, ChevronUp } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import ManageCoverageModal from "./ManageCoverageModal"
import ManageAllocationModal from "./ManageAllocationModal"
import { useAccount } from "wagmi"
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails"
import usePools from "../../hooks/usePools"
import useYieldAdapters from "../../hooks/useYieldAdapters"
import { ethers } from "ethers"
import { getRiskManagerWithSigner } from "../../lib/riskManager"
import { getCapitalPoolWithSigner } from "../../lib/capitalPool"
import { getTokenName, getTokenLogo, getProtocolLogo, getProtocolName, getProtocolType } from "../config/tokenNameMap"
import { getDeployment } from "../config/deployments"

export default function UnderwritingPositions({ displayCurrency }) {
  const NOTICE_PERIOD = 600 // seconds
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedPosition, setSelectedPosition] = useState(null)
  const [isClaiming, setIsClaiming] = useState(false)
  const [isClaimingAll, setIsClaimingAll] = useState(false)
  const [isClaimingDistressed, setIsClaimingDistressed] = useState(false)
  const [isClaimingAllDistressed, setIsClaimingAllDistressed] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [expandedRows, setExpandedRows] = useState([])
  const toggleRow = (id) => {
    setExpandedRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const [showAllocModal, setShowAllocModal] = useState(false)
  const [rewardsMap, setRewardsMap] = useState({})
  const { address } = useAccount()
  const { details } = useUnderwriterDetails(address)
  const { pools } = usePools()
  const defaultDeployment = details?.[0]?.deployment
  const adapters = useYieldAdapters(defaultDeployment)

  const underwritingPositions = (details || [])
    .flatMap((d) =>
      d.allocatedPoolIds.map((pid) => {
        const pool = pools.find((pl) => pl.deployment === d.deployment && Number(pl.id) === Number(pid))
        if (!pool) return null
        const protocol = getTokenName(pool.id)
        const amount = Number(
          ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, pool.underlyingAssetDecimals ?? 6),
        )
        const pendingLossStr = d.pendingLosses?.[pid] ?? "0"
        const pendingLoss = Number(ethers.utils.formatUnits(pendingLossStr, pool.underlyingAssetDecimals ?? 6))
        return {
          id: `${d.deployment}-${pid}`,
          deployment: d.deployment,
          protocol,
          type: getProtocolType(pool.id),
          pool: pool.protocolTokenToCover,
          poolName: getTokenName(pool.id),
          poolId: pid,
          amount,
          nativeValue: amount,
          usdValue: amount * (pool.tokenPriceUsd ?? 1),
          pendingLoss,
          pendingLossUsd: pendingLoss * (pool.tokenPriceUsd ?? 1),
          yield: Number(pool.underwriterYieldBps || 0) / 100,
          status: Number(ethers.utils.formatUnits(d.withdrawalRequestShares)) > 0 ? "requested withdrawal" : "active",
          shares: d.masterShares,
          yieldChoice: d.yieldChoice,
        }
      }),
    )
    .filter(Boolean)

  useEffect(() => {
    async function loadRewards() {
      if (!address) return
      const map = {}
      for (const pos of underwritingPositions) {
        try {
          const res = await fetch(`/api/underwriters/${address}/rewards/${pos.poolId}?deployment=${pos.deployment}`)
          if (res.ok) {
            const data = await res.json()
            const item = (data.rewards || []).find((r) => r.deployment === pos.deployment)
            map[pos.id] = item ? item.pending : "0"
          }
        } catch (err) {
          console.error("Failed to load pending rewards", err)
        }
      }
      setRewardsMap(map)
    }
    loadRewards()
  }, [address, underwritingPositions])

  const protocolPositions = underwritingPositions.filter((p) => p.type === "protocol")
  const stablecoinPositions = underwritingPositions.filter((p) => p.type === "stablecoin")

  const activePositions = underwritingPositions.filter((p) => p.status === "active")
  const withdrawalPositions = underwritingPositions.filter((p) => p.status === "requested withdrawal")

  const showPendingLoss = underwritingPositions.some((p) => p.pendingLoss > 0)

  const hasDistressedAssets = underwritingPositions.some((p) => p.pendingLoss > 0)

  console.log(activePositions, "activePositions")

  const unlockTimestamp =
    Number(ethers.utils.formatUnits(details?.[0]?.withdrawalRequestTimestamp || 0)) + NOTICE_PERIOD
  const currentTimestamp = Math.floor(Date.now() / 1000)
  const unlockDays = Math.max(0, Math.ceil((unlockTimestamp - currentTimestamp) / 86400))
  const withdrawalReady = currentTimestamp >= unlockTimestamp

  const handleOpenModal = (position) => {
    setSelectedPosition(position)
    setModalOpen(true)
  }

  const handleClaimRewards = async (position) => {
    setIsClaiming(true)
    try {
      const dep = getDeployment(position.deployment)
      const rm = await getRiskManagerWithSigner(dep.riskManager)
      if (typeof rm.claimPremiumRewards === "function") {
        await (await rm.claimPremiumRewards(position.poolId)).wait()
      }
      if (typeof rm.claimDistressedAssets === "function") {
        await (await rm.claimDistressedAssets(position.poolId)).wait()
      }
    } catch (err) {
      console.error("Failed to claim rewards", err)
    } finally {
      setIsClaiming(false)
    }
  }

  const handleClaimAllRewards = async () => {
    if (underwritingPositions.length === 0) return
    setIsClaimingAll(true)
    try {
      const grouped = underwritingPositions.reduce((acc, p) => {
        ;(acc[p.deployment] = acc[p.deployment] || []).push(p.poolId)
        return acc
      }, {})
      for (const [depName, ids] of Object.entries(grouped)) {
        const dep = getDeployment(depName)
        const rm = await getRiskManagerWithSigner(dep.riskManager)
        for (const id of ids) {
          if (typeof rm.claimPremiumRewards === "function") {
            await (await rm.claimPremiumRewards(id)).wait()
          }
          if (typeof rm.claimDistressedAssets === "function") {
            await (await rm.claimDistressedAssets(id)).wait()
          }
        }
      }
    } catch (err) {
      console.error("Failed to claim all rewards", err)
    } finally {
      setIsClaimingAll(false)
    }
  }

  const handleClaimDistressed = async (position) => {
    setIsClaimingDistressed(true)
    try {
      const dep = getDeployment(position.deployment)
      const rm = await getRiskManagerWithSigner(dep.riskManager)
      if (typeof rm.claimDistressedAssets === "function") {
        await (await rm.claimDistressedAssets(position.poolId)).wait()
      }
    } catch (err) {
      console.error("Failed to claim distressed assets", err)
    } finally {
      setIsClaimingDistressed(false)
    }
  }

  const handleClaimAllDistressed = async () => {
    if (underwritingPositions.length === 0) return
    setIsClaimingAllDistressed(true)
    try {
      const grouped = underwritingPositions.reduce((acc, p) => {
        if (p.pendingLoss > 0) {
          ;(acc[p.deployment] = acc[p.deployment] || []).push(p.poolId)
        }
        return acc
      }, {})
      for (const [depName, ids] of Object.entries(grouped)) {
        const dep = getDeployment(depName)
        const rm = await getRiskManagerWithSigner(dep.riskManager)
        for (const id of ids) {
          if (typeof rm.claimDistressedAssets === "function") {
            await (await rm.claimDistressedAssets(id)).wait()
          }
        }
      }
    } catch (err) {
      console.error("Failed to claim all distressed assets", err)
    } finally {
      setIsClaimingAllDistressed(false)
    }
  }

  const handleExecuteWithdrawal = async () => {
    setIsExecuting(true)
    try {
      const dep = getDeployment(defaultDeployment)
      const cp = await getCapitalPoolWithSigner(dep.capitalPool)
      await (await cp.executeWithdrawal()).wait()
    } catch (err) {
      console.error("Failed to execute withdrawal", err)
    } finally {
      setIsExecuting(false)
    }
  }

  // Calculate total yield and value
  const totalValue = underwritingPositions.reduce((sum, position) => sum + position.nativeValue, 0)
  const weightedYield = underwritingPositions.reduce((sum, position) => sum + position.yield * position.nativeValue, 0)
  const averageYield = totalValue > 0 ? weightedYield / totalValue : 0

  const totalDeposited = (details || []).reduce((sum, d) => {
    const dec = pools.find((p) => p.deployment === d.deployment)?.underlyingAssetDecimals ?? 6
    return sum + Number(ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, dec))
  }, 0)
  const totalDepositedUsd = (details || []).reduce((sum, d) => {
    const pool = pools.find((p) => p.deployment === d.deployment)
    const price = pool?.tokenPriceUsd ?? 1
    const dec = pool?.underlyingAssetDecimals ?? 6
    console.log(price, sum, d.totalDepositedAssetPrincipal, "price totalDepositedUsd")

    return sum + Number(ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, dec)) * price
  }, 0)
  const totalUnderwritten = underwritingPositions.reduce((sum, p) => sum + p.nativeValue, 0)

  const totalUnderwrittenUsd = underwritingPositions.reduce((sum, p) => sum + p.usdValue, 0)
  const baseAdapter = adapters.find((a) => a.id === Number(details?.[0]?.yieldChoice))
  const baseYieldApr = baseAdapter?.apr || 0
  const totalApr = baseYieldApr + averageYield

  const renderTables = (positions, title) => {
    const active = positions.filter((p) => p.status === "active")
    const withdrawal = positions.filter((p) => p.status === "requested withdrawal")
    const baseColumnCount = 6
    const columnCount = showPendingLoss ? baseColumnCount + 1 : baseColumnCount

    return (
      <div className="mt-6">
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        {positions.length > 0 && (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle">
              <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Protocol
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Pool
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        {displayCurrency === "native" ? "Amount" : "Value"}
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        Yield APY
                      </th>
                      {showPendingLoss && (
                        <th
                          scope="col"
                          className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                        >
                          Pending Loss
                        </th>
                      )}
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {positions.map((position) => (
                      <Fragment key={position.id}>
                        <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                                <Image
                                  src={getProtocolLogo(position.poolId) || "/placeholder.svg"}
                                  alt={getProtocolName(position.poolId)}
                                  width={32}
                                  height={32}
                                  className="rounded-full"
                                />
                              </div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {getProtocolName(position.poolId)}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-6 w-6 mr-2">
                                <Image
                                  src={getTokenLogo(position.pool) || "/placeholder.svg"}
                                  alt={getTokenName(position.pool)}
                                  width={24}
                                  height={24}
                                  className="rounded-full"
                                />
                              </div>
                              <div className="text-sm text-gray-900 dark:text-white">{getTokenName(position.pool)}</div>
                            </div>
                            <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                              {displayCurrency === "native"
                                ? `${position.amount}`
                                : formatCurrency(position.usdValue, "USD", "usd")}
                            </div>
                            <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                              {formatPercentage(position.yield)}
                            </div>
                            {position.pendingLoss > 0 && (
                              <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                                Loss:{" "}
                                {formatCurrency(
                                  displayCurrency === "native" ? position.pendingLoss : position.pendingLossUsd,
                                  "USD",
                                  displayCurrency,
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                            <div className="text-sm text-gray-900 dark:text-white">
                              {displayCurrency === "native"
                                ? `${position.amount}`
                                : formatCurrency(position.usdValue, "USD", "usd")}
                            </div>
                          </td>
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                            <div className="text-sm font-medium text-green-600 dark:text-green-400">
                              {formatPercentage(position.yield)}
                            </div>
                          </td>
                          {showPendingLoss && (
                            <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                              <div className="text-sm text-gray-900 dark:text-white">
                                {formatCurrency(
                                  displayCurrency === "native" ? position.pendingLoss : position.pendingLossUsd,
                                  "USD",
                                  displayCurrency,
                                )}
                              </div>
                            </td>
                          )}
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                            <span
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${position.status === "requested withdrawal" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400"}`}
                            >
                              {position.status}
                            </span>
                          </td>
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => toggleRow(position.id)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto"
                            >
                              <span className="hidden sm:inline">
                                {expandedRows.includes(position.id) ? "Hide" : "Actions"}
                              </span>
                              {expandedRows.includes(position.id) ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                        </tr>
                        {expandedRows.includes(position.id) && (
                          <tr>
                            <td colSpan={columnCount} className="px-3 sm:px-6 py-6 bg-gray-50/50 dark:bg-gray-700/30">
                              <div className="max-w-6xl mx-auto">
                                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-600 overflow-hidden">
                                  {/* Header */}
                                  <div className="bg-slate-700 dark:bg-slate-800 px-6 py-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-slate-600 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                                          <svg
                                            className="w-5 h-5 text-white"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                            />
                                          </svg>
                                        </div>
                                        <div>
                                          <h3 className="text-lg font-semibold text-white">Position Management</h3>
                                          <p className="text-slate-300 text-sm">
                                            {getProtocolName(position.poolId)} • {getTokenName(position.pool)}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-white text-lg font-bold">
                                          {formatCurrency(
                                            displayCurrency === "native" ? position.amount : position.usdValue,
                                            "USD",
                                            displayCurrency,
                                          )}
                                        </div>
                                        <div className="text-slate-300 text-sm">Total Value</div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Content */}
                                  <div className="p-6">
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                      {/* Position Metrics */}
                                      <div className="lg:col-span-2 space-y-6">
                                        <div>
                                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                            <svg
                                              className="w-4 h-4"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                              />
                                            </svg>
                                            Position Metrics
                                          </h4>
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800/30">
                                              <div className="text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                                Pending Rewards
                                              </div>
                                              <div className="text-emerald-900 dark:text-emerald-300 text-lg font-bold">
                                                {(Number(rewardsMap[position.id] || 0) / 1e18).toFixed(4)}
                                              </div>
                                            </div>
                                            <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-4 border border-blue-200 dark:border-blue-800/30">
                                              <div className="text-blue-700 dark:text-blue-400 text-sm font-medium">
                                                Yield APY
                                              </div>
                                              <div className="text-blue-900 dark:text-blue-300 text-lg font-bold">
                                                {formatPercentage(position.yield)}
                                              </div>
                                            </div>
                                            <div className="bg-slate-50 dark:bg-slate-900/10 rounded-lg p-4 border border-slate-200 dark:border-slate-800/30">
                                              <div className="text-slate-700 dark:text-slate-400 text-sm font-medium">
                                                Status
                                              </div>
                                              <div className="mt-1">
                                                <span
                                                  className={`px-2 py-1 text-xs rounded-full font-medium ${
                                                    position.status === "requested withdrawal"
                                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                                      : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400"
                                                  }`}
                                                >
                                                  {position.status}
                                                </span>
                                              </div>
                                            </div>
                                            {position.pendingLoss > 0 && (
                                              <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-4 border border-red-200 dark:border-red-800/30">
                                                <div className="text-red-700 dark:text-red-400 text-sm font-medium">
                                                  Pending Loss
                                                </div>
                                                <div className="text-red-900 dark:text-red-300 text-lg font-bold">
                                                  {formatCurrency(
                                                    displayCurrency === "native"
                                                      ? position.pendingLoss
                                                      : position.pendingLossUsd,
                                                    "USD",
                                                    displayCurrency,
                                                  )}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        {/* Quick Actions */}
                                        <div>
                                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                            <svg
                                              className="w-4 h-4"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M13 10V3L4 14h7v7l9-11h-7z"
                                              />
                                            </svg>
                                            Quick Actions
                                          </h4>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <button
                                              className="group flex items-center justify-center gap-3 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                              onClick={() => handleClaimRewards(position)}
                                              disabled={isClaiming}
                                            >
                                              <svg
                                                className="w-5 h-5 group-hover:scale-110 transition-transform"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                                                />
                                              </svg>
                                              {isClaiming ? "Claiming..." : "Claim Rewards"}
                                            </button>

                                            <button
                                              className="group flex items-center justify-center gap-3 py-3 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md"
                                              onClick={() => handleOpenModal(position)}
                                            >
                                              <svg
                                                className="w-5 h-5 group-hover:scale-110 transition-transform"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                                />
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                                />
                                              </svg>
                                              Manage Position
                                            </button>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Secondary Actions */}
                                      <div className="space-y-6">
                                        <div>
                                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                            <svg
                                              className="w-4 h-4"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                                              />
                                            </svg>
                                            Additional Actions
                                          </h4>
                                          <div className="space-y-3">
                                            <Link
                                              href={`/pool/${position.poolId}/${position.pool}`}
                                              className="group flex items-center gap-3 py-3 px-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-all duration-200 border border-gray-200 dark:border-gray-600"
                                            >
                                              <svg
                                                className="w-5 h-5 group-hover:scale-110 transition-transform"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                              >
                                                <path
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  strokeWidth={2}
                                                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                />
                                              </svg>
                                              View Pool Details
                                            </Link>

                                            {position.pendingLoss > 0 && (
                                              <button
                                                className="group w-full flex items-center gap-3 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50"
                                                onClick={() => handleClaimDistressed(position)}
                                                disabled={isClaimingDistressed}
                                              >
                                                <svg
                                                  className="w-5 h-5 group-hover:scale-110 transition-transform"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  viewBox="0 0 24 24"
                                                >
                                                  <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                                  />
                                                </svg>
                                                {isClaimingDistressed ? "Claiming..." : "Claim Distressed"}
                                              </button>
                                            )}

                                            {withdrawalReady && details?.[0]?.withdrawalRequestShares > 0 && (
                                              <button
                                                className="group w-full flex items-center gap-3 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50"
                                                onClick={handleExecuteWithdrawal}
                                                disabled={isExecuting}
                                              >
                                                <svg
                                                  className="w-5 h-5 group-hover:scale-110 transition-transform"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  viewBox="0 0 24 24"
                                                >
                                                  <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                                                  />
                                                </svg>
                                                {isExecuting ? "Executing..." : "Execute Withdrawal"}
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        {/* Info Panel */}
                                        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-4 border border-blue-200 dark:border-blue-800/30">
                                          <div className="flex items-start gap-3">
                                            <svg
                                              className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                              />
                                            </svg>
                                            <div>
                                              <h5 className="text-blue-900 dark:text-blue-300 font-medium text-sm mb-1">
                                                Position Status
                                              </h5>
                                              <p className="text-blue-800 dark:text-blue-400 text-xs leading-relaxed">
                                                {position.status === "active" &&
                                                  "Your position is actively earning yield and providing coverage."}
                                                {position.status === "requested withdrawal" &&
                                                  `Withdrawal will be available in ${unlockDays} days.`}
                                              </p>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {withdrawal.length > 0 && (
          <div className="mt-8 overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle">
              <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Protocol
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Pool
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        {displayCurrency === "native" ? "Amount" : "Value"}
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        Unlock
                      </th>
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {withdrawal.map((position) => (
                      <tr key={position.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                              <Image
                                src={getProtocolLogo(position.id) || "/placeholder.svg"}
                                alt={position.protocol}
                                width={32}
                                height={32}
                                className="rounded-full"
                              />
                            </div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {getProtocolName(position.id)}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-6 w-6 mr-2">
                              <Image
                                src={getTokenLogo(position.pool) || "/placeholder.svg"}
                                alt={position.poolName}
                                width={24}
                                height={24}
                                className="rounded-full"
                              />
                            </div>
                            <div className="text-sm text-gray-900 dark:text-white">{getTokenName(position.pool)}</div>
                          </div>
                          <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                            {displayCurrency === "native"
                              ? `${position.amount}`
                              : formatCurrency(position.usdValue, "USD", "usd")}
                          </div>
                          <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                            {unlockDays}d
                          </div>
                          {position.pendingLoss > 0 && (
                            <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                              Loss:{" "}
                              {formatCurrency(
                                displayCurrency === "native" ? position.pendingLoss : position.pendingLossUsd,
                                "USD",
                                displayCurrency,
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm text-gray-900 dark:text-white">
                            {displayCurrency === "native"
                              ? `${position.amount}`
                              : formatCurrency(position.usdValue, "USD", "usd")}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm font-medium text-green-600 dark:text-green-400">{unlockDays}d</div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {withdrawalReady && (
                            <button
                              onClick={handleExecuteWithdrawal}
                              disabled={isExecuting}
                              className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 disabled:opacity-50"
                            >
                              {isExecuting ? "Executing..." : "Withdraw"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (underwritingPositions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <TrendingUp className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
          {totalDeposited > 0 ? "Capital deposited but not allocated" : "No underwriting positions"}
        </h3>
        {totalDeposited > 0 ? (
          <div>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              You have{" "}
              {formatCurrency(
                displayCurrency === "native" ? totalDeposited : totalDepositedUsd,
                "USD",
                displayCurrency,
              )}{" "}
              ready to allocate.
            </p>
            <button
              onClick={() => setShowAllocModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              Allocate Capital
            </button>
            {showAllocModal && (
              <ManageAllocationModal
                isOpen={showAllocModal}
                onClose={() => setShowAllocModal(false)}
                deployment={defaultDeployment}
              />
            )}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            You don't have any active underwriting positions. Visit the markets page to provide coverage.
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Value Deposited</div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(
                displayCurrency === "native" ? totalDeposited : totalDepositedUsd,
                "USD",
                displayCurrency,
              )}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Value Underwritten</div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(
                displayCurrency === "native" ? totalUnderwritten : totalUnderwrittenUsd,
                "USD",
                displayCurrency,
              )}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              Base Yield {baseAdapter ? `(${baseAdapter.name})` : ""}
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatPercentage(baseYieldApr)}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total APR</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatPercentage(totalApr)}</div>
          </div>
        </div>
      </div>
      {renderTables(protocolPositions, "Protocol Cover")}
      {renderTables(stablecoinPositions, "Stablecoin Cover")}
      {hasDistressedAssets && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleClaimAllDistressed}
            disabled={isClaimingAllDistressed}
            className="mr-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md"
          >
            {isClaimingAllDistressed ? "Claiming..." : "Claim All Distressed"}
          </button>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setShowAllocModal(true)}
          className="mr-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
        >
          Edit Allocation
        </button>
        <button
          onClick={handleClaimAllRewards}
          disabled={isClaimingAll}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md"
        >
          {isClaimingAll ? "Claiming..." : "Claim All Rewards"}
        </button>
      </div>

      {/* Manage Position Modal */}
      {selectedPosition && (
        <ManageCoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type="position"
          protocol={selectedPosition.protocol}
          token={selectedPosition.pool}
          amount={selectedPosition.amount}
          yield={selectedPosition.yield}
          shares={selectedPosition.shares}
          poolId={selectedPosition.poolId}
          yieldChoice={selectedPosition.yieldChoice}
          deployment={selectedPosition.deployment}
        />
      )}
      {showAllocModal && (
        <ManageAllocationModal
          isOpen={showAllocModal}
          onClose={() => setShowAllocModal(false)}
          deployment={defaultDeployment}
        />
      )}
    </div>
  )
}
