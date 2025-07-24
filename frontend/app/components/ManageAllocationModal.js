"use client"
import { useState, useEffect } from "react"
import Modal from "./Modal"
import usePools from "../../hooks/usePools"
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails"
import { useAccount } from "wagmi"
import Image from "next/image"
import Link from "next/link"
import { getProtocolLogo, getProtocolName, getProtocolType } from "../config/tokenNameMap"
import { formatPercentage } from "../utils/formatting"
import { getUnderwriterManagerWithSigner, getUnderwriterManager } from "../../lib/underwriterManager"
import { getDeployment } from "../config/deployments"
import { YieldPlatform } from "../config/yieldPlatforms"
import { getTxExplorerUrl } from "../utils/explorer"

export default function ManageAllocationModal({ isOpen, onClose, deployment }) {
  const { pools } = usePools()
  const { address } = useAccount()
  const { details } = useUnderwriterDetails(address)
  const [selectedDeployment, setSelectedDeployment] = useState(deployment)
  const [filter, setFilter] = useState("all") // "all", "protocols", "stablecoins", "lsts"

  const YIELD_TO_PROTOCOL_MAP = {
    [YieldPlatform.AAVE]: 0,
    [YieldPlatform.COMPOUND]: 1,
  }

  const baseProtocolId = (() => {
    const d = Array.isArray(details) ? details.find((dt) => dt.deployment === selectedDeployment) : details
    return d ? YIELD_TO_PROTOCOL_MAP[d.yieldChoice] : undefined
  })()

  const allPoolsForDeployment = pools
    .filter((p) => p.deployment === selectedDeployment)
    .filter((p) => (baseProtocolId === undefined ? true : Number(p.id) !== baseProtocolId))

  // Filter pools based on selected filter
  const poolsForDeployment = allPoolsForDeployment.filter((pool) => {
    if (filter === "all") return true
    const poolType = getProtocolType(pool.id)
    if (filter === "protocols") return poolType === "protocol"
    if (filter === "stablecoins") return poolType === "stablecoin"
    if (filter === "lsts") return poolType === "lst"
    return true
  })

  const [selectedPools, setSelectedPools] = useState([])
  const [initialPools, setInitialPools] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [showWithdrawalNotice, setShowWithdrawalNotice] = useState(false)
  const [selectionLimit, setSelectionLimit] = useState(4)

  useEffect(() => {
    async function loadLimit() {
      try {
        const dep = getDeployment(selectedDeployment)
        const rm = getUnderwriterManager(dep.underwriterManager, dep.name)
        const lim = await rm.maxAllocationsPerUnderwriter()
        setSelectionLimit(Number(lim.toString()))
      } catch (err) {
        console.error("Failed to load selection limit", err)
      }
    }
    if (selectedDeployment) loadLimit()
  }, [selectedDeployment])

  useEffect(() => {
    if (details) {
      const d = Array.isArray(details) ? details.find((dt) => dt.deployment === selectedDeployment) : details
      const baseId = d ? YIELD_TO_PROTOCOL_MAP[d.yieldChoice] : undefined
      if (d?.allocatedPoolIds) {
        const filtered = d.allocatedPoolIds.filter((pid) => (baseId === undefined ? true : Number(pid) !== baseId))
        setSelectedPools(filtered)
        setInitialPools(filtered)
      } else {
        setSelectedPools([])
        setInitialPools([])
      }
    }
  }, [details, selectedDeployment])

  const togglePool = (id) => {
    const wasSelected = selectedPools.includes(id)

    if (wasSelected) {
      // Deselecting - show withdrawal notice
      setSelectedPools((prev) => prev.filter((p) => p !== id))
      if (initialPools.includes(id)) {
        setShowWithdrawalNotice(true)
      }
    } else {
      // Selecting - check if we're at the limit
      if (selectedPools.length >= selectionLimit) {
        return // Don't allow more than the limit
      }
      setSelectedPools((prev) => [...prev, id])
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const dep = getDeployment(selectedDeployment)
      const rm = await getUnderwriterManagerWithSigner(dep.underwriterManager)
      const toAllocate = selectedPools.filter((p) => !initialPools.includes(p))
      const toDeallocate = initialPools.filter((p) => !selectedPools.includes(p))

      if (toAllocate.length > 0) {
        const tx = await rm.allocateCapital(toAllocate)
        setTxHash(tx.hash)
        await tx.wait()
      }

      if (toDeallocate.length > 0) {
        const signerAddr = await rm.signer.getAddress()
        for (const id of toDeallocate) {
          const pledge = await rm.underwriterPoolPledge(signerAddr, id)
          if (pledge > 0) {
            const reqTx = await rm.requestDeallocateFromPool(id)
            setTxHash(reqTx.hash)
            await reqTx.wait()

            const deTx = await rm.deallocateFromPool(id)
            setTxHash(deTx.hash)
            await deTx.wait()
          }
        }
      }

      onClose()
    } catch (err) {
      console.error("Failed to allocate capital", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const availableDeployments = Array.isArray(details)
    ? details.map((d) => d.deployment)
    : deployment
      ? [deployment]
      : []

  const getFilterCounts = () => {
    const protocolCount = allPoolsForDeployment.filter((p) => getProtocolType(p.id) === "protocol").length
    const stablecoinCount = allPoolsForDeployment.filter((p) => getProtocolType(p.id) === "stablecoin").length
    const lstCount = allPoolsForDeployment.filter((p) => getProtocolType(p.id) === "lst").length
    return { protocolCount, stablecoinCount, lstCount, totalCount: allPoolsForDeployment.length }
  }

  const { protocolCount, stablecoinCount, lstCount, totalCount } = getFilterCounts()

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Protocol Allocation">
      {availableDeployments.length > 1 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asset</label>
          <select
            className="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            value={selectedDeployment}
            onChange={(e) => setSelectedDeployment(e.target.value)}
          >
            {availableDeployments.map((dep) => (
              <option key={dep} value={dep}>
                {dep.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
          <button
            onClick={() => setFilter("all")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              filter === "all"
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            All ({totalCount})
          </button>
          <button
            onClick={() => setFilter("protocols")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              filter === "protocols"
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Protocols ({protocolCount})
          </button>
          <button
            onClick={() => setFilter("stablecoins")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              filter === "stablecoins"
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Stablecoins ({stablecoinCount})
          </button>
          <button
            onClick={() => setFilter("lsts")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              filter === "lsts"
                ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            LSTs ({lstCount})
          </button>
        </div>
      </div>

      {/* Selection Limit Notice */}
      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-lg">
        <div className="flex items-start gap-2">
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
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Selection Limit:</strong> You can select up to {selectionLimit} protocols to underwrite.
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              Currently selected: {selectedPools.length}/{selectionLimit}
            </p>
          </div>
        </div>
      </div>

      {/* Withdrawal Notice */}
      {showWithdrawalNotice && (
        <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-lg">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0"
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
            <div>
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">Withdrawal Notice</h4>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Withdrawing cover from deselected protocols will require a <strong>30-day withdrawal period</strong>.
                During this time, you will continue to earn yield on your position.
              </p>
              <button
                onClick={() => setShowWithdrawalNotice(false)}
                className="mt-2 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protocol List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {poolsForDeployment.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No {filter === "all" ? "" : filter} available for this deployment.</p>
          </div>
        ) : (
          poolsForDeployment.map((pool) => {
            const yieldRate = Number(pool.underwriterYieldBps || 0) / 100
            const isSelected = selectedPools.includes(pool.id)
            const isDisabled = !isSelected && selectedPools.length >= selectionLimit
            const poolType = getProtocolType(pool.id)

            return (
              <div
                key={pool.id}
                className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                  isSelected
                    ? "border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : isDisabled
                      ? "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 opacity-60"
                      : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                }`}
              >
                <div className="flex items-center space-x-3 flex-1">
                  <Image
                    src={getProtocolLogo(pool.id) || "/placeholder.svg"}
                    alt={getProtocolName(pool.id)}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/pool/${pool.id}/${pool.protocolTokenToCover}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {getProtocolName(pool.id)}
                      </Link>
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          poolType === "protocol"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                            : poolType === "stablecoin"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                        }`}
                      >
                        {poolType === "protocol" ? "Protocol" : poolType === "stablecoin" ? "Stablecoin" : "LST"}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                        {formatPercentage(yieldRate)} APY
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                    checked={isSelected}
                    onChange={() => togglePool(pool.id)}
                    disabled={isDisabled}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex justify-between items-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {selectedPools.length > 0 && (
            <span>
              {selectedPools.length} protocol{selectedPools.length !== 1 ? "s" : ""} selected
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Submitting..." : "Save Changes"}
          </button>
        </div>
      </div>

      {txHash && (
        <p className="text-xs text-center mt-2">
          Transaction submitted.{" "}
          <a
            href={getTxExplorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-blue-600 dark:text-blue-400"
          >
            View on block explorer
          </a>
        </p>
      )}
    </Modal>
  )
}
