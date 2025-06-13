"use client"

import { useState } from "react"
import { ethers } from "ethers"
import { getStakingWithSigner } from "../../lib/staking"
import Modal from "./Modal"

export default function BondModal({ isOpen, onClose }) {
  const [poolId, setPoolId] = useState("")
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!amount || poolId === "") return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.depositBond(poolId, ethers.utils.parseUnits(amount, 18))
      await tx.wait()
      setAmount("")
      setPoolId("")
      onClose()
    } catch (err) {
      console.error("Bond deposit failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Deposit Bond">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Pool ID
          </label>
          <input
            type="number"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            placeholder="Pool ID"
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Bond Amount
          </label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !amount || poolId === ""}
          className="w-full py-3 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
        >
          {isSubmitting ? "Processing..." : "Deposit Bond"}
        </button>
      </div>
    </Modal>
  )
}
