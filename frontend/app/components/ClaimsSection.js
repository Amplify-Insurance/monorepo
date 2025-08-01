"use client"

import { useState } from "react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import Image from "next/image"
import { formatCurrency } from "../utils/formatting"
import { ethers } from "ethers"
import { useAccount } from "wagmi"
import useClaims from "../../hooks/useClaims"
import usePools from "../../hooks/usePools"
import useUnderwriterClaims from "../../hooks/useUnderwriterClaims"
import { getClaimsCollateralManagerWithSigner } from "../../lib/claimsCollateralManager"
import { getTokenName, getTokenLogo } from "../config/tokenNameMap"

export default function ClaimsSection({ displayCurrency }) {
  const [activeTab, setActiveTab] = useState("affected") // 'affected' or 'history'
  const [claimingId, setClaimingId] = useState(null)
  const { address } = useAccount()
  const { claims, refresh: refreshClaims } = useClaims()
  const { pools } = usePools()
  const { positions: affectedPositions, refresh: refreshPositions } = useUnderwriterClaims(address)

  const handleClaimCollateral = async (id) => {
    try {
      setClaimingId(id)
      const manager = await getClaimsCollateralManagerWithSigner()
      const tx = await manager.claimCollateral(id)
      await tx.wait()
      refreshPositions()
      refreshClaims()
    } catch (err) {
      console.error("Claim collateral failed", err)
    } finally {
      setClaimingId(null)
    }
  }

  const claimsData = claims
    .filter((c) => !address || c.claimant.toLowerCase() === address.toLowerCase())
    .map((c) => {
      const pool = pools.find((p) => Number(p.id) === c.poolId)
      if (!pool) return null
      const protocol = getTokenName(pool.protocolTokenToCover)
      const token = pool.protocolTokenToCover
      const tokenName = getTokenName(pool.protocolTokenToCover)
      const amount = Number(
        ethers.utils.formatUnits(
          c.protocolTokenAmountReceived,
          pool.protocolTokenDecimals ?? 18,
        )
      )
      const value = Number(
        ethers.utils.formatUnits(c.netPayoutToClaimant, pool.underlyingAssetDecimals)
      )
      return {
        id: c.policyId,
        protocol,
        token,
        tokenName,
        amount,
        value,
        claimDate: new Date(c.timestamp * 1000).toISOString(),
        status: "processed",
        txHash: c.transactionHash,
      }
    })
    .filter(Boolean)

  const affectedData = affectedPositions.map((p) => {
    const pool = pools.find((pl) => Number(pl.id) === p.poolId)
    const protocol = pool ? getTokenName(pool.protocolTokenToCover) : p.poolId
    const tokenName = getTokenName(p.collateralAsset)
    return {
      id: p.id,
      protocol,
      token: p.collateralAsset,
      tokenName,
      amount: p.amount,
      value: p.amount, // value in native asset unknown
      pendingLoss: p.pendingLoss,
      claimDate: p.claimDate,
      claimed: p.claimed,
    }
  })

  if (claimsData.length === 0 && affectedData.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <AlertTriangle className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No claims</h3>
        <p className="text-gray-500 dark:text-gray-400">You don't have any affected positions or claims history.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
        <ul className="flex flex-wrap -mb-px">
          <li className="mr-2">
            <button
              className={`inline-block p-4 border-b-2 rounded-t-lg ${activeTab === "affected"
                ? "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent hover:text-gray-600 hover:border-gray-300 dark:hover:text-gray-300"
                }`}
              onClick={() => setActiveTab("affected")}
            >
              Affected Positions
            </button>
          </li>
          <li className="mr-2">
            <button
              className={`inline-block p-4 border-b-2 rounded-t-lg ${activeTab === "history"
                ? "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent hover:text-gray-600 hover:border-gray-300 dark:hover:text-gray-300"
                }`}
              onClick={() => setActiveTab("history")}
            >
              Claims History
            </button>
          </li>
        </ul>
      </div>

      {activeTab === "affected" && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                When a claim occurs, your underwriting position is partially or fully swapped with the policyholder's
                position. You now control the potentially affected assets, while the policyholder receives your secure
                assets.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <div className="overflow-hidden shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    Protocol
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    Token
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Value
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Pending Losses
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Claim Status
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    {activeTab === "affected" ? "Claim Date" : "Status"}
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {(activeTab === "affected" ? affectedData : claimsData).map((claim) => (
                  <tr key={claim.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                          <Image
                            src={getTokenLogo(claim.protocol)} 
                            alt={claim.protocol}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        </div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{claim.protocol}</div>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-6 w-6 mr-2">
                          <Image
                            src={getTokenLogo(claim.token)}
                            alt={claim.tokenName}
                            width={24}
                            height={24}
                            className="rounded-full"
                          />
                        </div>
                        <div className="text-sm text-gray-900 dark:text-white">{claim.tokenName}</div>
                      </div>
                      <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                        {displayCurrency === "native"
                          ? `${claim.amount} ${claim.tokenName}`
                          : formatCurrency(claim.value, "USD", "usd")}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {displayCurrency === "native"
                          ? `${claim.amount} ${claim.tokenName}`
                          : formatCurrency(claim.value, "USD", "usd")}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {formatCurrency(claim.value, "USD", displayCurrency)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {formatCurrency(claim.pendingLoss || 0, "USD", displayCurrency)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {claim.claimed ? 'Claimed' : 'Unclaimed'}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      {activeTab === "affected" ? (
                        <div className="text-sm text-gray-900 dark:text-white">
                          {new Date(claim.claimDate).toLocaleDateString()}
                        </div>
                      ) : (
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${claim.status === "approved"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : claim.status === "denied"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                            }`}
                        >
                          {claim.status?.charAt(0).toUpperCase() + claim.status?.slice(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {activeTab === "affected" ? (
                        claim.claimed ? (
                          <span className="text-gray-500">Claimed</span>
                        ) : (
                          <button
                            onClick={() => handleClaimCollateral(claim.id)}
                            disabled={claimingId === claim.id}
                            className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            {claimingId === claim.id ? 'Claiming...' : 'Claim'}
                          </button>
                        )
                      ) : (
                        <a
                          href={`https://etherscan.io/tx/${claim.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 inline-flex items-center"
                        >
                          <span className="hidden sm:inline">View Transaction</span>
                          <span className="sm:hidden">View</span>
                          <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
