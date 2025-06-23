"use client"
import { Gift, Info, CheckCircle } from "lucide-react"
import Modal from "./Modal"
import { getTxExplorerUrl } from "../utils/explorer"
import { formatCurrency } from "../utils/formatting"

export default function ClaimRewardsModal({
  isOpen,
  onClose,
  title = "Claim Rewards",
  rewards = [],
  onClaim,
  isSubmitting = false,
  txHash = "",
  description = "Claim your pending rewards",
}) {
  const totalRewardsValue = rewards.reduce((sum, reward) => sum + (reward.value || 0), 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-6">
        {/* Info Card */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-1">Reward Claiming</p>
              <p>{description}</p>
            </div>
          </div>
        </div>

        {/* Rewards Summary */}
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center">
                <Gift className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">Total Rewards</h3>
                <p className="text-sm text-blue-600 dark:text-blue-400">Ready to claim</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                {formatCurrency(totalRewardsValue, "USD", "USD")}
              </p>
              <p className="text-sm text-blue-600 dark:text-blue-400">
                {rewards.length} reward{rewards.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Rewards Breakdown */}
        {rewards.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Reward Breakdown</h4>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
              {rewards.map((reward, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-xs">
                        {reward.symbol?.slice(0, 2) || reward.token?.slice(0, 2) || "R"}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {reward.symbol || reward.token || "Reward"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{reward.type || "Protocol Reward"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{reward.amount || "0.00"}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatCurrency(reward.value || 0, "USD", "USD")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Important Notice */}
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <strong>Note:</strong> Claiming rewards will initiate a blockchain transaction. Make sure you have
            sufficient gas fees in your wallet.
          </p>
        </div>

        {/* Action Button */}
        <button
          onClick={onClaim}
          disabled={isSubmitting || rewards.length === 0}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            <div className="flex items-center justify-center space-x-2">
              <Gift className="w-4 h-4" />
              <span>Claim {formatCurrency(totalRewardsValue, "USD", "USD")} in Rewards</span>
            </div>
          )}
        </button>

        {txHash && (
          <div className="flex items-center justify-center space-x-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-800 dark:text-green-200">
              Transaction submitted.{" "}
              <a
                href={getTxExplorerUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                View on explorer
              </a>
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
