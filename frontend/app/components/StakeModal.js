"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import Image from "next/image"
import { Info, TrendingUp } from "lucide-react"
import { getStakingWithSigner } from "../../lib/staking"
import { getERC20WithSigner, getTokenDecimals, getTokenSymbol } from "../../lib/erc20"
import { getTokenLogo } from "../config/tokenNameMap"
import Modal from "./Modal"
import { STAKING_TOKEN_ADDRESS } from "../config/deployments"
import { notifyTx } from "../utils/explorer"

export default function StakeModal({ isOpen, onClose }) {
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [balance, setBalance] = useState("0")
  const [symbol, setSymbol] = useState("")
  const [decimals, setDecimals] = useState(18)
  const tokenAddress = STAKING_TOKEN_ADDRESS

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
      const token = await getERC20WithSigner(tokenAddress)
      const value = ethers.utils.parseUnits(amount, decimals)
      const owner = await token.signer.getAddress()
      const allowance = await token.allowance(owner, staking.address)
      if (allowance.lt(value)) {
        const approveTx = await token.approve(staking.address, value)
        await approveTx.wait()
      }
      const tx = await staking.stake(value)
      notifyTx(tx.hash)
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
        {/* Info Card */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-start space-x-2">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Voting Power</p>
              <p>
                Staking locks your governance tokens and mints voting power for protocol governance. You can unstake
                anytime.
              </p>
            </div>
          </div>
        </div>

        {/* Amount Input */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Stake Amount</label>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Balance: {Number.parseFloat(balance).toFixed(4)} {symbol}
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center justify-between p-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
              <div className="flex-1">
                <input
                  type="text"
                  value={amount}
                  onChange={handleAmountChange}
                  placeholder="0.00"
                  className="w-full bg-transparent text-2xl font-semibold text-gray-900 dark:text-white outline-none placeholder-gray-400"
                />
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleSetMax}
                  className="px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  MAX
                </button>
                <div className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  <Image
                    src={getTokenLogo(tokenAddress) || "/placeholder.svg"}
                    alt="token"
                    width={20}
                    height={20}
                    className="rounded-full"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{symbol}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Voting Power Preview */}
        {amount && (
          <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-800 dark:text-green-200">Voting Power</span>
            </div>
            <span className="text-sm font-bold text-green-600 dark:text-green-400">{amount} votes</span>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleStake}
          disabled={isSubmitting || !amount || Number.parseFloat(amount) <= 0}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            "Stake Tokens"
          )}
        </button>
      </div>
    </Modal>
  )
}
