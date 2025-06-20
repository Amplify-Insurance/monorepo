"use client"
import { useAccount } from "wagmi"
import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { formatCurrency } from "../utils/formatting"
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo"
import { getUsdcDecimals, getCatShareDecimals } from "../../lib/catPool"
export default function CatPoolDeposits({ displayCurrency, refreshTrigger }) {
  const { address } = useAccount()
  const { info, refresh } = useCatPoolUserInfo(address)
  const [valueDecimals, setValueDecimals] = useState(6)
  const [shareDecimals, setShareDecimals] = useState(18)

  useEffect(() => {
    refresh()
  }, [refreshTrigger])

  useEffect(() => {
    async function loadDecimals() {
      try {
        const [valDec, shareDec] = await Promise.all([
          getUsdcDecimals(),
          getCatShareDecimals(),
        ])
        setValueDecimals(valDec)
        setShareDecimals(shareDec)
      } catch {}
    }
    loadDecimals()
  }, [])

  if (!info || info.balance === "0") {
    return <p className="text-gray-500">No deposits in the Cat Pool.</p>
  }

  const shares = Number(ethers.utils.formatUnits(info.balance || "0", shareDecimals))
  let value
  try {
    value = Number(ethers.utils.formatUnits(info.value || "0", valueDecimals))
  } catch {
    value = Number(info.value || 0)
  }

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <div className="inline-block min-w-full align-middle">
        <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Token
                </th>
                <th scope="col" className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Balance
                </th>
                <th scope="col" className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              <tr>
                <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  CATLP
                </td>
                <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white text-right">
                  {shares.toFixed(4)}
                </td>
                <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white text-right">
                  {formatCurrency(value, "USD", displayCurrency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
