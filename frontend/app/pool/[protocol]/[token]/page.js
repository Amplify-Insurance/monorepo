"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import Image from "next/image"
import CoverageModal from "../../../components/CoverageModal"
import usePools from "../../../../hooks/usePools"
import { ethers } from "ethers"
import { formatCurrency, formatPercentage } from "../../../utils/formatting"
import { getTokenName, getTokenLogo } from "../../../config/tokenNameMap"

export default function PoolDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const { pools, loading } = usePools()
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)
  const [provideModalOpen, setProvideModalOpen] = useState(false)

  const protocol = params.protocol
  const token = params.token
  const tokenName = getTokenName(token)

  if (loading) {
    return <p>Loading...</p>
  }

  console.log("Pools data:", pools)

  const pool = pools.find(
    (p) =>
      // String(p.protocolCovered) === protocol &&
      p.protocolTokenToCover.toLowerCase() === token.toLowerCase(),
  )

  if (!pool) return <p className="p-4">Pool not found.</p>

  const name = getTokenName(pool.protocolTokenToCover)
  const tvl = Number(
    ethers.utils.formatUnits(pool.totalCapitalPledgedToPool, pool.underlyingAssetDecimals),
  )
  const premium = Number(pool.premiumRateBps || 0) / 100
  const yieldRate = Number(pool.underwriterYieldBps || 0) / 100

  return (
    <div className="container mx-auto max-w-4xl">
      <button
        onClick={() => router.back()}
        className="flex items-center text-sm mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </button>
      <div className="flex items-center mb-6">
        <Image
          src={getTokenLogo(protocol)}
          alt={name}
          width={40}
          height={40}
          className="rounded-full mr-3"
        />
        <h1 className="text-2xl font-bold">
          {name} - {tokenName}
        </h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 mb-1">TVL</div>
          <div className="text-lg font-medium">{formatCurrency(tvl)}</div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 mb-1">Premium APY</div>
          <div className="text-lg font-medium">{formatPercentage(premium)}</div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 mb-1">Underwriter Yield</div>
          <div className="text-lg font-medium text-green-600">{formatPercentage(yieldRate)}</div>
        </div>
      </div>
      <div className="flex gap-3 mb-6">
        <button
          className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
          onClick={() => setPurchaseModalOpen(true)}
        >
          Purchase Coverage
        </button>
        <button
          className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-md"
          onClick={() => setProvideModalOpen(true)}
        >
          Provide Coverage
        </button>
      </div>
      <CoverageModal
        isOpen={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        type="purchase"
        protocol={name}
        token={token}
        premium={premium}
        yield={yieldRate}
        poolId={pool.id}
      />
      <CoverageModal
        isOpen={provideModalOpen}
        onClose={() => setProvideModalOpen(false)}
        type="provide"
        protocol={name}
        token={token}
        premium={premium}
        yield={yieldRate}
        poolId={pool.id}
      />
    </div>
  )
}
