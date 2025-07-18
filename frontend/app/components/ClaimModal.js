"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { AlertTriangle } from "lucide-react"
import Modal from "./Modal"
import { formatCurrency } from "../utils/formatting"
import { getTokenLogo } from "../config/tokenNameMap"
import { getRiskManagerWithSigner } from "../../lib/riskManager"
import { getERC20WithSigner } from "../../lib/erc20"
import { ethers } from "ethers"

export default function ClaimModal({ isOpen, onClose, coverage, onSubmitted }) {
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && coverage) {
      setAmount(String(coverage.coverageAmount))
    }
  }, [isOpen, coverage])

  if (!coverage) return null

  const handleChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
    }
  }

  const handleSetMax = () => {
    setAmount(String(coverage.coverageAmount))
  }

  const handleSubmit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return
    setIsSubmitting(true)
    try {
      const rm = await getRiskManagerWithSigner()
      const tokenContract = await getERC20WithSigner(coverage.pool)
      const signerAddress = await tokenContract.signer.getAddress()
      const coverageBn = ethers.utils.parseUnits(
        amount,
        coverage.underlyingAssetDecimals,
      )
      let protocolCoverageBn = coverageBn
      if (coverage.protocolTokenDecimals > coverage.underlyingAssetDecimals) {
        protocolCoverageBn = coverageBn.mul(
          ethers.BigNumber.from(10).pow(
            coverage.protocolTokenDecimals - coverage.underlyingAssetDecimals,
          ),
        )
      } else if (coverage.protocolTokenDecimals < coverage.underlyingAssetDecimals) {
        protocolCoverageBn = coverageBn.div(
          ethers.BigNumber.from(10).pow(
            coverage.underlyingAssetDecimals - coverage.protocolTokenDecimals,
          ),
        )
      }
      const allowance = await tokenContract.allowance(signerAddress, rm.address)
      if (allowance.lt(protocolCoverageBn)) {
        const approveTx = await tokenContract.approve(rm.address, protocolCoverageBn)
        await approveTx.wait()
      }
      const tx = await rm.processClaim(coverage.id, protocolCoverageBn)
      await tx.wait()
      onSubmitted && onSubmitted()
      onClose()
    } catch (err) {
      console.error("Failed to submit claim", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fee = (Number.parseFloat(amount || 0) * (coverage.claimFeeBps / 10000)) || 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Claim">
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 h-10 w-10">
            <Image
              src={getTokenLogo(coverage.pool)}
              alt={coverage.protocol}
              width={40}
              height={40}
              className="rounded-full"
            />
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {coverage.protocol} {coverage.poolName}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Coverage: {formatCurrency(coverage.coverageAmount)}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Claim Amount
          </label>
          <div className="flex items-center p-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
            <input
              type="text"
              value={amount}
              onChange={handleChange}
              placeholder="0.00"
              className="flex-1 bg-transparent text-2xl font-semibold text-gray-900 dark:text-white outline-none placeholder-gray-400"
            />
            <button
              type="button"
              onClick={handleSetMax}
              className="ml-3 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors"
            >
              MAX
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Max claimable: {formatCurrency(coverage.coverageAmount)}
          </p>
        </div>

        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex space-x-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            Claiming will incur a fee of {coverage.claimFeeBps / 100}% on the claim amount.
          </p>
        </div>

        <div className="flex justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
          <span className="text-gray-600 dark:text-gray-400">Estimated Fee:</span>
          <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(fee)}</span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !amount || Number.parseFloat(amount) <= 0}
          className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSubmitting ? "Submitting..." : "Submit Claim"}
        </button>
      </div>
    </Modal>
  )
}
