"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowDown, ArrowUp, Search } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { ethers } from "ethers"
import useClaims from "../../hooks/useClaims"
import usePools from "../../hooks/usePools"
import useAnalytics from "../../hooks/useAnalytics"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"

export default function AnalyticsPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [sortConfig, setSortConfig] = useState({
    key: "id",
    direction: "desc",
  })
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10
  const { claims } = useClaims()
  const { pools } = usePools()
  const { data: analyticsData } = useAnalytics()

  const mappedClaims = claims
    .map((c, idx) => {
      const pool = pools.find((p) => Number(p.id) === c.poolId)
      if (!pool) return null
      const protocol = getTokenName(pool.protocolTokenToCover)
      const token = pool.protocolTokenToCover
      const tokenName = getTokenName(pool.protocolTokenToCover)

      const distressedAmount = Number(
        ethers.utils.formatUnits(c.protocolTokenAmountReceived, pool.protocolTokenDecimals ?? 18),
      )
      const coverage = Number(ethers.utils.formatUnits(c.coverage, pool.underlyingAssetDecimals))
      const netPayout = Number(ethers.utils.formatUnits(c.netPayoutToClaimant, pool.underlyingAssetDecimals))
      const claimFee = Number(ethers.utils.formatUnits(c.claimFee, pool.underlyingAssetDecimals))

      return {
        id: idx + 1,
        policyId: c.policyId,
        url: `https://etherscan.io/tx/${c.transactionHash}`,
        protocolName: protocol,
        poolId: c.poolId,
        token,
        tokenName,
        distressedAmount,
        coverage,
        netPayout,
        claimFee,
        date: new Date(c.timestamp * 1000).toISOString().slice(0, 10),
      }
    })
    .filter(Boolean)

  const stats = (() => {
    const byToken = {}
    const byProduct = {}
    const byMonth = {}
    for (const c of mappedClaims) {
      const tName = getTokenName(c.token)
      byToken[tName] = (byToken[tName] || 0) + c.netPayout
      byProduct[c.protocolName] = (byProduct[c.protocolName] || 0) + c.netPayout
      const month = new Date(c.date).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      })
      byMonth[month] = (byMonth[month] || 0) + c.netPayout
    }
    return {
      total: mappedClaims.reduce((sum, c) => sum + c.netPayout, 0),
      byToken,
      byProduct: Object.entries(byProduct).map(([name, amount]) => ({
        name,
        amount,
      })),
      byMonth: Object.entries(byMonth).map(([month, amount]) => ({
        month,
        amount,
      })),
    }
  })()

  // Filter claims based on search term
  const filteredClaims = mappedClaims.filter(
    (claim) =>
      claim.protocolName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      claim.token.toLowerCase().includes(searchTerm.toLowerCase()) ||
      claim.id.toString().includes(searchTerm),
  )

  // Sort claims based on sort config
  const sortedClaims = [...filteredClaims].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) {
      return sortConfig.direction === "asc" ? -1 : 1
    }
    if (a[sortConfig.key] > b[sortConfig.key]) {
      return sortConfig.direction === "asc" ? 1 : -1
    }
    return 0
  })

  // Paginate claims
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentClaims = sortedClaims.slice(indexOfFirstItem, indexOfLastItem)
  const totalPages = Math.ceil(sortedClaims.length / itemsPerPage)

  // Handle sort
  const requestSort = (key) => {
    let direction = "asc"
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
  }

  // Get sort direction icon
  const getSortDirectionIcon = (key) => {
    if (sortConfig.key !== key) return null
    return sortConfig.direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />
  }

  const activeCover = analyticsData ? Number(ethers.utils.formatUnits(analyticsData.totalActiveCover || "0", 6)) : 0
  const totalPremiums = analyticsData ? Number(ethers.utils.formatUnits(analyticsData.totalPremiumsPaid || "0", 6)) : 0
  const totalClaimFees = analyticsData ? Number(ethers.utils.formatUnits(analyticsData.totalClaimFees || "0", 6)) : 0
  const underwriterCount = analyticsData?.underwriterCount || 0
  const policyHolderCount = analyticsData?.policyHolderCount || 0
  const lapsedHistory = (analyticsData?.lapsedCoverHistory || []).map((h) => ({
    date: new Date(h.timestamp * 1000).toISOString().slice(0, 10),
    amount: Number(ethers.utils.formatUnits(h.amount, 6)),
  }))
  const coverHistory = (analyticsData?.activeCoverHistory || []).map((h) => ({
    date: new Date(h.timestamp * 1000).toISOString().slice(0, 10),
    amount: Number(ethers.utils.formatUnits(h.active, 6)),
  }))

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Analytics</h1>
        <p className="text-gray-600 dark:text-gray-300">View historical claims data and insurance payout statistics</p>
      </div>

      {/* Key Metrics */}
      <div className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Claims Paid</div>
                <div className="text-3xl font-bold text-slate-700 dark:text-slate-300">
                  ${stats.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-slate-600 dark:text-slate-400"
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
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Active Cover</div>
                <div className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                  ${activeCover.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-emerald-600 dark:text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Premiums Collected</div>
                <div className="text-3xl font-bold text-blue-700 dark:text-blue-400">
                  ${totalPremiums.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Claim Fees</div>
                <div className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                  ${totalClaimFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-gray-600 dark:text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Underwriters</div>
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">
                  {underwriterCount.toLocaleString()}
                </div>
              </div>
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-slate-600 dark:text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Policy Holders</div>
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">
                  {policyHolderCount.toLocaleString()}
                </div>
              </div>
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-slate-600 dark:text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Cover Chart */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-xl font-semibold mb-4">Active Cover Over Time</h2>
        <div className="h-80">
          <ActiveCoverChart data={coverHistory} />
        </div>
      </div>

      {/* Cover Drop Off Chart */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-xl font-semibold mb-4">Cover Drop Off</h2>
        <div className="h-80">
          <LapsedCoverChart data={lapsedHistory} />
        </div>
      </div>

      {/* Claims Over Time Chart */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-xl font-semibold mb-4">Claims Paid Over Time</h2>
        <div className="h-80">
          <ClaimsOverTimeChart data={stats.byMonth} />
        </div>
      </div>

      {/* Claims By Product Chart */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-xl font-semibold mb-4">Claims Paid per Product Name</h2>
        <div className="h-80">
          <ClaimsByProductChart data={stats.byProduct} />
        </div>
      </div>

      {/* Claims History Table */}
      <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h2 className="text-xl font-semibold">Closed Claims History</h2>
            <div className="relative w-full md:w-64">
              <input
                type="text"
                placeholder="Search claims..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {[
                  { key: "id", label: "Claim ID" },
                  { key: "policyId", label: "Policy ID" },
                  { key: "protocolName", label: "Protocol" },
                  { key: "tokenName", label: "Asset" },
                  { key: "distressedAmount", label: "Distressed Amt" },
                  { key: "coverage", label: "Coverage" },
                  { key: "netPayout", label: "Payout" },
                  { key: "claimFee", label: "Fee" },
                  { key: "date", label: "Date" },
                ].map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-3 py-3.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => requestSort(column.key)}
                  >
                    <div className="flex items-center">
                      {column.label}
                      {getSortDirectionIcon(column.key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {currentClaims.map((claim) => (
                <tr key={`${claim.id}-${claim.policyId}`} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{claim.id}</td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {claim.policyId}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    <Link href={claim.url} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {claim.protocolName}
                    </Link>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-5 w-5 mr-2">
                        <Image
                          src={getTokenLogo(claim.token) || "/placeholder.svg"}
                          alt={claim.tokenName}
                          width={20}
                          height={20}
                          className="rounded-full"
                        />
                      </div>
                      {claim.tokenName}
                    </div>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {claim.distressedAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {`$${claim.coverage.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {`$${claim.netPayout.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {`$${claim.claimFee.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{claim.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{" "}
                <span className="font-medium">{Math.min(indexOfLastItem, sortedClaims.length)}</span> of{" "}
                <span className="font-medium">{sortedClaims.length}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">First</span>
                  <span className="h-5 w-5 flex items-center justify-center">«</span>
                </button>
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <span className="h-5 w-5 flex items-center justify-center">‹</span>
                </button>

                {/* Page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (currentPage <= 3) {
                    pageNum = i + 1
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = currentPage - 2 + i
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`relative inline-flex items-center px-4 py-2 border ${
                        currentPage === pageNum
                          ? "z-10 bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400"
                          : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                      } text-sm font-medium`}
                    >
                      {pageNum}
                    </button>
                  )
                })}

                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <span className="h-5 w-5 flex items-center justify-center">›</span>
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Last</span>
                  <span className="h-5 w-5 flex items-center justify-center">»</span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Claims Over Time Chart Component
function ClaimsOverTimeChart({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    const el = canvasRef.current
    const ctx = el.getContext("2d")

    // Clear previous chart if it exists
    if (window.claimsTimeChart) {
      window.claimsTimeChart.destroy()
    }

    // Set canvas dimensions for high DPI displays
    const dpr = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = rect.width * dpr
    el.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Draw chart
    const isDarkMode = document.documentElement.classList.contains("dark")
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)"

    const labels = data.map((item) => item.month)
    const values = data.map((item) => item.amount)

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height)
    gradient.addColorStop(0, "rgba(71, 85, 105, 0.8)")
    gradient.addColorStop(1, "rgba(71, 85, 105, 0.1)")

    // Create chart
    window.claimsTimeChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Claims Paid",
            data: values,
            backgroundColor: gradient,
            borderColor: "rgb(71, 85, 105)",
            borderWidth: 2,
            pointBackgroundColor: "rgb(71, 85, 105)",
            pointBorderColor: isDarkMode ? "#1f2937" : "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
            titleColor: isDarkMode ? "#e5e7eb" : "#374151",
            bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
            borderColor: isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)",
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (context) => `$${context.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              callback: (value) => `$${value.toLocaleString()}`,
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    })
  }, [data])

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}

// Claims By Product Chart Component
function ClaimsByProductChart({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    const el = canvasRef.current
    const ctx = el.getContext("2d")

    // Clear previous chart if it exists
    if (window.claimsProductChart) {
      window.claimsProductChart.destroy()
    }

    // Set canvas dimensions for high DPI displays
    const dpr = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = rect.width * dpr
    el.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Draw chart
    const isDarkMode = document.documentElement.classList.contains("dark")
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)"

    const labels = data.map((item) => item.name)
    const values = data.map((item) => item.amount)

    // Create chart
    window.claimsProductChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Claims Paid",
            data: values,
            backgroundColor: "rgba(71, 85, 105, 0.8)",
            borderColor: "rgb(71, 85, 105)",
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
            titleColor: isDarkMode ? "#e5e7eb" : "#374151",
            bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
            borderColor: isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)",
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (context) => `$${context.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              callback: (value) => `$${value.toLocaleString()}`,
            },
          },
        },
      },
    })
  }, [data])

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}

// Active Cover Chart Component
function ActiveCoverChart({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    const el = canvasRef.current
    const ctx = el.getContext("2d")

    // Clear previous chart if it exists
    if (window.activeCoverChart) {
      window.activeCoverChart.destroy()
    }

    // Set canvas dimensions for high DPI displays
    const dpr = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = rect.width * dpr
    el.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Draw chart
    const isDarkMode = document.documentElement.classList.contains("dark")
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)"

    const labels = data.map((item) => item.date)
    const values = data.map((item) => item.amount)

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height)
    gradient.addColorStop(0, "rgba(16, 185, 129, 0.8)")
    gradient.addColorStop(1, "rgba(16, 185, 129, 0.1)")

    // Create chart
    window.activeCoverChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Active Cover",
            data: values,
            backgroundColor: gradient,
            borderColor: "rgb(16, 185, 129)",
            borderWidth: 2,
            pointBackgroundColor: "rgb(16, 185, 129)",
            pointBorderColor: isDarkMode ? "#1f2937" : "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
            titleColor: isDarkMode ? "#e5e7eb" : "#374151",
            bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
            borderColor: isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)",
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (context) => `$${context.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              callback: (value) => `$${value.toLocaleString()}`,
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    })
  }, [data])

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}

// Lapsed Cover Chart Component
function LapsedCoverChart({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    const el = canvasRef.current
    const ctx = el.getContext("2d")

    // Clear previous chart if it exists
    if (window.lapsedCoverChart) {
      window.lapsedCoverChart.destroy()
    }

    // Set canvas dimensions for high DPI displays
    const dpr = window.devicePixelRatio || 1
    const rect = el.getBoundingClientRect()
    el.width = rect.width * dpr
    el.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Draw chart
    const isDarkMode = document.documentElement.classList.contains("dark")
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)"

    const labels = data.map((item) => item.date)
    const values = data.map((item) => item.amount)

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height)
    gradient.addColorStop(0, "rgba(239, 68, 68, 0.8)")
    gradient.addColorStop(1, "rgba(239, 68, 68, 0.1)")

    // Create chart
    window.lapsedCoverChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Lapsed Cover",
            data: values,
            backgroundColor: gradient,
            borderColor: "rgb(239, 68, 68)",
            borderWidth: 2,
            pointBackgroundColor: "rgb(239, 68, 68)",
            pointBorderColor: isDarkMode ? "#1f2937" : "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
            titleColor: isDarkMode ? "#e5e7eb" : "#374151",
            bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
            borderColor: isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)",
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              label: (context) => `$${context.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 45,
            },
          },
          y: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              callback: (value) => `$${value.toLocaleString()}`,
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    })
  }, [data])

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}
