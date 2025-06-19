"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Info } from "lucide-react"
import { ethers } from "ethers" // v5 namespace import
import { useAccount } from "wagmi"
import { getRiskManagerWithSigner } from "../../lib/riskManager"
import { getPoolManagerWithSigner } from "../../lib/poolManager"
import {
  getCapitalPoolWithSigner,
  getUnderlyingAssetDecimals,
} from "../../lib/capitalPool"
import { getERC20WithSigner } from "../../lib/erc20"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"
import { getDeployment } from "../config/deployments"
import useUsdPrice from "../../hooks/useUsdPrice"
import Modal from "./Modal"
import { Slider } from "../../components/ui/slider"
import { formatPercentage } from "../utils/formatting"
import { getTxExplorerUrl } from "../utils/explorer"

export default function CoverageModal({
  isOpen,
  onClose,
  type,
  protocol,
  token,
  premium,
  yield: underwriterYield,
  yieldChoice = 1,
  poolId,
  poolIds = [],
  selectedMarkets = [],
  capacity = 0,
  protocolTokenToCover,
  deployment,
}) {
  const { address } = useAccount()
  const tokenName = getTokenName(token)

  /* ───── component state ───── */
  const [amount, setAmount] = useState("")
  const [usdValue, setUsdValue] = useState("0")
  const [walletBalance, setWalletBalance] = useState(0)
  const [underlyingDec, setUnderlyingDec] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [error, setError] = useState("")

  // Fetch underlying asset decimals whenever the modal opens
  useEffect(() => {
    if (!isOpen) return

    const loadDecimals = async () => {
      try {
        const dep = getDeployment(deployment)
        const dec = await getUnderlyingAssetDecimals(dep.capitalPool)
        setUnderlyingDec(dec)
      } catch (err) {
        console.error("Failed to fetch asset decimals", err)
      }
    }

    loadDecimals()
  }, [isOpen, deployment])

  // Coverage duration state
  const [durationWeeks, setDurationWeeks] = useState(4) // Default to a more common duration
  const [endDate, setEndDate] = useState("")

  // Update end date whenever duration changes
  useEffect(() => {
    const d = new Date()
    d.setDate(d.getDate() + durationWeeks * 7)
    setEndDate(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))
  }, [durationWeeks])

  /* Max amount depends on flow */
  const maxAmount =
    type === "purchase" ? Math.min(capacity, walletBalance) : walletBalance
  const tokenPrice = useUsdPrice(token) || 0

  /* ───── Fetch wallet balance when providing cover ───── */
  useEffect(() => {
    if (type !== "provide" || !address || !isOpen) return

    const load = async () => {
      try {
        const dep = getDeployment(deployment)
        const cp = await getCapitalPoolWithSigner(dep.capitalPool)
        const assetAddr = await cp.underlyingAsset()
        const tokenContract = await getERC20WithSigner(assetAddr)
        const dec = await tokenContract.decimals()
        const bal = await tokenContract.balanceOf(address)
        const human = Number(ethers.utils.formatUnits(bal, dec))
        setUnderlyingDec(dec)
        setWalletBalance(human)
      } catch (err) {
        console.error("Failed to fetch wallet balance", err)
        setError("Could not fetch wallet balance.")
      }
    }

    load()
  }, [type, address, isOpen, deployment])

  /* ───── Fetch wallet balance when purchasing cover ───── */
  useEffect(() => {
    if (type !== "purchase" || !address || !isOpen) return

    const load = async () => {
      try {
        const dep = getDeployment(deployment)
        const cp = await getCapitalPoolWithSigner(dep.capitalPool)
        const assetAddr = await cp.underlyingAsset()
        const tokenContract = await getERC20WithSigner(assetAddr)
        const dec = await tokenContract.decimals()
        const bal = await tokenContract.balanceOf(address)
        const human = Number(ethers.utils.formatUnits(bal, dec))
        setUnderlyingDec(dec)
        setWalletBalance(human)
      } catch (err) {
        console.error("Failed to fetch wallet balance", err)
        setError("Could not fetch wallet balance.")
      }
    }

    load()
  }, [type, address, isOpen, deployment])

  /* ───── Handlers ───── */
  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      const dec = underlyingDec ?? 18
      const parts = value.split(".")
      if (parts[1] && parts[1].length > dec) return

      setAmount(value)
      const numValue = Number.parseFloat(value) || 0
      setUsdValue((numValue * tokenPrice).toFixed(2))
    }
  }

  const handleSetMax = () => {
    const dec = underlyingDec ?? 6
    const maxTokens = maxAmount.toFixed(dec)
    setAmount(maxTokens)
    setUsdValue((maxAmount * tokenPrice).toFixed(2))
  }

  const handleSubmit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return
    setIsSubmitting(true)
    setError("")

    try {
      if (!window.ethereum) throw new Error("Wallet not found")

      const dep = getDeployment(deployment)
      const cp = await getCapitalPoolWithSigner(dep.capitalPool)
      const assetAddr = await cp.underlyingAsset()
      const tokenContract = await getERC20WithSigner(assetAddr)
      const dec = underlyingDec ?? (await tokenContract.decimals())
      const signerAddress = await tokenContract.signer.getAddress()

      if (type === "purchase") {
        const pm = await getPoolManagerWithSigner(dep.poolManager)
        const pmAddress = dep.poolManager

        const amountBn = ethers.utils.parseUnits(amount, dec) // coverage amount

        // Calculate deposit for selected duration
        const weeklyPremium = (Number(amount) * (Number(premium) / 100) * 7) / 365
        const depositTotal = weeklyPremium * durationWeeks
        const depositBn = ethers.utils.parseUnits(depositTotal.toFixed(dec), dec)

        // Ensure sufficient allowance for the premium deposit
        const allowance = await tokenContract.allowance(signerAddress, pmAddress)

        if (allowance.lt(depositBn)) {
          const approveTx = await tokenContract.approve(pmAddress, depositBn)
          await approveTx.wait()
        }

        const tx = await pm.purchaseCover(poolId, amountBn, depositBn)
        setTxHash(tx.hash)
        await tx.wait()
      } else {
        // "provide" flow
        const amountBn = ethers.utils.parseUnits(amount, dec)
        const cp = await getCapitalPoolWithSigner(dep.capitalPool)
        const cpAddress = dep.capitalPool
        const rm = await getRiskManagerWithSigner(dep.riskManager)
        const ids = poolIds.length ? poolIds : poolId ? [poolId] : []

        // Approve spending if necessary
        const allowance = await tokenContract.allowance(address, cpAddress)
        if (allowance.lt(amountBn)) {
          const approveTx = await tokenContract.approve(cpAddress, amountBn)
          await approveTx.wait()
        }

        const tx = await cp.deposit(amountBn, yieldChoice)
        setTxHash(tx.hash)
        await tx.wait()

        if (ids.length) {
          const tx2 = await rm.allocateCapital(ids)
          setTxHash(tx2.hash)
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
    const base = Number.parseFloat(amount) || 0
    const rate = type === "purchase" ? premium : underwriterYield
    if (type === "purchase") {
      const weekly = (base * tokenPrice * (rate || 0) * 7) / (100 * 365)
      return (weekly * durationWeeks).toFixed(2)
    }
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
                onChange={handleAmountChange}
                placeholder="0.00"
                className="w-full bg-transparent text-xl sm:text-2xl font-medium
                   text-gray-900 dark:text-white outline-none"
              />
              <div className="flex items-center ml-2">
                <div className="h-6 w-6 sm:h-8 sm:w-8 mr-2">
                  <Image
                    src={getTokenLogo(token) || "/placeholder.svg"}
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
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Available: {maxAmount.toFixed(underlyingDec ?? 6)}
                </span>
                <button
                  onClick={handleSetMax}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded ml-2"
                >
                  MAX
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Redesigned Duration Selector */}
        {type === "purchase" && (
          <div className="space-y-4">
            <div className="flex justify-between items-baseline mb-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Coverage Duration</label>
              <div className="text-right">
                <span className="font-semibold text-xl text-gray-900 dark:text-white">
                  {durationWeeks} {durationWeeks === 1 ? "Week" : "Weeks"}
                </span>
                <div className="text-xs text-gray-500 dark:text-gray-400">Ends {endDate}</div>
              </div>
            </div>

            <div className="relative px-2 py-4">
              <Slider
                min={1}
                max={52}
                step={1}
                value={[durationWeeks]}
                onValueChange={(v) => setDurationWeeks(v[0])}
                markers={[13, 26, 39]}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-3 px-1">
                <span className="font-medium">1W</span>
                <span className="font-medium">13W</span>
                <span className="font-medium">26W</span>
                <span className="font-medium">39W</span>
                <span className="font-medium">52W</span>
              </div>
            </div>

            <div className="text-center bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">Coverage Period</div>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {durationWeeks} {durationWeeks === 1 ? "Week" : "Weeks"}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">Ends on {endDate}</div>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300 text-center">
                <span className="font-medium">Note:</span> Premiums can fluctuate, so the exact duration is an estimate
                based on the current rate.
              </p>
            </div>
          </div>
        )}

        {/* Transaction overview */}
        <div>
          <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">Transaction overview</h4>
          <div className="space-y-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {type === "purchase" ? "Premium Rate" : "Yield Rate"}
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {formatPercentage(type === "purchase" ? premium : underwriterYield)} APY
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Estimated {type === "purchase" ? `Cost (${durationWeeks}w)` : "Yield (Annual)"}
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">${estimatedValue()}</span>
            </div>

            {type === "provide" && selectedMarkets.length > 0 ? (
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-300 block mb-1">Selected Protocols:</span>
                <div className="max-h-32 overflow-y-auto">
                  {selectedMarkets.map((m, i) => (
                    <div key={i} className="flex justify-between items-center py-1 text-sm">
                      <span className="text-gray-700 dark:text-gray-300 truncate mr-2">{m.name}</span>
                      <span className="text-green-600 dark:text-green-400 whitespace-nowrap">
                        {formatPercentage(m.yield)} APY
                      </span>
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
          className={`w-full py-3 rounded-lg font-medium text-white transition-colors ${
            amount && Number.parseFloat(amount) > 0 && !isSubmitting
              ? type === "purchase"
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-green-600 hover:bg-green-700"
              : "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"
          }`}
          disabled={!amount || Number.parseFloat(amount) <= 0 || isSubmitting}
        >
          {isSubmitting ? "Submitting..." : "Confirm Transaction"}
        </button>
        {txHash && (
          <p className="text-xs text-center mt-2">
            Transaction submitted.{' '}
            <a
              href={getTxExplorerUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on block explorer
            </a>
          </p>
        )}
      </div>
    </Modal>
  )
}
