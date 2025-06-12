"use client"
import { useState, useEffect } from "react"
import { Shield } from "lucide-react"
import Image from "next/image"
import { formatCurrency, formatPercentage } from "../utils/formatting"
import ManageCoverageModal from "./ManageCoverageModal"
import { useAccount } from "wagmi"
import useUserPolicies from "../../hooks/useUserPolicies"
import usePools from "../../hooks/usePools"
import { ethers } from "ethers"
import { getUnderlyingAssetDecimals } from "../../lib/capitalPool"
import { getTokenName, getTokenLogo, getProtocolLogo, getProtocolName} from "../config/tokenNameMap"


export default function ActiveCoverages({ displayCurrency }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedCoverage, setSelectedCoverage] = useState(null)
  const { address } = useAccount()
  const { policies } = useUserPolicies(address)
  const { pools } = usePools()
  const [underlyingDec, setUnderlyingDec] = useState(6)

  useEffect(() => {
    async function loadDec() {
      try {
        const dec = await getUnderlyingAssetDecimals()
        setUnderlyingDec(Number(dec))
      } catch (err) {
        console.error('Failed to fetch asset decimals', err)
      }
    }
    loadDec()
  }, [])

  console.log("ActiveCoverages - raw policies:", policies) // For debugging the raw data

  const now = Math.floor(Date.now() / 1000)

  const activeCoverages = policies.map((p) => {
    // Convert poolId from hex to a number for comparison
    const policyPoolId = p.poolId?.hex ? parseInt(p.poolId.hex, 16) : null
    if (policyPoolId === null) return null

    const pool = pools.find((pl) => Number(pl.id) === policyPoolId)
    if (!pool) return null

    const protocol = getProtocolName(pool.id)

    // ethers.utils.formatUnits can often handle BigNumber objects directly,
    // but it's safer to pass the hex value.
    const decimals = pool.underlyingAssetDecimals ?? underlyingDec
    const coverageAmount = Number(
      ethers.utils.formatUnits(p.coverage.hex, decimals)
    )

    const capacity = Number(
      ethers.utils.formatUnits(
        BigInt(pool.totalCapitalPledgedToPool) - BigInt(pool.totalCoverageSold),
        decimals
      )
    )

    // Convert timestamps from hex to numbers
    const activationHex = p.activation?.hex || p.start?.hex || '0x0'
    const expiryHex = p.lastPaidUntil?.hex || '0x0'

    const activationTs = parseInt(activationHex, 16)
    const expiryTs = parseInt(expiryHex, 16)

    let status = "active"
    if (now < activationTs) status = "pending"
    else if (expiryTs && now > expiryTs) status = "expired"

    return {
      id: p.id,
      protocol,
      pool: pool.protocolTokenToCover,
      poolName: getTokenName(pool.protocolTokenToCover),
      coverageAmount,
      premium: Number(pool.premiumRateBps || 0) / 100,
      status,
      capacity,
      activation: activationTs,
      expiry: expiryTs,
    }
  }).filter(Boolean)

  console.log("Processed Coverage data:", activeCoverages) // For debugging the processed data


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
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No coverages</h3>
        <p className="text-gray-500 dark:text-gray-400">
          You don't have any insurance coverages. Visit the markets page to purchase coverage.
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
              Starts
            </th>
            <th
              scope="col"
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            >
              Expires
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
                      src={getProtocolLogo(coverage.id)}
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
                      src={getTokenLogo(coverage.pool)}
                      alt={getProtocolName(coverage.poolName)}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                  </div>
                  <div className="text-sm text-gray-900 dark:text-white">{coverage.poolName}</div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {formatCurrency(
                    coverage.coverageAmount,
                    'USD',
                    displayCurrency
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">{formatPercentage(coverage.premium)}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {coverage.activation
                    ? new Date(coverage.activation * 1000).toLocaleDateString()
                    : "-"}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {coverage.expiry
                    ? new Date(coverage.expiry * 1000).toLocaleDateString()
                    : "-"}
                </div>
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
          amount={selectedCoverage.coverageAmount}
          premium={selectedCoverage.premium}
          capacity={selectedCoverage.capacity}
          policyId={selectedCoverage.id}
        />
      )}
    </div>
  )
}
