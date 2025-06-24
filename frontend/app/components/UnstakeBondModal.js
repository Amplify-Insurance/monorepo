"use client"

import { useState } from "react"
import Image from "next/image"
import { AlertTriangle, Info, Shield, Clock, XCircle, CheckCircle } from "lucide-react"
import { useAccount } from "wagmi"
import { getCommitteeWithSigner } from "../../lib/committee"
import useUserBonds from "../../hooks/useUserBonds"
import Modal from "./Modal"
import { getTxExplorerUrl } from "../utils/explorer"
import { formatDistanceToNow } from "date-fns"

export default function UnstakeBondModal({ isOpen, onClose }) {
  const { address } = useAccount()

  const { bonds, loading, reload } = useUserBonds(address)
  const [selectedBond, setSelectedBond] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const handleWithdrawBond = async () => {
    if (!selectedBond || !selectedBond.canWithdraw) return

    setIsSubmitting(true)
    try {
      const committee = await getCommitteeWithSigner()
      const tx = await committee.resolvePauseBond(selectedBond.id)
      setTxHash(tx.hash)
      await tx.wait()

      // Refresh bonds list
      await reload()
      setSelectedBond(null)
      onClose()
    } catch (err) {
      console.error("Withdraw bond failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case "active":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "slashed":
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case "active":
        return "Active"
      case "slashed":
        return "Slashed"
      default:
        return "Unknown"
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "active":
        return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
      case "slashed":
        return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
      default:
        return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800"
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Withdraw Bond">
      <div className="space-y-6">
        {/* Info Card */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-1">Bond Withdrawal</p>
              <p>
                Select a bond to withdraw. Only full bond amounts can be withdrawn. Slashed bonds cannot be withdrawn.
              </p>
            </div>
          </div>
        </div>

        {/* Bonds List */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Your Bonds</label>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              <span className="ml-2 text-gray-600 dark:text-gray-400">Loading bonds...</span>
            </div>
          ) : bonds.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No bonds found</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {bonds.map((bond) => (
                <div
                  key={bond.id}
                  onClick={() => bond.canWithdraw && setSelectedBond(bond)}
                  className={`p-4 border rounded-xl transition-all duration-200 ${
                    bond.canWithdraw
                      ? "cursor-pointer hover:border-blue-300 dark:hover:border-blue-600"
                      : "cursor-not-allowed opacity-60"
                  } ${
                    selectedBond?.id === bond.id
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Image
                        src={bond.protocolLogo || "/placeholder.svg"}
                        alt={bond.protocol}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            {bond.amount} {bond.symbol}
                          </span>
                          <div
                            className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(bond.status)}`}
                          >
                            {getStatusIcon(bond.status)}
                            <span>{getStatusText(bond.status)}</span>
                          </div>
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {bond.protocol} • Deposited {formatDistanceToNow(bond.depositDate)} ago
                        </div>
                      </div>
                    </div>

                    {selectedBond?.id === bond.id && bond.canWithdraw && (
                      <CheckCircle className="w-5 h-5 text-blue-500" />
                    )}
                  </div>

                  {bond.status === "slashed" && (
                    <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <div className="flex items-start space-x-2">
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-red-800 dark:text-red-200">
                          <p className="font-medium">Bond Slashed</p>
                          <p>
                            {bond.slashAmount} {bond.symbol} has been slashed from this bond. Withdrawal is not
                            available for slashed bonds.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected Bond Details */}
        {selectedBond && (
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Withdrawal Details</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Bond Amount:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {selectedBond.amount} {selectedBond.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Protocol:</span>
                <span className="font-medium text-gray-900 dark:text-white">{selectedBond.protocol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Withdrawal Amount:</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {selectedBond.amount} {selectedBond.symbol}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleWithdrawBond}
          disabled={isSubmitting || !selectedBond || !selectedBond?.canWithdraw}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : selectedBond ? (
            `Withdraw ${selectedBond.amount} ${selectedBond.symbol}`
          ) : (
            "Select a Bond to Withdraw"
          )}
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