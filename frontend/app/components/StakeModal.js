"use client"

import { useState } from "react"
import { ethers } from "ethers"
import { getStakingWithSigner } from "../../lib/staking"
import Modal from "./Modal"

export default function StakeModal({ isOpen, onClose }) {
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
    }
  }

  const handleStake = async () => {
    if (!amount) return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.stake(ethers.utils.parseUnits(amount, 18))
      await tx.wait()
      setAmount("")
      onClose()
    } catch (err) {
      console.error("Stake failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Stake Voting Token">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Amount
          </label>
          <input
            type="text"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.00"
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <button
          onClick={handleStake}
          disabled={isSubmitting || !amount}
          className="w-full py-3 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? "Processing..." : "Stake"}
        </button>
      </div>
    </Modal>
  )
}
