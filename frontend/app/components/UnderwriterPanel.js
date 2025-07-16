
"use client"

import { useState, useEffect } from "react"
import { Info, ChevronDown, Filter, HelpCircle } from "lucide-react"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Image from "next/image"
import { useAccount } from "wagmi"
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import CoverageModal from "./CoverageModal"
import usePools from "../../hooks/usePools"
import {
  UNDERLYING_TOKEN_MAP,
  getTokenName,
  getUnderlyingTokenName,
  getUnderlyingTokenLogo,
  getProtocolType
} from "../config/tokenNameMap"
import useYieldAdapters from "../../hooks/useYieldAdapters"
import { YieldPlatform, getYieldPlatformInfo } from "../config/yieldPlatforms"
import { ethers } from "ethers"
import { getProtocolDescription } from "../config/tokenNameMap"
import { getTokenLogo, getProtocolLogo, getProtocolName } from "../config/tokenNameMap"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet"

// Protocol categories
const protocolCategories = [
  { id: "all", name: "All" },
  { id: "lending", name: "Lending" },
  { id: "exchange", name: "Exchanges" },
  { id: "derivatives", name: "Derivatives" },
  { id: "stablecoin", name: "Stablecoins" },
]


export default function UnderwriterPanel({ displayCurrency }) {
  const { address, isConnected } = useAccount()
  const { details } = useUnderwriterDetails(address)
  const { pools, loading } = usePools()
  // Token list should only contain underlying assets used for providing
  // coverage. Previously this also included the protocol tokens which led to
  // multiple USD variants showing up in the dropdown. Filter it down to the
  // actual deposit assets only.
  const tokens = pools
    ? Array.from(
        new Set(pools.map((p) => p.underlyingAsset.toLowerCase())),
      ).map((address) => ({
        address,
        symbol: getTokenName(address),
        name: getTokenName(address),
      }))
    : []
  const [selectedToken, setSelectedToken] = useState(null)
  const tokenDeploymentMap = Object.fromEntries(
    pools.map((p) => [
      (p.underlyingAsset || p.protocolTokenToCover).toLowerCase(),
      p.deployment,
    ]),
  )

  console.log(pools, "selectedToken")


  const selectedDeployment =
    selectedToken && tokenDeploymentMap[selectedToken.address.toLowerCase()]
  const adapters = useYieldAdapters(selectedDeployment)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  const [selectedMarkets, setSelectedMarkets] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false)
  const [selectedYield, setSelectedYield] = useState(null)
  const [yieldDropdownOpen, setYieldDropdownOpen] = useState(false)
  const [yieldInfoOpen, setYieldInfoOpen] = useState(false)

  useEffect(() => {
    if (!selectedToken && tokens && tokens.length > 0) {
      setSelectedToken(tokens[0])
    }
  }, [tokens, selectedToken])

  useEffect(() => {
    if (adapters && adapters.length > 0 && selectedYield == null) {
      setSelectedYield(adapters[0].id)
    }
  }, [adapters, selectedYield])

  useEffect(() => {
    if (selectedYield == null) return
    setSelectedMarkets((prev) =>
      prev.filter((id) => Number(id) !== selectedYield),
    )
  }, [selectedYield])

  useEffect(() => {
    if (!details || !selectedToken || pools.length === 0) return
    const deployment = tokenDeploymentMap[selectedToken.address.toLowerCase()]
    const detail = details.find((d) => d.deployment === deployment)
    if (!detail) {
      setSelectedMarkets([])
      return
    }
    const marketIds = detail.allocatedPoolIds
      .map((pid) => {
        const pool = pools.find(
          (p) =>
            p.deployment === deployment &&
            Number(p.id) === Number(pid) &&
            p.underlyingAsset.toLowerCase() ===
              selectedToken.address.toLowerCase(),
        )
        return pool ? String(pool.id) : null
      })
      .filter((x) => x !== null)
    setSelectedMarkets(Array.from(new Set(marketIds)))
  }, [details, selectedToken, pools])


  const markets = Object.values(
    pools.reduce((acc, pool) => {
      const id = String(pool.id)
      if (!acc[id]) {
        acc[id] = {
          id,
          name: getProtocolName(pool.id),
          description: `${getProtocolDescription(pool.id)}`,
          // Categorise protocol type so the filter works correctly
          // Stablecoin pools should be marked as such; everything else defaults
          // to lending for now.
          category: getProtocolType(pool.id) === 'stablecoin' ? 'stablecoin' : 'lending',
          pools: [],
        }
      }
      acc[id].pools.push({
        token: pool.underlyingAsset,
        coveredToken: pool.protocolTokenToCover,
        premium: Number(pool.premiumRateBps || 0) / 100,
        underwriterYield: Number(pool.underwriterYieldBps || 0) / 100,
        tvl: Number(
          ethers.utils.formatUnits(
            pool.totalCoverageSold,
            pool.protocolTokenDecimals ?? 18,
          ),
        ),
        price: pool.tokenPriceUsd ?? 0,
        deployment: pool.deployment,
      })
      return acc
    }, {})
  )


  if (loading) {
    return <p>Loading markets...</p>
  }

  // Filter markets that support the selected token and category
  const YIELD_TO_PROTOCOL_MAP = {
    [YieldPlatform.AAVE]: 0,
    [YieldPlatform.COMPOUND]: 1,
  }

  const filteredMarkets = selectedToken
    ? markets.filter((market) => {
        const matchesToken = market.pools.some(
          (p) => p.token.toLowerCase() === selectedToken?.address?.toLowerCase(),
        )
        const matchesCategory =
          selectedCategory === "all" || market.category === selectedCategory
        const selectedProtoId = YIELD_TO_PROTOCOL_MAP[selectedYield]
        const notBaseYield =
          selectedProtoId === undefined || Number(market.id) !== selectedProtoId
        return matchesToken && matchesCategory && notBaseYield
      })
    : []

  console.log("Filtered markets:", filteredMarkets)

  // Calculate total yield based on selected markets
  const calculateTotalYield = () => {
    // Return the sum of yields (not weighted average)
    if (!selectedToken) return 0
    return selectedMarkets.reduce((sum, marketId) => {
      const market = markets.find((m) => m.id === marketId)
      if (!market) return sum
      const pool = market.pools.find(
        (p) => p.token.toLowerCase() === selectedToken?.address?.toLowerCase()
      )
      return pool ? sum + pool.underwriterYield : sum
    }, 0)
  }

  const toggleMarket = (marketId) => {
    setSelectedMarkets((prev) => {
      if (prev.includes(marketId)) {
        return prev.filter((id) => id !== marketId)
      } else {
        return [...prev, marketId]
      }
    })
  }

  const handleOpenModal = () => {
    if (selectedMarkets.length > 0 && selectedYield !== null) {
      setModalOpen(true)
    }
  }

  const selectedAdapter = adapters.find((a) => a.id === selectedYield)
  const baseYield = selectedAdapter?.apr || 0
  const totalYield = calculateTotalYield() + baseYield

  if (!isConnected) {
    return (
      <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
        <h3 className="text-lg font-medium text-blue-800 dark:text-blue-300 mb-3">
          Connect your wallet to provide coverage
        </h3>
        <p className="text-blue-600 dark:text-blue-400 mb-4">
          As an underwriter, you can earn yield by providing insurance coverage for DeFi protocols.
        </p>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2" />
            <span className="text-blue-800 dark:text-blue-300 font-medium">
              Select token and protocols to provide coverage for
            </span>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-md px-4 py-2 border border-blue-200 dark:border-blue-800">
            <div className="text-sm text-gray-500 dark:text-gray-400">Total Estimated Yield</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {formatPercentage(totalYield)} APY
            </div>
          </div>
        </div>
      </div>

      {/* Token Selection Dropdown */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Select token to provide coverage with:
        </label>
        <div className="relative">
          <button
            type="button"
            className="relative w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            onClick={() => setTokenDropdownOpen(!tokenDropdownOpen)}
          >
            {selectedToken && (
              <div className="flex items-center">
                <div className="flex-shrink-0 h-6 w-6 mr-2">
                  <Image
                    src={getTokenLogo(selectedToken.address)}
                    alt={selectedToken?.name || ''}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </div>
                <span className="block truncate">
                  {getTokenName(selectedToken.address)}
                </span>
              </div>
            )}
            <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
              <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </span>
          </button>

          {tokenDropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
              {tokens.map((token) => (
                <button
                  key={token.symbol}
                  className={`${token.symbol === selectedToken?.symbol
                    ? "text-white bg-blue-600"
                    : "text-gray-900 dark:text-gray-200"
                    } cursor-default select-none relative py-2 pl-3 pr-9 w-full text-left hover:bg-gray-100 dark:hover:bg-gray-700`}
                  onClick={() => {
                    setSelectedToken(token)
                    setTokenDropdownOpen(false)
                    setSelectedMarkets([])
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-6 w-6 mr-2">
                      <Image
                        src={getTokenLogo(token.address)}
                        alt={token.name}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                    </div>
                    <span
                      className={`block truncate ${token.symbol === selectedToken?.symbol ? "font-medium" : "font-normal"
                        }`}
                    >
                      {token.symbol}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Yield Platform Selection */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Select base yield platform:
          </label>
          <Sheet open={yieldInfoOpen} onOpenChange={setYieldInfoOpen}>
            <SheetTrigger className="ml-2 text-gray-500 hover:text-gray-700">
              <HelpCircle className="w-4 h-4" />
            </SheetTrigger>
            <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
              <SheetHeader>
                <SheetTitle>Base Yield Platform</SheetTitle>
              </SheetHeader>
              <div className="mt-4 text-sm">
                The base yield platform is where your deposit is parked to earn yield until it is needed to pay claims.
              </div>
            </SheetContent>
          </Sheet>
        </div>
        <div className="relative">
          <button
            type="button"
            className="relative w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            onClick={() => setYieldDropdownOpen(!yieldDropdownOpen)}
          >
            {selectedYield !== null && (
              <div className="flex items-center">
                <div className="flex-shrink-0 h-6 w-6 mr-2">
                  <Image
                    src={getYieldPlatformInfo(selectedYield).logo}
                    alt={getYieldPlatformInfo(selectedYield).name}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </div>
                <span className="block truncate">
                  {getYieldPlatformInfo(selectedYield).name}
                </span>
                {selectedAdapter && (
                  <span className="ml-2 text-xs text-gray-500">
                    {selectedAdapter.apr.toFixed(2)}% APR
                  </span>
                )}
              </div>
            )}
            <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
              <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </span>
          </button>

          {yieldDropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
              {adapters.map((adapter) => (
                <button
                  key={adapter.id}
                  className={`${adapter.id === selectedYield ? "text-white bg-blue-600" : "text-gray-900 dark:text-gray-200"} cursor-default select-none relative py-2 pl-3 pr-9 w-full text-left hover:bg-gray-100 dark:hover:bg-gray-700`}
                  onClick={() => {
                    setSelectedYield(adapter.id);
                    setYieldDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-6 w-6 mr-2">
                        <Image
                          src={getYieldPlatformInfo(adapter.id).logo}
                          alt={adapter.name}
                          width={24}
                          height={24}
                          className="rounded-full"
                        />
                      </div>
                      <span className={`block truncate ${adapter.id === selectedYield ? "font-medium" : "font-normal"}`}>{adapter.name}</span>
                    </div>
                    <span className="ml-2 text-xs text-gray-500">{adapter.apr.toFixed(2)}% APR</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Filter */}
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Available protocols for {selectedToken?.symbol || ''}
          </h3>

          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
            >
              <Filter className="h-4 w-4 mr-2" />
              {protocolCategories.find((cat) => cat.id === selectedCategory)?.name || "All"}
              <ChevronDown className="ml-2 h-4 w-4" />
            </button>

            {categoryDropdownOpen && (
              <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10">
                <div className="py-1" role="menu" aria-orientation="vertical">
                  {protocolCategories.map((category) => (
                    <button
                      key={category.id}
                      className={`${category.id === selectedCategory
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                        : "text-gray-700 dark:text-gray-200"
                        } block px-4 py-2 text-sm w-full text-left hover:bg-gray-100 dark:hover:bg-gray-700`}
                      onClick={() => {
                        setSelectedCategory(category.id)
                        setCategoryDropdownOpen(false)
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Protocol Selection */}
      <div className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMarkets.map((market) => {
            const pool = market.pools.find(
              (p) => p.token.toLowerCase() === selectedToken?.address?.toLowerCase()
            )
            if (!pool) return null

            const isSelected = selectedMarkets.includes(market.id)

            return (
              <div
                key={market.id}
                className={`border rounded-lg overflow-hidden ${isSelected ? "border-blue-500 dark:border-blue-400" : "border-gray-200 dark:border-gray-700"
                  }`}
              >
                <div className="p-4 bg-white dark:bg-gray-800">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 mr-3">
                        <Image
                          src={getProtocolLogo(market.id)}
                          alt={market.name}
                          width={40}
                          height={40}
                          className="rounded-full"
                        />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">{market.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">{market.description}</p>
                      </div>
                    </div>
                    <div>
                      <input
                        type="checkbox"
                        id={`market-${market.id}`}
                        checked={isSelected}
                        onChange={() => toggleMarket(market.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Underwriter Yield:</span>
                      <span className="text-sm font-medium text-green-600 dark:text-green-400">
                        {formatPercentage(pool.underwriterYield)} APY
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-sm text-gray-500 dark:text-gray-400">TVL:</span>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {formatCurrency(
                          displayCurrency === 'usd'
                            ? pool.tvl * pool.price
                            : pool.tvl,
                          'USD',
                          displayCurrency,
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Single Provide Cover Button */}
      {selectedMarkets.length > 0 && (
        <div className="mt-6 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                You've selected <span className="font-medium">{selectedMarkets.length}</span> protocol
                {selectedMarkets.length !== 1 ? "s" : ""} to provide coverage for
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Total estimated yield:{" "}
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatPercentage(totalYield)} APY
                </span>
              </p>
            </div>
            <button
              onClick={handleOpenModal}
              className="w-full sm:w-auto py-2.5 px-6 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors shadow-sm"
            >
              Provide Coverage
            </button>
          </div>
        </div>
      )}

      {/* Coverage Modal */}
      {modalOpen && (
        <CoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type="provide"
          protocol={
            selectedMarkets.length > 1 ? "Multiple Protocols" : markets.find((m) => m.id === selectedMarkets[0])?.name
          }
          token={selectedToken?.address || ''}
          premium={0} // Not relevant for providing coverage
          yield={totalYield}
          yieldChoice={selectedYield}
          poolIds={selectedMarkets}
          deployment={
            selectedMarkets.length > 0
              ? markets
                  .find((m) => m.id === selectedMarkets[0])
                  ?.pools.find(
                    (p) =>
                      p.token.toLowerCase() ===
                      selectedToken?.address?.toLowerCase(),
                  )
                  ?.deployment
              : undefined
          }
          selectedMarkets={selectedMarkets.map((id) => {
            const market = markets.find((m) => m.id === id)
            const pool = market?.pools.find(
              (p) =>
                p.token.toLowerCase() ===
                selectedToken?.address?.toLowerCase(),
            )
            return {
              name: market?.name || "",
              yield: pool?.underwriterYield || 0,
            }
          })}
        />
      )}
    </div>
  )
}
