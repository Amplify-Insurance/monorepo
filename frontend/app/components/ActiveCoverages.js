"use client"
import { useState, useEffect, Fragment } from "react"
import { Shield, ChevronDown, ChevronUp } from "lucide-react"
import Image from "next/image"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import ManageCoverageModal from "./ManageCoverageModal"
import CancelCoverageModal from "./CancelCoverageModal"
import { useAccount } from "wagmi"
import useUserPolicies from "../../hooks/useUserPolicies"
import usePools from "../../hooks/usePools"
import { ethers } from "ethers"
import { getUnderlyingAssetDecimals } from "../../lib/capitalPool"
import { getTokenName, getTokenLogo, getProtocolLogo, getProtocolName, getProtocolType } from "../config/tokenNameMap"

export default function ActiveCoverages({ displayCurrency }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCoverage, setSelectedCoverage] = useState(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [coverageToCancel, setCoverageToCancel] = useState(null)
  const { address } = useAccount()
  const { policies } = useUserPolicies(address)
  const { pools } = usePools()
  const [underlyingDec, setUnderlyingDec] = useState(6)
  const [expandedRows, setExpandedRows] = useState([])

  const toBigInt = (value) => {
    if (typeof value === "bigint") return value
    if (typeof value === "string" || typeof value === "number")
      return BigInt(value)
    if (value && typeof value === "object") {
      if ("hex" in value) return BigInt(value.hex)
      if (typeof value.toString === "function") return BigInt(value.toString())
    }
    return 0n
  }

  const toggleRow = (id) => {
    setExpandedRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  useEffect(() => {
    async function loadDec() {
      try {
        const dec = await getUnderlyingAssetDecimals()
        setUnderlyingDec(Number(dec))
      } catch (err) {
        console.error("Failed to fetch asset decimals", err)
      }
    }
    loadDec()
  }, [])

  console.log("ActiveCoverages - raw policies:", policies) // For debugging the raw data

  const now = Math.floor(Date.now() / 1000)

  const activeCoverages = policies
    .flatMap((p) => {
      const policyPoolId = p.poolId !== undefined ? Number(toBigInt(p.poolId)) : null
      if (policyPoolId === null) return []

      const pool = pools.find((pl) => pl.deployment === p.deployment && Number(pl.id) === policyPoolId)
      if (!pool) return []

      const protocol = getProtocolName(pool.id)
      const protocolLogo = getProtocolLogo(pool.id)
      const decimals = pool.underlyingAssetDecimals ?? underlyingDec

      const coverageAmount = Number(
        ethers.utils.formatUnits(toBigInt(p.coverage), decimals)
      )
      const pendingIncrease = p.pendingIncrease
        ? Number(ethers.utils.formatUnits(toBigInt(p.pendingIncrease), decimals))
        : 0

      const capacity = Number(
        ethers.utils.formatUnits(BigInt(pool.totalCapitalPledgedToPool) - BigInt(pool.totalCoverageSold), decimals),
      )

      const activationTs = Number(toBigInt(p.activation ?? p.start ?? 0n))
      const increaseActivationTs = Number(toBigInt(p.increaseActivationTimestamp ?? 0n))
      let expiryTs = Number(toBigInt(p.lastPaidUntil ?? 0n))

      const computeExpiry = (covAmount) => {
        if (expiryTs) return expiryTs
        const deposit = Number(
          ethers.utils.formatUnits(toBigInt(p.premiumDeposit ?? 0n), decimals)
        )
        const lastDrainTs = Number(toBigInt(p.lastDrainTime ?? 0n))
        const rate = Number(pool.premiumRateBps || 0) / 100
        const perSecond = rate > 0 ? (covAmount * (rate / 100)) / (365 * 24 * 60 * 60) : 0
        if (perSecond > 0) {
          return Math.floor(lastDrainTs + deposit / perSecond)
        }
        return 0
      }

      const baseCoverage = {
        policyId: p.id,
        deployment: p.deployment,
        protocol,
        protocolLogo,
        type: getProtocolType(pool.id),
        pool: pool.protocolTokenToCover,
        poolName: getTokenName(pool.protocolTokenToCover),
        premium: Number(pool.premiumRateBps || 0) / 100,
        capacity,
      }

      const rows = []

      if (pendingIncrease > 0 && increaseActivationTs <= now) {
        // Cooldown passed - merge
        const totalCov = coverageAmount + pendingIncrease
        const expiry = computeExpiry(totalCov)
        let status = "active"
        if (now < activationTs) status = "pending"
        else if (expiry && now > expiry) status = "expired"

        rows.push({
          ...baseCoverage,
          id: `${p.id}-merged`,
          coverageAmount: totalCov,
          status,
          activation: activationTs,
          expiry,
        })
      } else {
        // Current active coverage row
        const expiryActive = computeExpiry(coverageAmount)
        let status = "active"
        if (now < activationTs) status = "pending"
        else if (expiryActive && now > expiryActive) status = "expired"

        rows.push({
          ...baseCoverage,
          id: `${p.id}-active`,
          coverageAmount,
          status,
          activation: activationTs,
          expiry: expiryActive,
        })

        // Pending increase row if not yet active
        if (pendingIncrease > 0) {
          const expiryPending = computeExpiry(pendingIncrease)
          let pStatus = "pending"
          if (increaseActivationTs && increaseActivationTs <= now) pStatus = "active"

          rows.push({
            ...baseCoverage,
            id: `${p.id}-pending`,
            coverageAmount: pendingIncrease,
            status: pStatus,
            activation: increaseActivationTs,
            expiry: expiryPending,
          })
        }
      }

      return rows
    })
    .filter((x) => x)

  console.log("Processed Coverage data:", activeCoverages) // For debugging the processed data

  const protocolCoverages = activeCoverages.filter((c) => c.type === "protocol")
  const stablecoinCoverages = activeCoverages.filter((c) => c.type === "stablecoin")
  const lstCoverages = activeCoverages.filter((c) => c.type === "lst")

  const handleOpenModal = (coverage) => {
    setSelectedCoverage(coverage)
    setModalOpen(true)
  }

  const openCancelModal = (coverage) => {
    setCoverageToCancel(coverage)
    setCancelModalOpen(true)
  }

  if (activeCoverages.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <Shield className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No coverages</h3>
        <p className="text-gray-500 dark:text-gray-400">
          You don't have any insurance coverages. Visit the markets page to purchase coverage.
        </p>
      </div>
    )
  }

  const renderTable = (covers) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              {covers[0].type === "stablecoin" ? "Insured Token" : covers[0].type === "lst" ? "LST" : "Protocol"}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              {covers[0].type === "stablecoin" ? "Reserve Token" : covers[0].type === "lst" ? "Underlying" : "Pool"}
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Coverage Amount
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Premium APY
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Starts
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Expires
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {covers.map((coverage) => (
            <Fragment key={coverage.id}>
              <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-8 w-8 mr-3">
                      <Image
                        src={coverage.protocolLogo || "/placeholder.svg"}
                        alt={coverage.protocol}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                    </div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{coverage.protocol}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-6 w-6 mr-2">
                      <Image
                        src={getTokenLogo(coverage.pool) || "/placeholder.svg"}
                        alt={getProtocolName(coverage.poolName)}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                    </div>
                    <div className="text-sm text-gray-900 dark:text-white">{coverage.poolName}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 dark:text-white">
                    {formatCurrency(coverage.coverageAmount, "USD", displayCurrency)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 dark:text-white">{formatPercentage(coverage.premium)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 dark:text-white">
                    {coverage.activation ? new Date(coverage.activation * 1000).toLocaleDateString() : "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 dark:text-white">
                    {coverage.expiry ? new Date(coverage.expiry * 1000).toLocaleDateString() : "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      coverage.status === "active"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400"
                        : coverage.status === "pending"
                        ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400"
                        : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400"
                    }`}
                  >
                    {coverage.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => toggleRow(coverage.id)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto"
                  >
                    <span className="hidden sm:inline">{expandedRows.includes(coverage.id) ? "Hide" : "Actions"}</span>
                    {expandedRows.includes(coverage.id) ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </td>
              </tr>
              {expandedRows.includes(coverage.id) && (
                <tr>
                  <td colSpan={8} className="px-6 py-6 bg-gray-50/50 dark:bg-gray-700/30">
                    <div className="max-w-6xl mx-auto">
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-600 overflow-hidden">
                        {/* Header */}
                        <div className="bg-emerald-700 dark:bg-emerald-800 px-6 py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-emerald-600 dark:bg-emerald-700 rounded-lg flex items-center justify-center">
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
                                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                  />
                                </svg>
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold text-white">Coverage Management</h3>
                                <p className="text-emerald-100 text-sm">
                                  {coverage.protocol} • {coverage.poolName}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-white text-lg font-bold">
                                {formatCurrency(coverage.coverageAmount, "USD", displayCurrency)}
                              </div>
                              <div className="text-emerald-100 text-sm">Coverage Amount</div>
                            </div>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="p-6">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Coverage Details */}
                            <div className="lg:col-span-2 space-y-6">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                    />
                                  </svg>
                                  Coverage Details
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                  <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800/30">
                                    <div className="text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                      Coverage Amount
                                    </div>
                                    <div className="text-emerald-900 dark:text-emerald-300 text-lg font-bold">
                                      {formatCurrency(coverage.coverageAmount, "USD", displayCurrency)}
                                    </div>
                                  </div>
                                  <div className="bg-blue-50 dark:bg-blue-900/10 rounded-lg p-4 border border-blue-200 dark:border-blue-800/30">
                                    <div className="text-blue-700 dark:text-blue-400 text-sm font-medium">
                                      Premium APY
                                    </div>
                                    <div className="text-blue-900 dark:text-blue-300 text-lg font-bold">
                                      {formatPercentage(coverage.premium)}
                                    </div>
                                  </div>
                                  <div className="bg-slate-50 dark:bg-slate-900/10 rounded-lg p-4 border border-slate-200 dark:border-slate-800/30">
                                    <div className="text-slate-700 dark:text-slate-400 text-sm font-medium">
                                      Available Capacity
                                    </div>
                                    <div className="text-slate-900 dark:text-slate-300 text-lg font-bold">
                                      {formatCurrency(coverage.capacity, "USD", displayCurrency)}
                                    </div>
                                  </div>
                                  <div className="bg-gray-50 dark:bg-gray-900/10 rounded-lg p-4 border border-gray-200 dark:border-gray-800/30">
                                    <div className="text-gray-700 dark:text-gray-400 text-sm font-medium">Status</div>
                                    <div className="mt-1">
                                      <span className="px-2 py-1 text-xs rounded-full font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400">
                                        {coverage.status}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Timeline */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                  Coverage Timeline
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-600 dark:text-gray-400 text-sm font-medium">
                                      Activation Date
                                    </div>
                                    <div className="text-gray-800 dark:text-gray-200 text-base font-semibold">
                                      {coverage.activation
                                        ? new Date(coverage.activation * 1000).toLocaleDateString()
                                        : "Not set"}
                                    </div>
                                  </div>
                                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                                    <div className="text-gray-600 dark:text-gray-400 text-sm font-medium">
                                      Expiry Date
                                    </div>
                                    <div className="text-gray-800 dark:text-gray-200 text-base font-semibold">
                                      {coverage.expiry
                                        ? new Date(coverage.expiry * 1000).toLocaleDateString()
                                        : "Not set"}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Actions */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                  {coverage.status !== "expired" && (
                                    <button
                                      className="group flex items-center justify-center gap-3 py-3 px-4 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md"
                                      onClick={() => handleOpenModal(coverage)}
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
                                      Manage Coverage
                                    </button>
                                  )}

                                  <button
                                    className="group flex items-center justify-center gap-3 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all duration-200 shadow-sm hover:shadow-md"
                                    onClick={() =>
                                      coverage.status === "expired"
                                        ? handleOpenModal(coverage)
                                        : openCancelModal(coverage)
                                    }
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
                                        d={
                                          coverage.status === "expired"
                                            ? "M12 6v6m0 0v6m-6-6h12"
                                            : "M6 18L18 6M6 6l12 12"
                                        }
                                      />
                                    </svg>
                                    {coverage.status === "expired" ? "Renew Coverage" : "Cancel Coverage"}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Status Panel */}
                            <div className="space-y-6">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                  Coverage Status
                                </h4>

                                <div
                                  className={`rounded-lg p-4 border ${
                                    coverage.status === "active"
                                      ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30"
                                      : coverage.status === "pending"
                                        ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30"
                                        : "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30"
                                  }}`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div
                                      className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                        coverage.status === "active"
                                          ? "bg-emerald-100 dark:bg-emerald-800"
                                          : coverage.status === "pending"
                                            ? "bg-amber-100 dark:bg-amber-800"
                                            : "bg-red-100 dark:bg-red-800"
                                      }`}
                                    >
                                      {coverage.status === "active" && (
                                        <svg
                                          className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M5 13l4 4L19 7"
                                          />
                                        </svg>
                                      )}
                                      {coverage.status === "pending" && (
                                        <svg
                                          className="w-4 h-4 text-amber-600 dark:text-amber-400"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                      )}
                                      {coverage.status === "expired" && (
                                        <svg
                                          className="w-4 h-4 text-red-600 dark:text-red-400"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M6 18L18 6M6 6l12 12"
                                          />
                                        </svg>
                                      )}
                                    </div>
                                    <div>
                                      <h5
                                        className={`font-medium text-sm mb-1 ${
                                          coverage.status === "active"
                                            ? "text-emerald-900 dark:text-emerald-300"
                                            : coverage.status === "pending"
                                              ? "text-amber-900 dark:text-amber-300"
                                              : "text-red-900 dark:text-red-300"
                                        }`}
                                      >
                                        {coverage.status.charAt(0).toUpperCase() + coverage.status.slice(1)} Coverage
                                      </h5>
                                      <p
                                        className={`text-xs leading-relaxed ${
                                          coverage.status === "active"
                                            ? "text-emerald-800 dark:text-emerald-400"
                                            : coverage.status === "pending"
                                              ? "text-amber-800 dark:text-amber-400"
                                              : "text-red-800 dark:text-red-400"
                                        }`}
                                      >
                                        {coverage.status === "active" &&
                                          "Your coverage is currently active and protecting your assets."}
                                        {coverage.status === "pending" && "Your coverage will activate soon."}
                                        {coverage.status === "expired" &&
                                          "This coverage has expired and is no longer active."}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Coverage Progress */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                                    />
                                  </svg>
                                  Coverage Progress
                                </h4>

                                {coverage.activation && coverage.expiry && (
                                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                                      <span>Started</span>
                                      <span>Expires</span>
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 mb-2">
                                      <div
                                        className="bg-gradient-to-r from-emerald-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                                        style={{
                                          width: `${Math.min(100, Math.max(0, ((Date.now() / 1000 - coverage.activation) / (coverage.expiry - coverage.activation)) * 100))}%`,
                                        }}
                                      ></div>
                                    </div>
                                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                      <span>{new Date(coverage.activation * 1000).toLocaleDateString()}</span>
                                      <span>{new Date(coverage.expiry * 1000).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Additional Info */}
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
                                      Coverage Information
                                    </h5>
                                    <p className="text-blue-800 dark:text-blue-400 text-xs leading-relaxed">
                                      {coverage.type === "stablecoin"
                                        ? `This coverage protects your ${coverage.poolName} assets against depegging events.`
                                        : coverage.type === "lst"
                                          ? `This coverage protects your ${coverage.poolName} holdings against slashing or custody risks.`
                                          : `This coverage protects your ${coverage.poolName} assets against smart contract risks and protocol failures.`}
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
  )

  return (
    <div className="space-y-6">
      {protocolCoverages.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2">Protocol Cover</h3>
          {renderTable(protocolCoverages)}
        </div>
      )}
      {stablecoinCoverages.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2">Stablecoin Cover</h3>
          {renderTable(stablecoinCoverages)}
        </div>
      )}
      {lstCoverages.length > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-2">LST Cover</h3>
          {renderTable(lstCoverages)}
        </div>
      )}

      {/* Manage Coverage Modal */}
      {selectedCoverage && (
        <ManageCoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type="coverage"
          protocol={selectedCoverage.protocol}
          token={selectedCoverage.pool}
          amount={selectedCoverage.coverageAmount}
          premium={selectedCoverage.premium}
          capacity={selectedCoverage.capacity}
          policyId={selectedCoverage.policyId}
          deployment={selectedCoverage.deployment}
          expiry={selectedCoverage.expiry}
        />
      )}
      {coverageToCancel && (
        <CancelCoverageModal
          isOpen={cancelModalOpen}
          onClose={(reload) => {
            setCancelModalOpen(false)
            setCoverageToCancel(null)
            if (reload) window.location.reload()
          }}
          coverage={coverageToCancel}
        />
      )}
    </div>
  )
}
