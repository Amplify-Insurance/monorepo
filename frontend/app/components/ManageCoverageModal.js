"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Info, Plus, Minus } from "lucide-react"
import { getUnderwriterManagerWithSigner } from "../../lib/underwriterManager"
import { getPolicyManagerWithSigner } from "../../lib/policyManager"
import { getCapitalPoolWithSigner, getUnderlyingAssetAddress, getUnderlyingAssetDecimals } from "../../lib/capitalPool"
import { getERC20WithSigner } from "../../lib/erc20"
import useUsdPrice from "../../hooks/useUsdPrice"
import { ethers } from "ethers" // v5 namespace import
import Modal from "./Modal"
import { getTokenName, getTokenLogo, getProtocolName, getProtocolLogo } from "../config/tokenNameMap"
import { Slider } from "../../components/ui/slider"
import { formatPercentage } from "../utils/formatting"
import { getDeployment } from "../config/deployments"
import { getTxExplorerUrl } from "../utils/explorer"

export default function ManageCoverageModal({
  isOpen,
  onClose,
  type,
  protocol,
  token,
  amount,
  premium,
  yield: underwriterYield,
  yieldChoice = 1,
  capacity = 0,
  policyId,
  shares,
  poolId,
  deployment,
  expiry,
}) {
  const [action, setAction] = useState("increase") // increase or decrease
  const tokenName = getTokenName(token)
  const tokenLogoRaw = getTokenLogo(token)
  const tokenLogo = tokenLogoRaw === "/placeholder-logo.png" ? getProtocolLogo(protocol) : tokenLogoRaw
  const [adjustAmount, setAdjustAmount] = useState("")
  const [usdValue, setUsdValue] = useState("0")
  const tokenPrice = useUsdPrice(token) || 0
  const maxAmount = type === "coverage" ? capacity : amount
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [extendWeeks, setExtendWeeks] = useState(1)
  const [endDate, setEndDate] = useState("")
  const weeklyPremiumCost = (Number(amount) * (Number(premium) / 100) * 7) / 365
  const extendCost = weeklyPremiumCost * extendWeeks

  const [increaseAmount, setIncreaseAmount] = useState("")
  const [increaseUsdValue, setIncreaseUsdValue] = useState("0")
  const [actionType, setActionType] = useState("duration") // duration, amount, both

  useEffect(() => {
    if (!expiry) return
    const d = new Date(expiry * 1000)
    d.setDate(d.getDate() + extendWeeks * 7)
    setEndDate(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))
  }, [extendWeeks, expiry])

  // Calculate USD value when amount changes
  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAdjustAmount(value)
      const numValue = Number.parseFloat(value) || 0
      setUsdValue((numValue * tokenPrice).toFixed(2))
    }
  }

  // Set max amount
  const handleSetMax = () => {
    let maxTokens
    if (action === "increase") {
      maxTokens = maxAmount.toFixed(6)
    } else {
      maxTokens = amount
    }
    setAdjustAmount(maxTokens)
    setUsdValue((Number.parseFloat(maxTokens) * tokenPrice).toFixed(2))
  }

  const handleSubmit = async () => {
    if (type !== "coverage" && (!adjustAmount || Number.parseFloat(adjustAmount) <= 0)) return
    setIsSubmitting(true)
    try {
      const depInfo = getDeployment(deployment)
      let tx
      if (type === "coverage") {
        if (!policyId) throw new Error("policyId required")
        const pm = await getPolicyManagerWithSigner(depInfo.policyManager)

        const dec = await getUnderlyingAssetDecimals(depInfo.capitalPool)

        // Handle coverage amount increase if selected
        if (actionType === "amount" || actionType === "both") {
          const increaseBn = ethers.utils.parseUnits(
            increaseAmount,
            dec
          )
          if (increaseBn.gt(0)) {
            const incTx = await pm.increaseCover(policyId, increaseBn)
            setTxHash(incTx.hash)
            await incTx.wait()
          }
        }

        // Handle premium top up when duration or both are selected
        if (actionType === "duration" || actionType === "both") {
          const extraPremium =
            actionType === "both"
              ? ((Number.parseFloat(increaseAmount) || 0) *
                  (Number(premium) / 100) *
                  (extendWeeks * 7)) /
                365
              : 0

          const totalCost = extendCost + extraPremium

          const depositBn = ethers.utils.parseUnits(totalCost.toFixed(dec), dec)

          const assetAddr = await getUnderlyingAssetAddress(depInfo.capitalPool)
          const token = await getERC20WithSigner(assetAddr)
          const addr = await token.signer.getAddress()
          const allowance = await token.allowance(addr, depInfo.policyManager)
          if (allowance.lt(depositBn)) {
            const approveTx = await token.approve(depInfo.policyManager, depositBn)
            await approveTx.wait()
          }

          tx = await pm.addPremium(policyId, depositBn)
          setTxHash(tx.hash)
          await tx.wait()
        }
      } else if (action === "decrease") {
        if (!shares) throw new Error("share info missing")
        const cp = await getCapitalPoolWithSigner(depInfo.capitalPool)
        const rm = await getUnderwriterManagerWithSigner(depInfo.underwriterManager)
        const amount = await cp.sharesToValue(shares)
        tx = await rm.requestWithdrawal(amount)
        setTxHash(tx.hash)
        await tx.wait()
      } else if (action === "increase") {
        if (!poolId) throw new Error("poolId required")
        const depInfo = getDeployment(deployment)
        const cp = await getCapitalPoolWithSigner(depInfo.capitalPool)
        const rm = await getUnderwriterManagerWithSigner(depInfo.underwriterManager)

        const dec = await getUnderlyingAssetDecimals(depInfo.capitalPool)
        const amountBn = ethers.utils.parseUnits(adjustAmount, dec)

        const assetAddr = await getUnderlyingAssetAddress(depInfo.capitalPool)
        const token = await getERC20WithSigner(assetAddr)
        const addr = await token.signer.getAddress()
        const rmAddress = depInfo.underwriterManager
        const allowance = await token.allowance(addr, rmAddress)
        if (allowance.lt(amountBn)) {
          const approveTx = await token.approve(rmAddress, amountBn)
          await approveTx.wait()
        }

        tx = await rm.depositAndAllocate(amountBn, yieldChoice, [poolId])
        setTxHash(tx.hash)
        await tx.wait()
      } else {
        return
      }
      onClose()
    } catch (err) {
      console.error("Failed to submit", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Manage ${type === "coverage" ? "Coverage" : "Position"} - ${getProtocolName(protocol)} ${tokenName}`}
    >
      <div className="space-y-6">
        {/* Current position */}
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current Position</h4>
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <div className="h-8 w-8 mr-2">
                <Image
                  src={tokenLogo || "/placeholder.svg"}
                  alt={tokenName}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              </div>
              <span className="text-base font-medium text-gray-900 dark:text-white">
                {amount} {tokenName}
              </span>
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-300">${(amount * tokenPrice).toFixed(2)}</span>
          </div>
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {type === "coverage" ? "Premium" : "Yield"}:{" "}
            {formatPercentage(type === "coverage" ? premium : underwriterYield)} APY
          </div>
        </div>

        {type === "coverage" && (
          <div>
            {/* Action Type Selector */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                What would you like to extend?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  className={`py-3 px-4 rounded-lg font-medium text-sm ${
                    actionType === "duration"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => setActionType("duration")}
                >
                  Duration Only
                </button>
                <button
                  className={`py-3 px-4 rounded-lg font-medium text-sm ${
                    actionType === "amount"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => setActionType("amount")}
                >
                  Amount Only
                </button>
                <button
                  className={`py-3 px-4 rounded-lg font-medium text-sm ${
                    actionType === "both"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => setActionType("both")}
                >
                  Both
                </button>
              </div>
            </div>

            {/* Duration Extension - show if duration or both */}
            {(actionType === "duration" || actionType === "both") && (
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Extend Duration</label>
                  <div className="text-right">
                    <span className="font-semibold text-base text-gray-900 dark:text-white">
                      {extendWeeks} {extendWeeks === 1 ? "Week" : "Weeks"}
                    </span>
                    <div className="text-xs text-gray-500 dark:text-gray-400">New End {endDate}</div>
                  </div>
                </div>
                <div className="relative">
                  <Slider
                    min={1}
                    max={52}
                    step={1}
                    value={[extendWeeks]}
                    onValueChange={(v) => setExtendWeeks(v[0])}
                    markers={[13, 26, 39]}
                  />
                  <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-2">
                    <span>1W</span>
                    <span>13W</span>
                    <span>26W</span>
                    <span>39W</span>
                    <span>52W</span>
                  </div>
                </div>
              </div>
            )}

            {/* Amount Extension - show if amount or both */}
            {(actionType === "amount" || actionType === "both") && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Additional Coverage Amount
                  </label>
                  <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                    <Info className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Enter additional {tokenName} to cover</span>
                  </div>
                </div>
                <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
                  <div className="flex items-center p-3">
                    <input
                      type="text"
                      value={increaseAmount}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value === "" || /^\d*\.?\d*$/.test(value)) {
                          setIncreaseAmount(value)
                          const numValue = Number.parseFloat(value) || 0
                          setIncreaseUsdValue((numValue * tokenPrice).toFixed(2))
                        }
                      }}
                      placeholder="0.00"
                      className="w-full bg-transparent text-xl sm:text-2xl font-medium text-gray-900 dark:text-white outline-none"
                    />
                    <div className="flex items-center ml-2">
                      <div className="h-6 w-6 sm:h-8 sm:w-8 mr-2">
                        <Image
                          src={tokenLogo || "/placeholder.svg"}
                          alt={tokenName}
                          width={32}
                          height={32}
                          className="rounded-full"
                        />
                      </div>
                      <span className="text-base sm:text-lg font-medium text-gray-900 dark:text-white">
                        {tokenName}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-sm text-gray-500 dark:text-gray-400 mb-1 sm:mb-0">${increaseUsdValue}</span>
                    <div className="flex items-center justify-between sm:justify-end sm:space-x-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Available: {capacity.toFixed(6)}</span>
                      <button
                        onClick={() => {
                          const maxTokens = capacity.toFixed(6)
                          setIncreaseAmount(maxTokens)
                          setIncreaseUsdValue((Number.parseFloat(maxTokens) * tokenPrice).toFixed(2))
                        }}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded ml-2"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {type === "coverage" && (
          <div className="mt-4">
            <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">Transaction overview</h4>
            <div className="space-y-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-300">Premium Rate</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatPercentage(premium)} APY
                </span>
              </div>

              {(actionType === "duration" || actionType === "both") && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Duration Extension ({extendWeeks}w)</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {extendCost.toFixed(2)} {tokenName}
                  </span>
                </div>
              )}

              {(actionType === "amount" || actionType === "both") && increaseAmount && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Amount Extension Premium</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {(
                      ((Number.parseFloat(increaseAmount) || 0) *
                        (Number(premium) / 100) *
                        (actionType === "both" ? extendWeeks * 7 : 365)) /
                      365
                    ).toFixed(2)}{" "}
                    {tokenName}
                  </span>
                </div>
              )}

              <div className="border-t border-gray-200 dark:border-gray-600 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Total Cost</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {(
                      (actionType === "duration" || actionType === "both" ? extendCost : 0) +
                      (actionType === "amount" || (actionType === "both" && increaseAmount)
                        ? ((Number.parseFloat(increaseAmount) || 0) *
                            (Number(premium) / 100) *
                            (actionType === "both" ? extendWeeks * 7 : 365)) /
                          365
                        : 0)
                    ).toFixed(2)}{" "}
                    {tokenName}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-300">New Coverage Amount</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {(
                    Number.parseFloat(amount) +
                    (actionType === "amount" || actionType === "both" ? Number.parseFloat(increaseAmount) || 0 : 0)
                  ).toFixed(2)}{" "}
                  {tokenName}
                </span>
              </div>

              {(actionType === "duration" || actionType === "both") && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-300">New End Date</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{endDate}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action selector */}
        {type !== "coverage" && (
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Action</label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <button
                className={`py-2 rounded-lg font-medium ${
                  action === "increase"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
                onClick={() => setAction("increase")}
              >
                <Plus className="h-4 w-4 inline mr-1" /> Increase
              </button>
              <button
                className={`py-2 rounded-lg font-medium ${
                  action === "decrease"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
                onClick={() => setAction("decrease")}
              >
                <Minus className="h-4 w-4 inline mr-1" /> Decrease
              </button>
            </div>
          </div>
        )}

        {/* Amount input */}
        {type !== "coverage" && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Amount to {action}</label>
              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                <Info className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Enter the amount of {tokenName}</span>
              </div>
            </div>
            <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
              <div className="flex items-center p-3">
                <input
                  type="text"
                  value={adjustAmount}
                  onChange={handleAmountChange}
                  placeholder="0.00"
                  className="w-full bg-transparent text-xl sm:text-2xl font-medium text-gray-900 dark:text-white outline-none"
                />
                <div className="flex items-center ml-2">
                  <div className="h-6 w-6 sm:h-8 sm:w-8 mr-2">
                    <Image
                      src={tokenLogo || "/placeholder.svg"}
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
                    {action === "increase" ? "Available" : "Current"}:{" "}
                    {action === "increase" ? maxAmount.toFixed(6) : amount}
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
        )}

        {/* New position preview */}
        {type !== "coverage" && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Position (Preview)</h4>
            <div className="flex justify-between items-center">
              <span className="text-base font-medium text-gray-900 dark:text-white">
                {action === "increase"
                  ? Number.parseFloat(amount) + Number.parseFloat(adjustAmount || 0)
                  : Math.max(0, Number.parseFloat(amount) - Number.parseFloat(adjustAmount || 0))}{" "}
                {tokenName}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                $
                {(
                  (action === "increase"
                    ? Number.parseFloat(amount) + Number.parseFloat(adjustAmount || 0)
                    : Math.max(0, Number.parseFloat(amount) - Number.parseFloat(adjustAmount || 0))) * tokenPrice
                ).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={handleSubmit}
          className={`w-full py-3 rounded-lg font-medium text-white ${
            !isSubmitting &&
            (
              actionType === "duration" ||
                (actionType === "amount" && increaseAmount && Number.parseFloat(increaseAmount) > 0) ||
                (actionType === "both" && increaseAmount && Number.parseFloat(increaseAmount) > 0)
            )
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-400 cursor-not-allowed"
          }`}
          disabled={
            isSubmitting ||
            (actionType === "amount" && (!increaseAmount || Number.parseFloat(increaseAmount) <= 0)) ||
            (actionType === "both" && (!increaseAmount || Number.parseFloat(increaseAmount) <= 0))
          }
        >
          {isSubmitting
            ? "Submitting..."
            : `Extend Coverage ${
                actionType === "duration" ? "(Duration)" : actionType === "amount" ? "(Amount)" : "(Duration & Amount)"
              }`}
        </button>
        {txHash && (
          <p className="text-xs text-center mt-2">
            Transaction submitted.{" "}
            <a href={getTxExplorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="underline">
              View on block explorer
            </a>
          </p>
        )}
      </div>
    </Modal>
  )
}
