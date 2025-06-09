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

  /* ───── component state ───── */
  const [amount, setAmount] = useState("")
  const [usdValue, setUsdValue] = useState("0")
  const [walletBalance, setWalletBalance] = useState(0)
  const [underlyingDec, setUnderlyingDec] = useState(18)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

    try {
      if (!window.ethereum) throw new Error("Wallet not found")
      let tx

      if (type === "purchase") {
        // Purchase flow (still passes human-readable units because contract expects it)
        const rm = await getRiskManagerWithSigner()
        tx = await rm.purchaseCover(poolId, amount)
        await tx.wait()
      } else {
        // Provide flow – convert to smallest unit first
        const dec = underlyingDec || (await getUnderlyingAssetDecimals())
        const amountBn = ethers.utils.parseUnits(amount, dec)

        const cp = await getCapitalPoolWithSigner()
        const rm = await getRiskManagerWithSigner()
        const ids = poolIds.length ? poolIds : poolId ? [poolId] : []

        // Approve spending if necessary
        const assetAddr = await getUnderlyingAssetAddress()
        const token = await getERC20WithSigner(assetAddr)
        const allowance = await token.allowance(address, process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS)
        if (allowance.lt(amountBn)) {
          const approveTx = await token.approve(process.env.NEXT_PUBLIC_CAPITAL_POOL_ADDRESS, amountBn)
          await approveTx.wait()
        }

        tx = await cp.deposit(amountBn, 1)
        await tx.wait()

        if (ids.length) {
          const tx2 = await rm.allocateCapital(ids)
          await tx2.wait()
        }
      }

      onClose()
    } catch (err) {
      console.error("Failed to submit", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const estimatedValue = () => {
    const base = parseFloat(amount) || 0
    const rate = type === "purchase" ? premium : underwriterYield
    return ((base * tokenPrice * rate) / 100).toFixed(2)
  }

  /* ───── UI ───── */
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${type === "purchase" ? "Purchase Coverage" : "Provide Coverage"} - ${protocol} ${token}`}
    >
      <div className="space-y-6">
        {/* Amount input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount</label>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Info className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">
                Enter the amount of {token} to {type === "purchase" ? "cover" : "provide"}
              </span>
            </div>
          </div>

          <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
            <div className="flex items-center p-3">
              <input
                type="text"
                inputMode="decimal"           // still shows the numeric keyboard
                pattern="^\d*(\.\d{0,18})?$"  // 0-18 decimals, no leading zeros rule
                value={amount}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  // Allow empty string (user cleared the field) or valid decimal
                  if (val === "" || /^\d*(\.\d{0,18})?$/.test(val)) {
                    setAmount(val)
                  }
                }}
                placeholder="0.00"
                className="w-full bg-transparent text-xl sm:text-2xl font-medium
                   text-gray-900 dark:text-white outline-none"
              />
              <div className="flex items-center ml-2">
                <div className="h-6 w-6 sm:h-8 sm:w-8 mr-2">
                  <Image src={`/images/tokens/${token.toLowerCase()}.png`} alt={token} width={32} height={32} className="rounded-full" />
                </div>
                <span className="text-base sm:text-lg font-medium text-gray-900 dark:text-white">{token}</span>
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

        {/* Info box */}
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

        {/* Action button */}
        <button
          onClick={handleSubmit}
          className={`w-full py-3 rounded-lg font-medium text-white ${amount && parseFloat(amount) > 0
            ? type === "purchase"
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-green-600 hover:bg-green-700"
            : "bg-gray-400 cursor-not-allowed"}`}
          disabled={!amount || parseFloat(amount) <= 0 || isSubmitting}
        >
          {isSubmitting
            ? "Submitting..."
            : amount && parseFloat(amount) > 0
              ? `${type === "purchase" ? "Purchase" : "Provide"} Coverage`
              : "Enter an amount"}
        </button>
      </div>
    </Modal>
  )
}
