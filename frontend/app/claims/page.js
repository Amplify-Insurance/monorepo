"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { AlertTriangle, Info, Search, HelpCircle } from "lucide-react"
import Image from "next/image"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatCurrency } from "../utils/formatting"
import useUserPolicies from "../../hooks/useUserPolicies"
import usePools from "../../hooks/usePools"
import { getTokenName, getTokenLogo, getProtocolName} from "../config/tokenNameMap"
import { ethers } from "ethers"
import { getRiskManagerWithSigner } from "../../lib/riskManager"
import { getERC20WithSigner } from "../../lib/erc20"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet"

export default function ClaimsPage() {
  const { address, isConnected } = useAccount()
  const { policies } = useUserPolicies(address)
  const { pools } = usePools()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCoverage, setSelectedCoverage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [claimInfoOpen, setClaimInfoOpen] = useState(false)


  const coverages = policies
  .map((p) => {
    // 1. Create a real BigNumber from the object, then get the number
    const poolIdAsNumber = ethers.BigNumber.from(p.poolId).toNumber();
    
    // 2. Find the pool using the correct number
    const pool = pools.find(
      (pl) => Number(pl.id) === poolIdAsNumber
    );

    if (!pool) return null;

    console.log(pool, "this is pool")

    // 3. Do the same for all other BigNumber-like objects
    const coverageAmount = Number(
      ethers.utils.formatUnits(p.coverage, pool.underlyingAssetDecimals)
    );
    
    // Use .from() and .toNumber() for these as well
    const activationTs = ethers.BigNumber.from(p.activation || p.start).toNumber();
    const lastPaidUntilTs = p.lastPaidUntil 
      ? ethers.BigNumber.from(p.lastPaidUntil).toNumber() 
      : 0;

    return {
      id: typeof p.id === 'object' ? ethers.BigNumber.from(p.id).toNumber() : p.id,
      protocol: getProtocolName(pool.id),
      pool: pool.protocolTokenToCover,
      poolName: getTokenName(pool.protocolTokenToCover),
      coverageAmount,
      premium: Number(pool.premiumRateBps || 0) / 100,
      startDate: new Date(activationTs * 1000).toISOString(),
      endDate: new Date(lastPaidUntilTs * 1000).toISOString(),
      isActive: Date.now() / 1000 >= activationTs,
      protocolTokenDecimals: Number(pool.protocolTokenDecimals ?? 18),
      underlyingAssetDecimals: Number(pool.underlyingAssetDecimals ?? 18),
      deployment: pool.deployment,
    };
  })
  .filter(Boolean);

  const activeCoverages = coverages.filter((c) => c.isActive)
  const pendingCoverages = coverages.filter((c) => !c.isActive)

  console.log(pendingCoverages, "coverages")

  // Filter coverages based on search term
  const filteredCoverages = activeCoverages.filter(
    (coverage) =>
      coverage.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      coverage.pool.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const filteredPendingCoverages = pendingCoverages.filter(
    (coverage) =>
      coverage.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      coverage.pool.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleSubmitClaim = async (e) => {
    e.preventDefault()
    if (!selectedCoverage) return
    setIsSubmitting(true)
    try {
      const rm = await getRiskManagerWithSigner()
      const tokenContract = await getERC20WithSigner(selectedCoverage.pool)
      const signerAddress = await tokenContract.signer.getAddress()
      const coverageBn = ethers.utils.parseUnits(
        selectedCoverage.coverageAmount.toString(),
        selectedCoverage.underlyingAssetDecimals,
      )
      let protocolCoverageBn = coverageBn
      if (
        selectedCoverage.protocolTokenDecimals >
        selectedCoverage.underlyingAssetDecimals
      ) {
        protocolCoverageBn = coverageBn.mul(
          ethers.BigNumber.from(10).pow(
            selectedCoverage.protocolTokenDecimals -
              selectedCoverage.underlyingAssetDecimals,
          ),
        )
      } else if (
        selectedCoverage.protocolTokenDecimals <
        selectedCoverage.underlyingAssetDecimals
      ) {
        protocolCoverageBn = coverageBn.div(
          ethers.BigNumber.from(10).pow(
            selectedCoverage.underlyingAssetDecimals -
              selectedCoverage.protocolTokenDecimals,
          ),
        )
      }

      const allowance = await tokenContract.allowance(
        signerAddress,
        rm.address,
      )
      if (allowance.lt(protocolCoverageBn)) {
        const approveTx = await tokenContract.approve(
          rm.address,
          protocolCoverageBn,
        )
        await approveTx.wait()
      }

      const tx = await rm.processClaim(selectedCoverage.id)
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
          <div className="md:col-span-1 space-y-6">
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
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedCoverage?.id === coverage.id
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                        }`}
                      onClick={() => setSelectedCoverage(coverage)}
                    >
                      <div className="flex items-center mb-2">
                        <div className="flex-shrink-0 h-8 w-8 mr-3">
                          <Image
                            src={getTokenLogo(coverage.pool)}
                            alt={coverage.protocol}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {coverage.protocol} {coverage.poolName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {coverage.isActive
                              ? `Expires: ${new Date(coverage.endDate).toLocaleDateString()}`
                              : `Activates: ${new Date(coverage.startDate).toLocaleDateString()}`}
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

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Your Pending Cover</h2>

              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {filteredPendingCoverages.length === 0 ? (
                  <div className="text-center py-4 text-gray-500 dark:text-gray-400">No pending coverages found</div>
                ) : (
                  filteredPendingCoverages.map((coverage) => (
                    <div
                      key={coverage.id}
                      className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex items-center mb-2">
                        <div className="flex-shrink-0 h-8 w-8 mr-3">
                          <Image
                            src={getTokenLogo(coverage.pool)}
                            alt={coverage.protocol}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {coverage.protocol} {coverage.poolName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Activates: {new Date(coverage.startDate).toLocaleDateString()}
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
              <div className="flex items-center mb-4">
                <h2 className="text-lg font-semibold">Make a Claim</h2>
                <Sheet open={claimInfoOpen} onOpenChange={setClaimInfoOpen}>
                  <SheetTrigger className="ml-2 text-gray-500 hover:text-gray-700">
                    <HelpCircle className="w-4 h-4" />
                  </SheetTrigger>
                  <SheetContent side="right" className="w-1/3 sm:max-w-none text-black dark:text-white">
                    <SheetHeader>
                      <SheetTitle>Make a Claim</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4 text-sm">
                      Filing a claim calls <code>processClaim(policyId)</code> on the RiskManager. After review, you receive your coverage minus the claim fee.
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

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
                              src={getTokenLogo(selectedCoverage.pool)}
                              alt={selectedCoverage.protocol}
                              width={40}
                              height={40}
                              className="rounded-full"
                            />
                          </div>
                          <div>
                            <div className="text-lg font-medium text-gray-900 dark:text-white">
                              {selectedCoverage.protocol} {selectedCoverage.poolName}
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
                        className={`px-4 py-2 rounded-md shadow-sm text-sm font-medium text-white ${isSubmitting ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
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
