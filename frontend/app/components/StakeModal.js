"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import { getStakingWithSigner } from "../../lib/staking"
import { getERC20WithSigner, getTokenDecimals, getTokenSymbol } from "../../lib/erc20"
import Modal from "./Modal"

export default function StakeModal({ isOpen, onClose }) {
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [balance, setBalance] = useState("0")
  const [symbol, setSymbol] = useState("")
  const [decimals, setDecimals] = useState(18)
  const tokenAddress = process.env.NEXT_PUBLIC_STAKING_TOKEN_ADDRESS

  const loadBalance = async () => {
    if (!tokenAddress) return
    try {
      const token = await getERC20WithSigner(tokenAddress)
      const addr = await token.signer.getAddress()
      const dec = await getTokenDecimals(tokenAddress)
      const bal = await token.balanceOf(addr)
      setBalance(ethers.utils.formatUnits(bal, dec))
      setSymbol(await getTokenSymbol(tokenAddress))
      setDecimals(dec)
    } catch {
      setBalance("0")
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadBalance()
    }
  }, [isOpen])

  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
    }
  }

  const handleSetMax = () => {
    setAmount(balance)
  }

  const handleStake = async () => {
    if (!amount) return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.stake(ethers.utils.parseUnits(amount, decimals))
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
          <div className="relative">
            <input
              type="text"
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={handleSetMax}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              MAX
            </button>
          </div>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Balance: {parseFloat(balance).toFixed(4)} {symbol}
          </div>
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
