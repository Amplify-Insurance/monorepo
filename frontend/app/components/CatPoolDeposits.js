"use client"
import { useAccount } from "wagmi"
import { ethers } from "ethers"
import { formatCurrency } from "../utils/formatting"
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo"

export default function CatPoolDeposits({ displayCurrency }) {
  const { address } = useAccount()
  const { info } = useCatPoolUserInfo(address)

  if (!info || info.balance === "0") {
    return <p className="text-gray-500">No deposits in the Cat Pool.</p>
  }

  const shares = Number(ethers.utils.formatUnits(info.balance || "0", 18))
  const value = Number(ethers.utils.formatUnits(info.value || "0", 6))

  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-sm text-gray-500">CatShare Balance</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white">{shares.toFixed(4)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-sm text-gray-500">Current Value</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(value, "USD", displayCurrency)}</span>
      </div>
    </div>
  )
}
