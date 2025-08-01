"use client"
import { useState, useEffect } from "react"
import { Plus, Info, Coins } from "lucide-react"
import Image from "next/image"
import Modal from "./Modal"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"
import { ethers } from "ethers"
import { useAccount } from "wagmi"
import { getCapitalPoolWithSigner } from "../../lib/capitalPool"
import { getERC20WithSigner } from "../../lib/erc20"
import { getUnderwriterManagerWithSigner } from "../../lib/underwriterManager"
import { getDeployment } from "../config/deployments"

export default function IncreasePositionModal({ isOpen, onClose, position, displayCurrency = "USD" }) {
  const { address } = useAccount()
  const [amount, setAmount] = useState("")
  const [walletBalance, setWalletBalance] = useState(0)
  const [assetName, setAssetName] = useState("")
  const [assetLogo, setAssetLogo] = useState("/placeholder.svg")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [error, setError] = useState("")

  const tokenPrice = 1 // Mock price - replace with actual price hook

  useEffect(() => {
    if (!isOpen || !position || !address) return

    const loadBalance = async () => {
      try {
        const dep = getDeployment(position.deployment)
        const cp = await getCapitalPoolWithSigner(dep.capitalPool)
        const assetAddr = await cp.underlyingAsset()
        const tokenContract = await getERC20WithSigner(assetAddr)
        const dec = await tokenContract.decimals()
        const bal = await tokenContract.balanceOf(address)
        const human = Number(ethers.utils.formatUnits(bal, dec))
        setWalletBalance(human)
        setAssetName(getTokenName(assetAddr))
        setAssetLogo(getTokenLogo(assetAddr))
      } catch (err) {
        console.error("Failed to fetch wallet balance", err)
        setError("Could not fetch wallet balance.")
      }
    }

    loadBalance()
  }, [isOpen, position, address])

  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
    }
  }

  const handleSetMax = () => {
    setAmount(walletBalance.toFixed(6))
  }

  const handleSubmit = async () => {
    if (!amount || Number.parseFloat(amount) <= 0) return
    setIsSubmitting(true)
    setError("")

    try {
      const dep = getDeployment(position.deployment)
      const cp = await getCapitalPoolWithSigner(dep.capitalPool)
      const assetAddr = await cp.underlyingAsset()
      const tokenContract = await getERC20WithSigner(assetAddr)
      const dec = await tokenContract.decimals()
      const amountBn = ethers.utils.parseUnits(amount, dec)

      // Approve spending if necessary
      const rmAddress = dep.underwriterManager
      const allowance = await tokenContract.allowance(address, rmAddress)
      if (allowance.lt(amountBn)) {
        const approveTx = await tokenContract.approve(rmAddress, amountBn)
        await approveTx.wait()
      }

      const rm = await getUnderwriterManagerWithSigner(rmAddress)
      const tx = await rm.depositAndAllocate(amountBn, position.yieldChoice, [])
      setTxHash(tx.hash)
      await tx.wait()

      onClose()
    } catch (err) {
      console.error("Failed to increase position", err)
      setError(err.reason || "An unknown error occurred. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const usdValue = (Number.parseFloat(amount) || 0) * tokenPrice
  const newTotalAmount = position ? position.amount + (Number.parseFloat(amount) || 0) : 0
  const newTotalValue = newTotalAmount * tokenPrice

  if (!position) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Increase Position`}>
      <div className="space-y-6">
        {/* Current Position Info */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center space-x-3 mb-3">
            <Coins className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100">All Pools</h4>
              <p className="text-sm text-blue-600 dark:text-blue-400">{assetName}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-blue-600 dark:text-blue-400">Current Position</p>
              <p className="font-semibold text-blue-900 dark:text-blue-100">
                {formatCurrency(
                  displayCurrency === "native" ? position.amount : position.usdValue,
                  "USD",
                  displayCurrency,
                )}
              </p>
            </div>
            <div>
              <p className="text-sm text-blue-600 dark:text-blue-400">Current Yield</p>
              <p className="font-semibold text-blue-900 dark:text-blue-100">{formatPercentage(position.yield)}</p>
            </div>
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Additional Amount</label>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Info className="h-3 w-3 mr-1" />
              <span>Enter additional amount to deposit</span>
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
                className="w-full bg-transparent text-xl font-medium text-gray-900 dark:text-white outline-none"
              />
              <div className="flex items-center ml-2">
                <div className="h-6 w-6 mr-2">
                  <Image
                    src={assetLogo}
                    alt={assetName}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                </div>
                <span className="text-base font-medium text-gray-900 dark:text-white">{assetName}</span>
              </div>
            </div>
            <div className="flex justify-between items-center px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">${usdValue.toFixed(2)}</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Available: {walletBalance.toFixed(6)}</span>
                <button
                  onClick={handleSetMax}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
                >
                  MAX
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* New Position Preview */}
        {amount && Number.parseFloat(amount) > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">New Position Preview</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Current Position:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatCurrency(
                    displayCurrency === "native" ? position.amount : position.usdValue,
                    "USD",
                    displayCurrency,
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Additional Amount:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatCurrency(
                    displayCurrency === "native" ? Number.parseFloat(amount) : usdValue,
                    "USD",
                    displayCurrency,
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-600">
                <span className="text-gray-600 dark:text-gray-400">New Total Position:</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(
                    displayCurrency === "native" ? newTotalAmount : newTotalValue,
                    "USD",
                    displayCurrency,
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            <p>{error}</p>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleSubmit}
          disabled={!amount || Number.parseFloat(amount) <= 0 || isSubmitting}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>Increase Position</span>
            </div>
          )}
        </button>

        {txHash && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Transaction submitted.{" "}
            <a
              href={`https://etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-700 dark:hover:text-gray-300"
            >
              View on block explorer
            </a>
          </p>
        )}
      </div>
    </Modal>
  )
}
