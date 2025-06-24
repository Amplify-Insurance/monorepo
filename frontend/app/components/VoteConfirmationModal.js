"use client"
import { X, Vote, AlertCircle } from "lucide-react"
import { useAccount } from "wagmi"

export default function VoteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  proposal,
  voteType,
  votingPower,
  isSubmitting,
}) {
  const { address } = useAccount()

  if (!isOpen || !proposal) return null

  const getVoteTypeInfo = () => {
    switch (voteType) {
      case 2:
        return {
          label: "Vote For",
          color: "text-green-700 dark:text-green-300",
          bgColor: "bg-green-50 dark:bg-green-900/20",
          borderColor: "border-green-200 dark:border-green-800",
          buttonColor: "bg-green-600 hover:bg-green-700",
        }
      case 1:
        return {
          label: "Vote Against",
          color: "text-red-700 dark:text-red-300",
          bgColor: "bg-red-50 dark:bg-red-900/20",
          borderColor: "border-red-200 dark:border-red-800",
          buttonColor: "bg-red-600 hover:bg-red-700",
        }
      case 3:
        return {
          label: "Abstain",
          color: "text-gray-700 dark:text-gray-300",
          bgColor: "bg-gray-50 dark:bg-gray-900/20",
          borderColor: "border-gray-200 dark:border-gray-800",
          buttonColor: "bg-gray-600 hover:bg-gray-700",
        }
      default:
        return {
          label: "Vote",
          color: "text-gray-700 dark:text-gray-300",
          bgColor: "bg-gray-50 dark:bg-gray-900/20",
          borderColor: "border-gray-200 dark:border-gray-800",
          buttonColor: "bg-gray-600 hover:bg-gray-700",
        }
    }
  }

  const voteInfo = getVoteTypeInfo()
  const timeRemaining = Math.max(0, proposal.votingDeadline * 1000 - Date.now())
  const daysRemaining = Math.floor(timeRemaining / (1000 * 60 * 60 * 24))
  const hoursRemaining = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <Vote className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Confirm Vote</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Vote Type Banner */}
          <div className={`rounded-lg p-4 border ${voteInfo.bgColor} ${voteInfo.borderColor}`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${voteType === 1 ? "bg-green-500" : voteType === 0 ? "bg-red-500" : "bg-gray-500"}`}
              ></div>
              <span className={`font-semibold ${voteInfo.color}`}>{voteInfo.label}</span>
            </div>
          </div>

          {/* Proposal Details */}
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Proposal Details</h4>
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Pool ID:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{proposal.poolId}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Action:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {proposal.pauseState ? "Pause Pool" : "Unpause Pool"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Deadline:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {new Date(proposal.votingDeadline * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Voting Power */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Your Voting Power</h4>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                <div className="flex items-center justify-between">
                  <span className="text-purple-700 dark:text-purple-300 font-medium">Tokens:</span>
                  <span className="text-xl font-bold text-purple-900 dark:text-purple-100">
                    {votingPower ? votingPower.toLocaleString() : "0"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-purple-600 dark:text-purple-400">
                  This represents your stake in the protocol
                </div>
              </div>
            </div>

            {/* Current Vote Status */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current Vote Status</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-green-700 dark:text-green-300">{proposal.forVotes}</div>
                  <div className="text-xs text-green-600 dark:text-green-400">For</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-red-700 dark:text-red-300">{proposal.againstVotes}</div>
                  <div className="text-xs text-red-600 dark:text-red-400">Against</div>
                </div>
              </div>
            </div>

            {/* Time Remaining */}
            {timeRemaining > 0 && (
              <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-orange-700 dark:text-orange-300">
                  {daysRemaining > 0 ? `${daysRemaining}d ${hoursRemaining}h` : `${hoursRemaining}h`} remaining to vote
                </span>
              </div>
            )}

            {/* Warning */}
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-700 dark:text-yellow-300">
                  <strong>Important:</strong> Once submitted, your vote cannot be changed. Please review your decision
                  carefully.
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isSubmitting}
              className={`flex-1 px-4 py-2 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${voteInfo.buttonColor}`}
            >
              {isSubmitting ? "Submitting..." : `Confirm ${voteInfo.label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
