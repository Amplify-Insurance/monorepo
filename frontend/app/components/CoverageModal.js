"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Info } from "lucide-react"
import { ethers } from "ethers" // v5 namespace import
import { useAccount } from "wagmi"
import { getRiskManagerWithSigner } from "../../lib/riskManager"
import {
  getCapitalPoolWithSigner,
  getUnderlyingAssetBalance,
  getUnderlyingAssetDecimals,
  getUnderlyingAssetAddress,
} from "../../lib/capitalPool"
import { getERC20WithSigner } from "../../lib/erc20"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"
import Modal from "./Modal"

export default function CoverageModal({
  isOpen,
  onClose,
  type,
  protocol,
  token,
  premium,
  yield: underwriterYield,
  poolId,
  poolIds = [],
  selectedMarkets = [],
  capacity = 0,
}) {
  const { address } = useAccount()
  const tokenName = getTokenName(token)

  /* ───── component state ───── */
  const [amount, setAmount] = useState("")
  const [usdValue, setUsdValue] = useState("0")
  const [walletBalance, setWalletBalance] = useState(0)
  const [underlyingDec, setUnderlyingDec] = useState(18)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // FIXED: Restored the missing error state declaration
  const [error, setError] = useState("");

  /* Max amount depends on flow */
  const maxAmount = type === "purchase" ? capacity : walletBalance
  const tokenPrice = 1 // TODO: oracle integration

  /* ───── Fetch wallet balance when providing cover ───── */
  useEffect(() => {
    if (type !== "provide" || !address || !isOpen) return

    const load = async () => {
      try {
        const dec = await getUnderlyingAssetDecimals()
        const bal = await getUnderlyingAssetBalance(address)
        const human = Number(ethers.utils.formatUnits(bal, dec))
        setUnderlyingDec(dec)
        setWalletBalance(human)
      } catch (err) {
        console.error("Failed to fetch wallet balance", err)
        setError("Could not fetch wallet balance.")
      }
    }

    load()
  }, [type, address, isOpen])

  /* ───── Handlers ───── */
  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
      const numValue = parseFloat(value) || 0
      setUsdValue((numValue * tokenPrice).toFixed(2))
    }
  }

  const handleSetMax = () => {
    const maxTokens = maxAmount.toFixed(6)
    setAmount(maxTokens)
    setUsdValue((maxAmount * tokenPrice).toFixed(2))
  }

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return
    setIsSubmitting(true)
    setError("")

    try {
      if (!window.ethereum) throw new Error("Wallet not found")

      const dec = underlyingDec || (await getUnderlyingAssetDecimals())
      const assetAddr = await getUnderlyingAssetAddress()
      const tokenContract = await getERC20WithSigner(assetAddr)
      const signerAddress = await tokenContract.signer.getAddress()

      if (type === "purchase") {
        const rm = await getRiskManagerWithSigner()
        const rmAddress = process.env.NEXT_PUBLIC_RISK_MANAGER_ADDRESS;

        const amountBn = ethers.utils.parseUnits(amount, dec);

        // Estimate first premium for allowance check
        const weeklyPremium = (Number(amount) * (Number(premium) / 100) * 7) / 365
        const premBn = ethers.utils.parseUnits(weeklyPremium.toFixed(dec), dec)
        const allowance = await tokenContract.allowance(
          signerAddress,
          rmAddress
        )

        if (allowance.lt(premBn)) {
          const approveTx = await tokenContract.approve(rmAddress, premBn)
          await approveTx.wait()
        }

        const tx = await rm.purchaseCover(poolId, amountBn)
        await tx.wait()

      } else { // "provide" flow
        const amountBn = ethers.utils.parseUnits(amount, dec)
        const cp = await getCapitalPoolWithSigner()
        const cpAddress = process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS;
        const rm = await getRiskManagerWithSigner()
        const ids = poolIds.length ? poolIds : poolId ? [poolId] : []

        // Approve spending if necessary
        const allowance = await tokenContract.allowance(address, cpAddress)
        if (allowance.lt(amountBn)) {
          const approveTx = await tokenContract.approve(cpAddress, amountBn)
          await approveTx.wait()
        }

        const tx = await cp.deposit(amountBn, 1) // Assume '1' is the correct YieldPlatform enum
        await tx.wait()

        if (ids.length) {
          const tx2 = await rm.allocateCapital(ids)
          await tx2.wait()
        }
      }

      onClose()
    } catch (err) {
      console.error("Failed to submit", err)
      setError(err.reason || "An unknown error occurred. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const estimatedValue = () => {
    const base = parseFloat(amount) || 0
    const rate = type === "purchase" ? premium : underwriterYield
    return ((base * tokenPrice * (rate || 0)) / 100).toFixed(2)
  }

  /* ───── UI ───── */
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${type === "purchase" ? "Purchase Coverage" : "Provide Coverage"} - ${protocol} ${tokenName}`}
    >
      <div className="space-y-6">
        {/* Amount input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount</label>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Info className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">
                Enter the amount of {tokenName} to {type === "purchase" ? "cover" : "provide"}
              </span>
            </div>
          </div>

          <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
            <div className="flex items-center p-3">
              <input
                type="text"
                inputMode="decimal"
                pattern="^\d*\.?\d*$"
                value={amount}
                onChange={handleAmountChange} // Use the handler function
                placeholder="0.00"
                className="w-full bg-transparent text-xl sm:text-2xl font-medium
                   text-gray-900 dark:text-white outline-none"
              />
              <div className="flex items-center ml-2">
                <div className="h-6 w-6 sm:h-8 sm:w-8 mr-2">
                  <Image
                    src={getTokenLogo(token)}
                    alt={tokenName}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                </div>
                <span className="text-base sm:text-lg font-medium text-gray-900 dark:text-white">{tokenName}</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400 mb-1 sm:mb-0">${usdValue}</span>
              <div className="flex items-center justify-between sm:justify-end sm:space-x-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Available: {maxAmount.toFixed(6)}</span>
                <button onClick={handleSetMax} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded ml-2">MAX</button>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction overview */}
        <div>
          <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">Transaction overview</h4>
          <div className="space-y-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300">{type === "purchase" ? "Premium Rate" : "Yield Rate"}</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{type === "purchase" ? premium : underwriterYield}% APY</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300">Estimated {type === "purchase" ? "Cost" : "Yield"} (Annual)</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">${estimatedValue()}</span>
            </div>

            {type === "provide" && selectedMarkets.length > 0 ? (
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-300 block mb-1">Selected Protocols:</span>
                <div className="max-h-32 overflow-y-auto">
                  {selectedMarkets.map((m, i) => (
                    <div key={i} className="flex justify-between items-center py-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300 truncate mr-2">{m.name}</span>
                      <span className="text-green-600 dark:text-green-400 whitespace-nowrap">{m.yield.toFixed(2)}% APY</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-300">Protocol</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">{protocol}</span>
              </div>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            <p>{error}</p>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={handleSubmit}
          className={`w-full py-3 rounded-lg font-medium text-white transition-colors ${amount && parseFloat(amount) > 0 && !isSubmitting
            ? type === "purchase"
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-green-600 hover:bg-green-700"
            : "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"}`}
          disabled={!amount || parseFloat(amount) <= 0 || isSubmitting}
        >
          {isSubmitting
            ? "Submitting..."
            : "Confirm Transaction"}
        </button>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0"><Info className="h-5 w-5 text-blue-600 dark:text-blue-400" /></div>
            <div className="ml-3">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {type === "purchase"
                  ? "Coverage is provided for smart contract risk and will be active immediately after purchase."
                  : "By providing coverage, you're helping secure the DeFi ecosystem while earning yield on your assets."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}