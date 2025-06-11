"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ethers } from "ethers";
import useClaims from "../../hooks/useClaims";
import usePools from "../../hooks/usePools";
import useAnalytics from "../../hooks/useAnalytics";
import { getTokenName, getTokenLogo } from "../config/tokenNameMap";

export default function AnalyticsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "id",
    direction: "desc",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { claims } = useClaims();
  const { pools } = usePools();
  const { data: analyticsData } = useAnalytics();

  const mappedClaims = claims
    .map((c, idx) => {
      const pool = pools.find((p) => Number(p.id) === c.poolId);
      if (!pool) return null;
      const protocol = getTokenName(pool.protocolTokenToCover);
      const token = pool.protocolTokenToCover;
      const tokenName = getTokenName(pool.protocolTokenToCover);

      const distressedAmount = Number(
        ethers.utils.formatUnits(
          c.protocolTokenAmountReceived,
          pool.protocolTokenDecimals
        )
      );
      const coverage = Number(
        ethers.utils.formatUnits(c.coverage, pool.underlyingAssetDecimals)
      );
      const netPayout = Number(
        ethers.utils.formatUnits(
          c.netPayoutToClaimant,
          pool.underlyingAssetDecimals
        )
      );
      const claimFee = Number(
        ethers.utils.formatUnits(c.claimFee, pool.underlyingAssetDecimals)
      );

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
      };
    })
    .filter(Boolean);

  const stats = (() => {
    const byToken = {};
    const byProduct = {};
    const byMonth = {};
    for (const c of mappedClaims) {
      const tName = getTokenName(c.token);
      byToken[tName] = (byToken[tName] || 0) + c.netPayout;
      byProduct[c.protocolName] =
        (byProduct[c.protocolName] || 0) + c.netPayout;
      const month = new Date(c.date).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      });
      byMonth[month] = (byMonth[month] || 0) + c.netPayout;
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
    };
  })();

  // Filter claims based on search term
  const filteredClaims = mappedClaims.filter(
    (claim) =>
      claim.protocolName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      claim.token.toLowerCase().includes(searchTerm.toLowerCase()) ||
      claim.id.toString().includes(searchTerm)
  );

  // Sort claims based on sort config
  const sortedClaims = [...filteredClaims].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) {
      return sortConfig.direction === "asc" ? -1 : 1;
    }
    if (a[sortConfig.key] > b[sortConfig.key]) {
      return sortConfig.direction === "asc" ? 1 : -1;
    }
    return 0;
  });

  // Paginate claims
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentClaims = sortedClaims.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(sortedClaims.length / itemsPerPage);

  // Handle sort
  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  // Get sort direction icon
  const getSortDirectionIcon = (key) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  };

  const activeCover = analyticsData
    ? Number(ethers.utils.formatUnits(analyticsData.totalActiveCover || "0", 6))
    : 0;
  const totalPremiums = analyticsData
    ? Number(
        ethers.utils.formatUnits(analyticsData.totalPremiumsPaid || "0", 6)
      )
    : 0;
  const totalClaimFees = analyticsData
    ? Number(
        ethers.utils.formatUnits(analyticsData.totalClaimFees || "0", 6)
      )
    : 0;
  const lapsedHistory = (analyticsData?.lapsedCoverHistory || []).map((h) => ({
    date: new Date(h.timestamp * 1000).toISOString().slice(0, 10),
    amount: Number(ethers.utils.formatUnits(h.amount, 6)),
  }));
  const coverHistory = (analyticsData?.activeCoverHistory || []).map((h) => ({
    date: new Date(h.timestamp * 1000).toISOString().slice(0, 10),
    amount: Number(ethers.utils.formatUnits(h.active, 6)),
  }));

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Analytics</h1>
        <p className="text-gray-600 dark:text-gray-300">
          View historical claims data and insurance payout statistics
        </p>
      </div>

      {/* Claims Statistics */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Claims Paid</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Claims */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Claims paid
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Total
            </div>
          </div>

          {/* DAI Claims */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Claims paid
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-yellow-600 dark:text-yellow-400">
              {(stats.byToken.DAI || 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              DAI share
            </div>
          </div>

          {/* ETH Claims */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Claims paid
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">
              {(stats.byToken.ETH || 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              ETH share
            </div>
          </div>

          {/* USDC Claims */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              Claims paid
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-blue-500 dark:text-blue-300">
              {(stats.byToken.USDC || 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              USDC share
            </div>
          </div>
        </div>
      </div>

      {/* Coverage Statistics */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Active Cover</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Active cover</div>
            <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">
              {activeCover.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">USD</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Premiums collected</div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400">
              {totalPremiums.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">USD</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Claim fees collected</div>
            <div className="text-2xl sm:text-3xl font-bold text-pink-600 dark:text-pink-400">
              {totalClaimFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">USD</div>
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
        <h2 className="text-xl font-semibold mb-4">
          Claims Paid per Product Name
        </h2>
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
                <tr
                  key={`${claim.id}-${claim.policyId}`}
                  className="hover:bg-gray-50 dark:hover:bg-gray-750"
                >
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {claim.id}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {claim.policyId}
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    <Link
                      href={claim.url}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {claim.protocolName}
                    </Link>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-5 w-5 mr-2">
                        <Image
                          src={getTokenLogo(claim.token)}
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
                  <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {claim.date}
                  </td>
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
              onClick={() =>
                setCurrentPage(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Showing{" "}
                <span className="font-medium">{indexOfFirstItem + 1}</span> to{" "}
                <span className="font-medium">
                  {Math.min(indexOfLastItem, sortedClaims.length)}
                </span>{" "}
                of <span className="font-medium">{sortedClaims.length}</span>{" "}
                results
              </p>
            </div>
            <div>
              <nav
                className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                aria-label="Pagination"
              >
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">First</span>
                  <span className="h-5 w-5 flex items-center justify-center">
                    «
                  </span>
                </button>
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <span className="h-5 w-5 flex items-center justify-center">
                    ‹
                  </span>
                </button>

                {/* Page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
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
                  );
                })}

                <button
                  onClick={() =>
                    setCurrentPage(Math.min(totalPages, currentPage + 1))
                  }
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <span className="h-5 w-5 flex items-center justify-center">
                    ›
                  </span>
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  <span className="sr-only">Last</span>
                  <span className="h-5 w-5 flex items-center justify-center">
                    »
                  </span>
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Claims Over Time Chart Component
function ClaimsOverTimeChart({ data }) {
  if (typeof window === "undefined") {
    return (
      <div className="h-full flex items-center justify-center">
        Loading chart...
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <canvas
        id="claimsOverTimeChart"
        className="h-full w-full"
        ref={(el) => {
          if (el && data) {
            const ctx = el.getContext("2d");

            // Clear previous chart if it exists
            if (window.claimsTimeChart) {
              window.claimsTimeChart.destroy();
            }

            // Set canvas dimensions for high DPI displays
            const dpr = window.devicePixelRatio || 1;
            const rect = el.getBoundingClientRect();
            el.width = rect.width * dpr;
            el.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            // Draw chart
            const isDarkMode =
              document.documentElement.classList.contains("dark");
            const textColor = isDarkMode ? "#e5e7eb" : "#374151";
            const gridColor = isDarkMode
              ? "rgba(75, 85, 99, 0.2)"
              : "rgba(209, 213, 219, 0.5)";

            const labels = data.map((item) => item.month);
            const values = data.map((item) => item.amount);

            // Create gradient
            const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
            gradient.addColorStop(0, "rgba(52, 211, 153, 0.8)"); // Green  0, 0, rect.height)
            gradient.addColorStop(0, "rgba(52, 211, 153, 0.8)"); // Green
            gradient.addColorStop(1, "rgba(52, 211, 153, 0.1)"); // Transparent green

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
                    borderColor: "rgb(52, 211, 153)",
                    borderWidth: 2,
                    pointBackgroundColor: "rgb(52, 211, 153)",
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
                    backgroundColor: isDarkMode
                      ? "rgba(31, 41, 55, 0.9)"
                      : "rgba(255, 255, 255, 0.9)",
                    titleColor: isDarkMode ? "#e5e7eb" : "#374151",
                    bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
                    borderColor: isDarkMode
                      ? "rgba(75, 85, 99, 0.2)"
                      : "rgba(209, 213, 219, 0.5)",
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
                      callback: (value) => {
                        if (value >= 1000000) {
                          return `$${value / 1000000}M`;
                        }
                        if (value >= 1000) {
                          return `$${value / 1000}K`;
                        }
                        return `$${value}`;
                      },
                    },
                  },
                },
              },
            });
          }
        }}
      />
    </div>
  );
}

// Claims By Product Chart Component
function ClaimsByProductChart({ data }) {
  if (typeof window === "undefined") {
    return (
      <div className="h-full flex items-center justify-center">
        Loading chart...
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <canvas
        id="claimsByProductChart"
        className="h-full w-full"
        ref={(el) => {
          if (el && data) {
            const ctx = el.getContext("2d");

            // Clear previous chart if it exists
            if (window.claimsProductChart) {
              window.claimsProductChart.destroy();
            }

            // Set canvas dimensions for high DPI displays
            const dpr = window.devicePixelRatio || 1;
            const rect = el.getBoundingClientRect();
            el.width = rect.width * dpr;
            el.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            // Draw chart
            const isDarkMode =
              document.documentElement.classList.contains("dark");
            const textColor = isDarkMode ? "#e5e7eb" : "#374151";
            const gridColor = isDarkMode
              ? "rgba(75, 85, 99, 0.2)"
              : "rgba(209, 213, 219, 0.5)";

            const labels = data.map((item) => item.name);
            const approvedValues = data.map((item) => item.amount);

            // Create chart
            window.claimsProductChart = new window.Chart(ctx, {
              type: "bar",
              data: {
                labels: labels,
                datasets: [
                  {
                    label: "Approved Claims",
                    data: approvedValues,
                    backgroundColor: "rgba(52, 211, 153, 0.8)",
                    borderColor: "rgb(52, 211, 153)",
                    borderWidth: 1,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: "top",
                    labels: {
                      color: textColor,
                      padding: 20,
                      usePointStyle: true,
                      pointStyle: "rect",
                    },
                  },
                  tooltip: {
                    backgroundColor: isDarkMode
                      ? "rgba(31, 41, 55, 0.9)"
                      : "rgba(255, 255, 255, 0.9)",
                    titleColor: isDarkMode ? "#e5e7eb" : "#374151",
                    bodyColor: isDarkMode ? "#e5e7eb" : "#374151",
                    borderColor: isDarkMode
                      ? "rgba(75, 85, 99, 0.2)"
                      : "rgba(209, 213, 219, 0.5)",
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                      label: (context) =>
                        `${
                          context.dataset.label
                        }: $${context.raw.toLocaleString()}`,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      color: textColor,
                    },
                  },
                  y: {
                    grid: {
                      color: gridColor,
                    },
                    ticks: {
                      color: textColor,
                      callback: (value) => {
                        if (value >= 1000000) {
                          return `$${value / 1000000}M`;
                        }
                        if (value >= 1000) {
                          return `$${value / 1000}K`;
                        }
                        return `$${value}`;
                      },
                    },
                  },
                },
              },
            });
          }
        }}
      />
    </div>
  );
}

// Active Cover Chart Component
function ActiveCoverChart({ data }) {
  if (typeof window === "undefined") {
    return (
      <div className="h-full flex items-center justify-center">Loading chart...</div>
    );
  }

  return (
    <div className="h-full w-full">
      <canvas
        id="activeCoverChart"
        className="h-full w-full"
        ref={(el) => {
          if (el && data) {
            const ctx = el.getContext("2d");
            if (window.activeCoverChart) {
              window.activeCoverChart.destroy();
            }
            const dpr = window.devicePixelRatio || 1;
            const rect = el.getBoundingClientRect();
            el.width = rect.width * dpr;
            el.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const isDarkMode = document.documentElement.classList.contains("dark");
            const textColor = isDarkMode ? "#e5e7eb" : "#374151";
            const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)";

            const labels = data.map((d) => d.date);
            const values = data.map((d) => d.amount);

            window.activeCoverChart = new window.Chart(ctx, {
              type: "line",
              data: {
                labels,
                datasets: [
                  {
                    label: "Active Cover",
                    data: values,
                    backgroundColor: "rgba(59, 130, 246, 0.4)",
                    borderColor: "rgb(59, 130, 246)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: gridColor,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                  },
                },
                scales: {
                  x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, maxRotation: 45, minRotation: 45 },
                  },
                  y: {
                    grid: { color: gridColor },
                    ticks: {
                      color: textColor,
                      callback: (value) => {
                        if (value >= 1_000_000) return `$${value / 1_000_000}M`;
                        if (value >= 1_000) return `$${value / 1_000}K`;
                        return `$${value}`;
                      },
                    },
                  },
                },
              },
            });
          }
        }}
      />
    </div>
  );
}

// Lapsed Cover Chart Component
function LapsedCoverChart({ data }) {
  if (typeof window === "undefined") {
    return (
      <div className="h-full flex items-center justify-center">Loading chart...</div>
    );
  }

  return (
    <div className="h-full w-full">
      <canvas
        id="lapsedCoverChart"
        className="h-full w-full"
        ref={(el) => {
          if (el && data) {
            const ctx = el.getContext("2d");
            if (window.lapsedCoverChart) {
              window.lapsedCoverChart.destroy();
            }
            const dpr = window.devicePixelRatio || 1;
            const rect = el.getBoundingClientRect();
            el.width = rect.width * dpr;
            el.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const isDarkMode = document.documentElement.classList.contains("dark");
            const textColor = isDarkMode ? "#e5e7eb" : "#374151";
            const gridColor = isDarkMode ? "rgba(75, 85, 99, 0.2)" : "rgba(209, 213, 219, 0.5)";

            const labels = data.map((d) => d.date);
            const values = data.map((d) => d.amount);

            window.lapsedCoverChart = new window.Chart(ctx, {
              type: "bar",
              data: {
                labels,
                datasets: [
                  {
                    label: "Cover Dropped",
                    data: values,
                    backgroundColor: "rgba(239, 68, 68, 0.8)",
                    borderColor: "rgb(239, 68, 68)",
                    borderWidth: 1,
                  },
                ],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: isDarkMode ? "rgba(31, 41, 55, 0.9)" : "rgba(255, 255, 255, 0.9)",
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: gridColor,
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                      label: (ctx) => `$${ctx.raw.toLocaleString()}`,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, maxRotation: 45, minRotation: 45 },
                  },
                  y: {
                    grid: { color: gridColor },
                    ticks: {
                      color: textColor,
                      callback: (value) => {
                        if (value >= 1_000_000) return `$${value / 1_000_000}M`;
                        if (value >= 1_000) return `$${value / 1_000}K`;
                        return `$${value}`;
                      },
                    },
                  },
                },
              },
            });
          }
        }}
      />
    </div>
  );
}
