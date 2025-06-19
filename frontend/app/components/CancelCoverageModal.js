"use client"

import Image from "next/image"
import Modal from "./Modal"
import { getTokenLogo, getTokenName } from "../config/tokenNameMap"
import { formatCurrency } from "../utils/formatting"

export default function CancelCoverageModal({
  isOpen,
  onClose,
  coverage,
  onConfirm,
  cancelling,
  displayCurrency = "USD",
}) {
  if (!coverage) return null

  const tokenName = getTokenName(coverage.pool)
  const tokenLogo = getTokenLogo(coverage.pool)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cancel Coverage">
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 h-10 w-10">
            <Image
              src={coverage.protocolLogo}
              alt={coverage.protocol}
              width={40}
              height={40}
              className="rounded-full"
            />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {coverage.protocol}
            </p>
            <div className="flex items-center space-x-1">
              <Image
                src={tokenLogo}
                alt={tokenName}
                width={16}
                height={16}
                className="rounded-full"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {tokenName}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Coverage Amount
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {formatCurrency(
                coverage.coverageAmount,
                "USD",
                displayCurrency
              )}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm text-gray-600 dark:text-gray-300">Premium</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {coverage.premium}% APY
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Canceling will stop your coverage immediately and refund any remaining
          premium.
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            Keep Coverage
          </button>
          <button
            onClick={onConfirm}
            disabled={cancelling}
            className="px-4 py-2 rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            {cancelling ? "Cancelling..." : "Confirm Cancel"}
          </button>
        </div>
      </div>
    </Modal>
  )
}
