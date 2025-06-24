"use client"

import { useState, useEffect } from "react"
import Modal from "./Modal"
import Image from "next/image"
import { getDeployment } from "../config/deployments"
import { getProtocolLogo, getProtocolName, getTokenName } from "../config/tokenNameMap"
import { getPolicyManagerWithSigner } from "../../lib/policyManager"
import { getTxExplorerUrl } from "../utils/explorer"
import { ethers } from "ethers"

export default function CancelCoverageModal({ isOpen, onClose, coverage }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [premiumInfo, setPremiumInfo] = useState(null)
  const [isCalculating, setIsCalculating] = useState(false)

  const tokenName = coverage ? getTokenName(coverage.pool) : null
  const protocolName = coverage ? coverage.protocol || getProtocolName(coverage.pool) : null
  const protocolLogo = coverage ? coverage.protocolLogo || getProtocolLogo(coverage.pool) : null

  useEffect(() => {
    if (isOpen && coverage) {
      calculatePremiumInfo()
    }
  }, [isOpen, coverage])

  const calculatePremiumInfo = async () => {
    setIsCalculating(true)
    try {
      // Calculate unused premium based on time remaining
      const now = Math.floor(Date.now() / 1000)
      const coverageEnd = coverage.coverageEnd || coverage.endTime
      const coverageStart = coverage.coverageStart || coverage.startTime

      if (now >= coverageEnd) {
        setPremiumInfo({ unusedPremium: "0", unusedPremiumUSD: "0" })
        return
      }

      const totalDuration = coverageEnd - coverageStart
      const remainingDuration = coverageEnd - now
      const unusedRatio = remainingDuration / totalDuration

      const totalPremium = coverage.premium || coverage.totalPremium || "0"
      const unusedPremium = (Number(totalPremium) * unusedRatio).toString()

      // Get token price for USD conversion
      const tokenResponse = await fetch(`/api/prices/${coverage.pool}`)
      const tokenPrice = tokenResponse.ok ? (await tokenResponse.json()).price : 0
      const unusedPremiumUSD = (Number(ethers.utils.formatUnits(unusedPremium, 18)) * tokenPrice).toFixed(2)

      setPremiumInfo({
        unusedPremium: Number(ethers.utils.formatUnits(unusedPremium, 18)).toFixed(6),
        unusedPremiumUSD,
      })
    } catch (err) {
      console.error("Failed to calculate premium info", err)
      setPremiumInfo({ unusedPremium: "0", unusedPremiumUSD: "0" })
    } finally {
      setIsCalculating(false)
    }
  }

  const handleCancel = async () => {
    setIsSubmitting(true)
    try {
      const dep = getDeployment(coverage.deployment)
      const pm = await getPolicyManagerWithSigner(dep.policyManager)
      const tx = await pm.cancelCover(coverage.id, { gasLimit: 500000 })
      setTxHash(tx.hash)
      await tx.wait()
      onClose(true)
    } catch (err) {
      console.error("Failed to cancel coverage", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!coverage) return null

  return (
    <Modal isOpen={isOpen} onClose={() => onClose(false)} title="Cancel Coverage">
      <div className="space-y-6">
        <div className="flex items-center space-x-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <Image
            src={protocolLogo || "/placeholder.svg"}
            alt={protocolName}
            width={40}
            height={40}
            className="rounded-full"
          />
          <div className="flex-1">
            <div className="font-medium text-gray-900 dark:text-white">
              {protocolName} {tokenName}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Coverage ID #{coverage.id}</div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Refund Information</h4>
          {isCalculating ? (
            <div className="text-sm text-blue-700 dark:text-blue-300">Calculating refund amount...</div>
          ) : premiumInfo ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700 dark:text-blue-300">Unused Premium:</span>
                <span className="font-medium text-blue-900 dark:text-blue-100">
                  {premiumInfo.unusedPremium} {tokenName}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-700 dark:text-blue-300">USD Value:</span>
                <span className="font-medium text-blue-900 dark:text-blue-100">${premiumInfo.unusedPremiumUSD}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-blue-700 dark:text-blue-300">Unable to calculate refund amount</div>
          )}
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Warning:</strong> Canceling your coverage will end your protection immediately. You will receive a
            refund for the unused premium portion.
          </p>
        </div>

        {txHash && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-green-800 dark:text-green-200">Transaction Submitted</span>
            </div>
            <a
              href={getTxExplorerUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center mt-2 text-sm text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 underline"
            >
              View on Block Explorer →
            </a>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => onClose(false)}
            className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCancel}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Processing..." : "Confirm Cancellation"}
          </button>
        </div>
      </div>
    </Modal>
  )
}
