"use client"
import { useState } from "react"
import { Shield } from "lucide-react"
import Image from "next/image"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import ManageCoverageModal from "./ManageCoverageModal"

// Mock data for active coverages
const activeCoverages = [
  {
    id: 1,
    protocol: "Aave",
    pool: "ETH",
    coverageAmount: 25000,
    premium: 2.5,
    status: "active",
  },
  {
    id: 2,
    protocol: "Compound",
    pool: "USDC",
    coverageAmount: 50000,
    premium: 1.5,
    status: "active",
  },
]

export default function ActiveCoverages({ displayCurrency }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCoverage, setSelectedCoverage] = useState(null)

  const handleOpenModal = (coverage) => {
    setSelectedCoverage(coverage)
    setModalOpen(true)
  }

  if (activeCoverages.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <Shield className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No active coverages</h3>
        <p className="text-gray-500 dark:text-gray-400">
          You don't have any active insurance coverages. Visit the markets page to purchase coverage.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Protocol
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Pool
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Coverage Amount
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Premium APY
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {activeCoverages.map((coverage) => (
            <tr key={coverage.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-8 w-8 mr-3">
                    <Image
                      src={`/images/protocols/${coverage.protocol.toLowerCase()}.png`}
                      alt={coverage.protocol}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{coverage.protocol}</div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-6 w-6 mr-2">
                    <Image
                      src={`/images/tokens/${coverage.pool.toLowerCase()}.png`}
                      alt={coverage.pool}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                  </div>
                  <div className="text-sm text-gray-900 dark:text-white">{coverage.pool}</div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {formatCurrency(coverage.coverageAmount, coverage.pool, displayCurrency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">{formatPercentage(coverage.premium)}%</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                  {coverage.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                  onClick={() => handleOpenModal(coverage)}
                >
                  Manage
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Manage Coverage Modal */}
      {selectedCoverage && (
        <ManageCoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type="coverage"
          protocol={selectedCoverage.protocol}
          token={selectedCoverage.pool}
          amount={
            selectedCoverage.coverageAmount /
            (selectedCoverage.pool === "ETH"
              ? 3500
              : selectedCoverage.pool === "BTC"
                ? 62000
                : selectedCoverage.pool === "AVAX"
                  ? 21.52
                  : 1)
          }
          premium={selectedCoverage.premium}
        />
      )}
    </div>
  )
}
