"use client"

import { ConnectButton } from "@rainbow-me/rainbowkit"
import React, { useState, useEffect } from "react"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useAccount } from "wagmi"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import CoverageModal from "./CoverageModal"
import usePools from "../../hooks/usePools"
import { utils as ethersUtils, BigNumber } from "ethers"
import {
  getTokenName,
  getTokenLogo,
  getProtocolName,
  getProtocolLogo,
  getProtocolDescription,
  getProtocolType,
} from "../config/tokenNameMap"

// Risk rating conversion function
const getRiskRatingText = (riskRating) => {
  if (riskRating <= 25) return "Low"
  if (riskRating <= 50) return "Moderate"
  if (riskRating <= 75) return "Elevated"
  return "Speculative"
}

// Risk rating color function
const getRiskRatingColor = (riskRating) => {
  if (riskRating <= 25) return "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/20"
  if (riskRating <= 50) return "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/20"
  if (riskRating <= 75) return "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/20"
  return "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/20"
}

export default function MarketsTable({ displayCurrency, mode = "purchase" }) {
  const { isConnected, address } = useAccount()
  const [expandedMarkets, setExpandedMarkets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)
  const { pools, loading } = usePools()
  const [typeFilter, setTypeFilter] = useState("all") // 'all', 'protocol', 'stablecoin', 'lst'

  const grouped = {}
  for (const pool of pools) {
    const name = getProtocolName(pool.id)
    const protoDec = Number(pool.protocolTokenDecimals ?? 18)
    const premium = Number(pool.premiumRateBps || 0) / 100
    const uwYield = Number(pool.underwriterYieldBps || 0) / 100
    const riskRating = Number(pool.riskRating || 0) // Assuming this exists in pool data

    const pledged = BigNumber.from(pool.totalCapitalPledgedToPool)
    const sold = BigNumber.from(pool.totalCoverageSold)

    const decimals = pool.underlyingAssetDecimals ?? pool.protocolTokenDecimals ?? 18

    const coverageSold = Number(ethersUtils.formatUnits(sold, decimals))

    const capacity = Number(ethersUtils.formatUnits(pledged.sub(sold), decimals))

    const tvlNative = Number(ethersUtils.formatUnits(pool.totalCapitalPledgedToPool, decimals))

    const entry = grouped[pool.id] || {
      id: pool.id,
      name,
      description: `${getProtocolDescription(pool.id)}`,
      tvl: 0,
      coverageSold: 0,
      tokenPriceUsd: pool.tokenPriceUsd ?? 0,
      riskRating: riskRating,
      pools: [],
    }
    entry.tvl += tvlNative
    entry.coverageSold += coverageSold
    entry.pools.push({
      deployment: pool.deployment,
      token: pool.protocolTokenToCover,
      tokenName: getTokenName(pool.protocolTokenToCover),
      premium,
      underwriterYield: uwYield,
      tvl: Number(ethersUtils.formatUnits(pool.totalCoverageSold, protoDec)),
      price: pool.tokenPriceUsd ?? 0,
      capacity,
      riskRating: riskRating,
    })
    grouped[pool.id] = entry
  }

  const markets = Object.values(grouped).map((m) => ({
    ...m,
    coverAvailable: m.tvl - m.coverageSold,
  }))

  const filteredMarkets = markets.filter((m) => {
    const type = getProtocolType(m.id)
    if (typeFilter === "all") return true
    return type === typeFilter
  })

  const toggleMarket = (marketId) => {
    setExpandedMarkets((prev) => (prev.includes(marketId) ? prev.filter((id) => id !== marketId) : [...prev, marketId]))
  }

  const handleOpenModal = (market, pool) => {
    setSelectedPool({ market, pool })
    setModalOpen(true)
  }

  // Calculate premium range for each market
  const getPremiumRange = (market) => {
    const premiums = market.pools.map((pool) => pool.premium)
    const minPremium = Math.min(...premiums)
    const maxPremium = Math.max(...premiums)

    if (minPremium === maxPremium) {
      return `${formatPercentage(minPremium)} `
    }

    return `${formatPercentage(minPremium)} - ${formatPercentage(maxPremium)} APY`
  }

  // Calculate yield range for each market
  const getYieldRange = (market) => {
    const yields = market.pools.map((pool) => pool.underwriterYield)
    const minYield = Math.min(...yields)
    const maxYield = Math.max(...yields)

    if (minYield === maxYield) {
      return `${formatPercentage(minYield)} APY`
    }

    return `${formatPercentage(minYield)} - ${formatPercentage(maxYield)} APY`
  }

  if (loading) {
    return <p>Loading markets...</p>
  }

  console.log("Markets data:", markets)

  return (
    <div>
      {!isConnected && mode === "purchase" && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
          <p className="text-blue-700 dark:text-blue-300 mb-3">Connect your wallet to purchase insurance coverage</p>
          <ConnectButton />
        </div>
      )}



      {/* Market type filter */}
      <div className="mb-4 inline-flex rounded-md shadow-sm">
        {["all", "protocol", "stablecoin", "lst"].map((type, idx, arr) => (
          <button
            key={type}
            type="button"
            className={`px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 focus:z-10 ${
              idx === 0 ? "rounded-l-md" : idx === arr.length - 1 ? "rounded-r-md -ml-px" : "-ml-px"
            } ${
              typeFilter === type
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
            }`}
            onClick={() => setTypeFilter(type)}
          >
            {type === "all" ? "All" : type === "protocol" ? "Protocol" : type === "stablecoin" ? "Stablecoin" : "LSTs"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <div className="overflow-hidden shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
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
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    TVL
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Cover Available
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell"
                  >
                    Risk Rating
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    {mode === "purchase" ? "Premium APY" : "Yield APY"}
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
                {filteredMarkets.map((market) => (
                  <React.Fragment key={market.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10 mr-2 sm:mr-4">
                            <Image
                              src={getProtocolLogo(market.id) || "/placeholder.svg"}
                              alt={market.name}
                              width={40}
                              height={40}
                              className="rounded-full"
                            />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{market.name}</div>
                            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
                              {market.description}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {formatCurrency(
                            displayCurrency === "usd" ? market.tvl * market.tokenPriceUsd : market.tvl,
                            "usd",
                            displayCurrency,
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {formatCurrency(
                            displayCurrency === "usd"
                              ? market.coverAvailable * market.tokenPriceUsd
                              : market.coverAvailable,
                            "usd",
                            displayCurrency,
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden lg:table-cell">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRiskRatingColor(market.riskRating)}`}
                        >
                          {getRiskRatingText(market.riskRating)}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {mode === "purchase" ? getPremiumRange(market) : getYieldRange(market)}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => toggleMarket(market.id)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto"
                        >
                          <span className="hidden sm:inline">
                            {expandedMarkets.includes(market.id) ? "Hide Pools" : "View Pools"}
                          </span>
                          {expandedMarkets.includes(market.id) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded pools section */}
                    {expandedMarkets.includes(market.id) && (
                      <tr>
                        <td colSpan={6} className="px-3 sm:px-6 py-4">
                          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 sm:p-4">
                            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                              Available Pools
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                              {market.pools.map((pool, index) => (
                                <div
                                  key={index}
                                  className="bg-white dark:bg-gray-700 rounded-lg p-3 sm:p-4 border border-gray-200 dark:border-gray-600"
                                >
                                  <div className="flex justify-between items-center mb-3">
                                    <div className="flex items-center">
                                      <div className="flex-shrink-0 h-6 w-6 mr-2">
                                        <Image
                                          src={getTokenLogo(pool.token) || "/placeholder.svg"}
                                          alt={pool.tokenName}
                                          width={24}
                                          height={24}
                                          className="rounded-full"
                                        />
                                      </div>
                                      <span className="font-medium">{getTokenName(pool.token)}</span>
                                    </div>
                                    <span
                                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRiskRatingColor(pool.riskRating)}`}
                                    >
                                      {getRiskRatingText(pool.riskRating)}
                                    </span>
                                  </div>

                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                    TVL:{" "}
                                    {formatCurrency(
                                      displayCurrency === "usd" ? pool.tvl * pool.price : pool.tvl,
                                      "usd",
                                      displayCurrency,
                                    )}
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 mb-4">
                                    <div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">Premium</div>
                                      <div className="font-medium">{formatPercentage(pool.premium)} APY</div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">Underwriter Yield</div>
                                      <div className="font-medium">{formatPercentage(pool.underwriterYield)} APY</div>
                                    </div>
                                  </div>

                                  {mode === "purchase" ? (
                                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                                      <Link
                                        href={`/pool/${market.id}/${pool.token}`}
                                        className="py-2 px-3 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-md flex items-center justify-center transition-colors"
                                      >
                                        Details <ExternalLink className="h-4 w-4 ml-1" />
                                      </Link>
                                      <button
                                        onClick={() => handleOpenModal(market, pool)}
                                        className="py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
                                        disabled={!isConnected}
                                      >
                                        Purchase Cover
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => handleOpenModal(market, pool)}
                                      className="w-full py-2 px-3 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors"
                                      disabled={!isConnected}
                                    >
                                      Provide Cover
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Coverage Modal */}
      {selectedPool && (
        <CoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type={mode === "purchase" ? "purchase" : "provide"}
          protocol={selectedPool.market.name}
          token={selectedPool.pool.token}
          premium={selectedPool.pool.premium}
          yield={selectedPool.pool.underwriterYield}
          capacity={selectedPool.pool.capacity}
          poolId={selectedPool.market.id}
          yieldChoice={1}
          deployment={selectedPool.pool.deployment}
        />
      )}
    </div>
  )
}
