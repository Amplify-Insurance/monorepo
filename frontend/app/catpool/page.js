"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  getCatPoolWithSigner,
  getUsdcAddress,
  getUsdcDecimals,
} from "../lib/catPool"
import { getERC20WithSigner } from "../lib/erc20"
import { ethers } from "ethers"

export default function CatPoolPage() {
  const { isConnected } = useAccount()
  const [depositAmount, setDepositAmount] = useState("")
  const [withdrawShares, setWithdrawShares] = useState("")
  const [claimTokens, setClaimTokens] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDeposit = async () => {
    if (!depositAmount) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const dec = await getUsdcDecimals()
      const amountBn = ethers.parseUnits(depositAmount, dec)
      const tokenAddr = await getUsdcAddress()
      const token = await getERC20WithSigner(tokenAddr)
      const addr = await token.signer.getAddress()
      const allowance = await token.allowance(
        addr,
        process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
      )
      if (allowance.lt(amountBn)) {
        const approveTx = await token.approve(
          process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
          amountBn,
        )
        await approveTx.wait()
      }
      const tx = await cp.depositLiquidity(amountBn)
      await tx.wait()
      setDepositAmount("")
    } catch (err) {
      console.error("Deposit failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleWithdraw = async () => {
    if (!withdrawShares) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tx = await cp.withdrawLiquidity(ethers.parseUnits(withdrawShares, 18))
      await tx.wait()
      setWithdrawShares("")
    } catch (err) {
      console.error("Withdraw failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClaim = async () => {
    if (!claimTokens) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      const tokens = claimTokens.split(',').map((t) => t.trim()).filter(Boolean)
      const tx = await cp.claimProtocolAssetRewards(tokens)
      await tx.wait()
      setClaimTokens("")
    } catch (err) {
      console.error("Claim failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to manage the Cat Pool</h1>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-lg space-y-6">
      <h1 className="text-3xl font-bold mb-4">Cat Insurance Pool</h1>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-xl font-semibold">Deposit USDC</h2>
        <input
          type="text"
          placeholder="Amount"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          className="w-full p-2 border rounded mb-3 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
        />
        <button
          onClick={handleDeposit}
          disabled={isSubmitting || !depositAmount}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
        >
          Deposit
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-xl font-semibold">Withdraw USDC</h2>
        <input
          type="text"
          placeholder="Shares"
          value={withdrawShares}
          onChange={(e) => setWithdrawShares(e.target.value)}
          className="w-full p-2 border rounded mb-3 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
        />
        <button
          onClick={handleWithdraw}
          disabled={isSubmitting || !withdrawShares}
          className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-xl font-semibold">Claim Protocol Asset Rewards</h2>
        <input
          type="text"
          placeholder="Token addresses (comma separated)"
          value={claimTokens}
          onChange={(e) => setClaimTokens(e.target.value)}
          className="w-full p-2 border rounded mb-3 text-gray-900 dark:text-gray-100 dark:bg-gray-700"
        />
        <button
          onClick={handleClaim}
          disabled={isSubmitting || !claimTokens}
          className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
        >
          Claim
        </button>
      </div>
    </div>
  )
}
