"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { ethers } from "ethers"
import { getStakingWithSigner } from "../../lib/staking"
import ProposalsTable from "../components/ProposalsTable"

export default function StakingPage() {
  const { isConnected } = useAccount()
  const [stakeAmount, setStakeAmount] = useState("")
  const [bondAmount, setBondAmount] = useState("")
  const [bondPoolId, setBondPoolId] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleStake = async () => {
    if (!stakeAmount) return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.stake(ethers.utils.parseUnits(stakeAmount, 18))
      await tx.wait()
      setStakeAmount("")
    } catch (err) {
      console.error("Stake failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBond = async () => {
    if (!bondAmount || bondPoolId === "") return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.depositBond(bondPoolId, ethers.utils.parseUnits(bondAmount, 18))
      await tx.wait()
      setBondAmount("")
      setBondPoolId("")
    } catch (err) {
      console.error("Bond deposit failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }


  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-2xl font-bold mb-6">Connect your wallet to participate in governance</h1>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Governance</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">Stake tokens and deposit a bond to participate in governance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Stake Voting Token</h2>
          <input
            type="text"
            placeholder="Amount"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
          <button
            onClick={handleStake}
            disabled={isSubmitting || !stakeAmount}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            Stake
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="text-xl font-semibold">Deposit Bond</h2>
          <input
            type="number"
            placeholder="Pool ID"
            value={bondPoolId}
            onChange={(e) => setBondPoolId(e.target.value)}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
          <input
            type="text"
            placeholder="Bond Amount"
            value={bondAmount}
            onChange={(e) => setBondAmount(e.target.value)}
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
          <button
            onClick={handleBond}
            disabled={isSubmitting || !bondAmount || bondPoolId === ""}
            className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
          >
            Deposit Bond
          </button>
        </div>
      </div>


      <div className="mt-8">
        <ProposalsTable />
      </div>
    </div>
  )
}
