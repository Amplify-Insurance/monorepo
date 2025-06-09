"use client"

import { ConnectButton } from '@rainbow-me/rainbowkit';
import React, { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { useAccount } from "wagmi"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import CoverageModal from "./CoverageModal"
import usePools from "../../hooks/usePools"
import { utils as ethersUtils, BigNumber, ethers } from 'ethers';
// import { formatUnits } from 'ethers';
import { getTokenName } from "../config/tokenNameMap";


const PROTOCOL_NAMES = {
  1: "Protocol A",
  2: "Protocol B",
  3: "Protocol C",
  4: "Lido stETH",
  5: "Rocket rETH",
}

export default function MarketsTable({ displayCurrency, mode = "purchase" }) {
  const { isConnected } = useAccount()
  const [expandedMarkets, setExpandedMarkets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)
  const { pools, loading } = usePools()

  console.log(pools, "pools data")

  const markets = pools.map((pool) => {
    const name = PROTOCOL_NAMES[pool.protocolCovered] || `Pool ${pool.id}`
    // const underlyingDec = Number(pool.underlyingAssetDecimals)
    const protoDec = Number(pool.protocolTokenDecimals)
    const premium = Number(pool.premiumRateBps || 0) / 100
    const uwYield = Number(pool.underwriterYieldBps || 0) / 100
    
    const pledged = BigNumber.from(pool.totalCapitalPledgedToPool);
    const sold    = BigNumber.from(pool.totalCoverageSold);
    
    const decimals =
    pool.underlyingAssetDecimals ??
    pool.protocolTokenDecimals   ??   // this one **is** in the payload
    18;                              // sensible default
  
  const capacity = Number(
    ethersUtils.formatUnits(pledged.sub(sold), decimals)
  );

    return {
      id: pool.id,
      name,
      description: `Risk pool for ${pool.protocolTokenToCover}`,
      tvl: Number(ethers.utils.formatUnits(pool.totalCapitalPledgedToPool, decimals)),
      pools: [
        {
          token: pool.protocolTokenToCover,
          tokenName: getTokenName(pool.protocolTokenToCover),
          premium,
          underwriterYield: uwYield,
          tvl: Number(ethers.utils.formatUnits(pool.totalCoverageSold, protoDec)),
          price: 1,
          capacity,
        },
      ],
    }
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
      return `${formatPercentage(minPremium)} APY`
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

  return (
    <div>
      {!isConnected && mode === "purchase" && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
          <p className="text-blue-700 dark:text-blue-300 mb-3">Connect your wallet to purchase insurance coverage</p>
          <ConnectButton />
        </div>
      )}

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
                {markets.map((market) => (
                  <React.Fragment key={market.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10 mr-2 sm:mr-4">
                            <Image
                              src={`/images/protocols/${market.id}.png`}
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
                          {formatCurrency(market.tvl, "usd", "usd")}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {/* Display premium range instead of single value */}
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
                        <td colSpan={4} className="px-3 sm:px-6 py-4">
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
                                          src={`/images/tokens/${pool.token.toLowerCase()}.png`}
                                          alt={pool.tokenName}
                                          width={24}
                                          height={24}
                                          className="rounded-full"
                                        />
                                      </div>
                                      <span className="font-medium">{pool.tokenName}</span>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      TVL: {formatCurrency(pool.tvl, "usd", displayCurrency)}
                                    </div>
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
        />
      )}
    </div>
  )
}
