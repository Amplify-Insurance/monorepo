"use client"
import { useState } from "react"
import { Clock, AlertTriangle, Info } from "lucide-react"
import Modal from "./Modal"
import { formatCurrency } from "../utils/formatting"

export default function RequestWithdrawalModal({
  isOpen,
  onClose,
  onRequestWithdrawal,
  isSubmitting = false,
  userBalance = 0,
  userValue = 0,
  maxWithdrawal = userBalance,
  displayCurrency = "USD",
  tokenDecimals = 18,
}) {
  const [withdrawalType, setWithdrawalType] = useState("partial")
  const [withdrawalAmount, setWithdrawalAmount] = useState("")
  const [withdrawalPercentage, setWithdrawalPercentage] = useState(25)
  const displayDecimals = Math.min(tokenDecimals, 4)

  const handlePercentageClick = (percentage) => {
    setWithdrawalPercentage(percentage)
    const amount = (userBalance * percentage) / 100
    const capped = Math.min(amount, maxWithdrawal)
    setWithdrawalAmount(capped.toFixed(tokenDecimals))
  }

  const handleAmountChange = (value) => {
    if (value === "") {
      setWithdrawalAmount("")
      setWithdrawalPercentage(0)
      return
    }
    const regex = new RegExp(`^\\d*(\\.\\d{0,${tokenDecimals}})?$`)
    if (!regex.test(value)) return
    const num = Math.min(Number.parseFloat(value), maxWithdrawal)
    if (!isNaN(num)) {
      setWithdrawalAmount(value)
      const percentage = (num / userBalance) * 100
      setWithdrawalPercentage(Math.min(percentage, 100))
    }
  }

  const handleSubmit = () => {
    const rawAmount = withdrawalType === "full" ? userBalance : Number.parseFloat(withdrawalAmount)
    const amount = Math.min(rawAmount, maxWithdrawal)
    onRequestWithdrawal({
      type: withdrawalType,
      amount: amount,
      value: (amount / userBalance) * userValue,
    })
  }

  const effectiveAmount =
    withdrawalType === "full" ? Math.min(userBalance, maxWithdrawal) : Number.parseFloat(withdrawalAmount || 0)
  const withdrawalValue = (effectiveAmount / userBalance) * userValue
  const waitingPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Request Withdrawal">
      <div className="space-y-6">
        {/* Info Card */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-1">Withdrawal Process</p>
              <p>
                Withdrawal requests have a 30-day waiting period to ensure pool stability. You can cancel your request
                at any time during this period.
              </p>
            </div>
          </div>
        </div>

        {/* Withdrawal Type Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Withdrawal Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setWithdrawalType("partial")}
              className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                withdrawalType === "partial"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
              }`}
            >
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white">Partial Withdrawal</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Withdraw a specific amount</p>
              </div>
            </button>
            <button
              onClick={() => setWithdrawalType("full")}
              className={`p-4 rounded-xl border-2 transition-all duration-200 ${
                withdrawalType === "full"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
              }`}
            >
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white">Full Withdrawal</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Withdraw entire position</p>
              </div>
            </button>
          </div>
        </div>

        {/* Partial Withdrawal Controls */}
        {withdrawalType === "partial" && (
          <div className="space-y-4">
            {/* Amount Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Withdrawal Amount
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={withdrawalAmount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0.00"
                  max={Math.min(userBalance, maxWithdrawal)}
                  step={Math.pow(10, -tokenDecimals)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">CATLP</span>
                  <button
                    onClick={() => handleAmountChange(Math.min(userBalance, maxWithdrawal).toString())}
                    className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Available: {userBalance.toFixed(displayDecimals)} CATLP ({formatCurrency(userValue, "USD", displayCurrency)})
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Max withdrawable: {maxWithdrawal.toFixed(displayDecimals)} CATLP ({formatCurrency((maxWithdrawal / userBalance) * userValue, "USD", displayCurrency)})
              </p>
            </div>

            {/* Percentage Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((percentage) => (
                <button
                  key={percentage}
                  onClick={() => handlePercentageClick(percentage)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    Math.abs(withdrawalPercentage - percentage) < 1
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                >
                  {percentage}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Withdrawal Summary */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
          <h4 className="font-medium text-gray-900 dark:text-white mb-3">Withdrawal Summary</h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Withdrawal Amount:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {withdrawalType === "full" ? userBalance.toFixed(displayDecimals) : withdrawalAmount || "0.00"} CATLP
                </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Estimated Value:</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatCurrency(withdrawalValue, "USD", displayCurrency)}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-gray-200 dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400">Available After:</span>
              <span className="font-medium text-gray-900 dark:text-white">{waitingPeriodEnd.toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-semibold mb-1">Important Notice</p>
              <ul className="space-y-1 text-xs">
                <li>• You can cancel your request at any time during the 30-day period</li>
                <li>• Your tokens will continue earning rewards during the waiting period</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleSubmit}
          disabled={
            isSubmitting ||
            (withdrawalType === "partial" && (!withdrawalAmount || Number.parseFloat(withdrawalAmount) <= 0))
          }
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center space-x-2">
              <Clock className="w-4 h-4" />
              <span>Request {withdrawalType === "full" ? "Full" : "Partial"} Withdrawal (30d waiting period)</span>
            </div>
          )}
        </button>
      </div>
    </Modal>
  )
}
