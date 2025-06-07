"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { AlertTriangle, Info, Search } from "lucide-react"
import Image from "next/image"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatCurrency } from "../utils/formatting"
import useUserPolicies from "../hooks/useUserPolicies"
import usePools from "../hooks/usePools"
import { ethers } from "ethers"
import { getCoverPoolWithSigner } from "../../lib/coverPool"

const PROTOCOL_NAMES = {
  1: "Protocol A",
  2: "Protocol B",
  3: "Protocol C",
  4: "Lido stETH",
  5: "Rocket rETH",
}

export default function ClaimsPage() {
  const { address, isConnected } = useAccount()
  const { policies } = useUserPolicies(address)
  const { pools } = usePools()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCoverage, setSelectedCoverage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const activeCoverages = policies
    .map((p) => {
      const pool = pools.find((pl) => Number(pl.id) === Number(p.poolId))
      if (!pool) return null
      const coverageAmount = Number(
        ethers.formatUnits(p.coverage, pool.underlyingAssetDecimals),
      )
      return {
        id: p.id,
        protocol: PROTOCOL_NAMES[pool.protocolCovered] || `Pool ${pool.id}`,
        pool: pool.protocolTokenToCover,
        coverageAmount,
        premium: Number(pool.premiumRateBps || 0) / 100,
        status: "active",
        startDate: new Date(Number(p.activation || p.start) * 1000).toISOString(),
        endDate: new Date(Number(p.lastPaidUntil) * 1000).toISOString(),
      }
    })
    .filter(Boolean)

  // Filter coverages based on search term
  const filteredCoverages = activeCoverages.filter(
    (coverage) =>
      coverage.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      coverage.pool.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleSubmitClaim = async (e) => {
    e.preventDefault()
    if (!selectedCoverage) return
    setIsSubmitting(true)
    try {
      const cp = await getCoverPoolWithSigner()
      const tx = await cp.processClaim(selectedCoverage.id, "0x")
      await tx.wait()
      setShowConfirmation(true)
      setSelectedCoverage(null)
    } catch (err) {
      console.error("Failed to submit claim", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to make a claim</h1>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Make a Claim</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">Submit a claim for your active insurance coverage</p>
      </div>

      {showConfirmation ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-800 mb-4">
            <svg
              className="h-6 w-6 text-green-600 dark:text-green-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-green-800 dark:text-green-300 mb-2">
            Claim Submitted Successfully
          </h2>
          <p className="text-green-700 dark:text-green-400 mb-4">
            Your claim has been submitted, please view your dashboard for the claim summary.
          </p>
          <button
            onClick={() => setShowConfirmation(false)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
          >
            File Another Claim
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Your Active Coverages</h2>

              <div className="mb-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search coverages..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>
              </div>

              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {filteredCoverages.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400">No active coverages found</div>
                ) : (
                  filteredCoverages.map((coverage) => (
                    <div
                      key={coverage.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedCoverage?.id === coverage.id
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                      }`}
                      onClick={() => setSelectedCoverage(coverage)}
                    >
                      <div className="flex items-center mb-2">
                        <div className="flex-shrink-0 h-8 w-8 mr-3">
                          <Image
                            src={`/images/protocols/${coverage.protocol.toLowerCase()}.png`}
                            alt={coverage.protocol}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {coverage.protocol} {coverage.pool}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Expires: {new Date(coverage.endDate).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        Coverage: {formatCurrency(coverage.coverageAmount)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Make a Claim</h2>

              {!selectedCoverage ? (
                <div className="text-center py-8">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
                    <Info className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">Select a Coverage</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Please select an active coverage from the list to make a claim.
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                          Important Information
                        </h3>
                        <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                          <p>
                            Making a claim will incur a 5% fee on the claim value. This fee is non-refundable.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSubmitClaim}>
                    <div className="mb-6">
                      <h3 className="text-base font-medium text-gray-900 dark:text-white mb-2">Selected Coverage</h3>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center mb-3">
                          <div className="flex-shrink-0 h-10 w-10 mr-3">
                            <Image
                              src={`/images/protocols/${selectedCoverage.protocol.toLowerCase()}.png`}
                              alt={selectedCoverage.protocol}
                              width={40}
                              height={40}
                              className="rounded-full"
                            />
                          </div>
                          <div>
                            <div className="text-lg font-medium text-gray-900 dark:text-white">
                              {selectedCoverage.protocol} {selectedCoverage.pool}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              Coverage Period: {new Date(selectedCoverage.startDate).toLocaleDateString()} -{" "}
                              {new Date(selectedCoverage.endDate).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">Coverage Amount</div>
                            <div className="text-lg font-medium text-gray-900 dark:text-white">
                              {formatCurrency(selectedCoverage.coverageAmount)}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">Claim Fee (5%)</div>
                            <div className="text-lg font-medium text-gray-900 dark:text-white">
                              {formatCurrency(selectedCoverage.coverageAmount * 0.05)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="mr-3 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                        onClick={() => setSelectedCoverage(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white ${
                          isSubmitting ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                        }`}
                      >
                        {isSubmitting ? "Submitting..." : "Submit Claim"}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
