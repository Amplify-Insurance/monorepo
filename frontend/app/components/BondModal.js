"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import Image from "next/image"
import { AlertTriangle, Info, DollarSign, ChevronDown } from "lucide-react"
import { getStakingWithSigner } from "../../lib/staking"
import Modal from "./Modal"
import usePools from "../../hooks/usePools"
import useTokenList from "../../hooks/useTokenList"
import { getProtocolName, getProtocolLogo, getTokenName, getTokenLogo } from "../config/tokenNameMap"

export default function BondModal({ isOpen, onClose }) {
  const { pools } = usePools()
  const tokens = useTokenList(pools)

  const [selectedToken, setSelectedToken] = useState("")
  const [selectedProtocol, setSelectedProtocol] = useState("")
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [maxPayout, setMaxPayout] = useState("0")

  useEffect(() => {
    if (!selectedToken && tokens && tokens.length > 0) {
      setSelectedToken(tokens[0].address)
    }
  }, [tokens, selectedToken])

  useEffect(() => {
    if (!selectedProtocol && pools && pools.length > 0) {
      setSelectedProtocol(String(pools[0].id))
    }
  }, [pools, selectedProtocol])

  // Calculate max payout (2x bond amount)
  useEffect(() => {
    if (amount && Number.parseFloat(amount) > 0) {
      setMaxPayout((Number.parseFloat(amount) * 2).toFixed(4))
    } else {
      setMaxPayout("0")
    }
  }, [amount])

  const handleSubmit = async () => {
    if (!amount || !selectedProtocol || !selectedToken) return
    const pool = pools.find(
      (p) => String(p.id) === selectedProtocol && p.protocolTokenToCover.toLowerCase() === selectedToken.toLowerCase(),
    )
    if (!pool) return
    setIsSubmitting(true)
    try {
      const staking = await getStakingWithSigner()
      const tx = await staking.depositBond(pool.id, ethers.utils.parseUnits(amount, 18))
      await tx.wait()
      setAmount("")
      onClose()
    } catch (err) {
      console.error("Bond deposit failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedTokenData = tokens.find((t) => t.address === selectedToken)
  const selectedPoolData = pools.find((p) => String(p.id) === selectedProtocol)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Deposit Bond">
      <div className="space-y-6">
        {/* Warning Card */}
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p className="font-medium mb-1">Slashing Risk</p>
              <p>
                Your bond may be slashed if voting support is not achieved. Only deposit what you can afford to lose.
              </p>
            </div>
          </div>
        </div>

        {/* Asset Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asset</label>
          <div className="relative">
            <div className="flex items-center space-x-3 p-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 cursor-pointer">
              <Image
                src={getTokenLogo(selectedToken) || "/placeholder.svg"}
                alt={getTokenName(selectedToken)}
                width={24}
                height={24}
                className="rounded-full"
              />
              <select
                className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 focus:outline-none cursor-pointer appearance-none"
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
              >
                {tokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {getTokenName(t.address)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Protocol Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Protocol</label>
          <div className="relative">
            <div className="flex items-center space-x-3 p-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 cursor-pointer">
              <Image
                src={getProtocolLogo(selectedProtocol) || "/placeholder.svg"}
                alt={getProtocolName(selectedProtocol)}
                width={24}
                height={24}
                className="rounded-full"
              />
              <select
                className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 focus:outline-none cursor-pointer appearance-none"
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
              >
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {getProtocolName(p.id)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </div>

        {/* Bond Amount Input */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bond Amount</label>

          <div className="relative">
            <div className="flex items-center justify-between p-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 focus-within:border-green-500 focus-within:ring-2 focus-within:ring-green-500/20">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-semibold text-gray-900 dark:text-white outline-none placeholder-gray-400"
              />
              <div className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                <span className="text-sm font-medium text-gray-900 dark:text-white">ETH</span>
              </div>
            </div>
          </div>
        </div>

        {/* Max Payout Info */}
        {amount && Number.parseFloat(amount) > 0 && (
          <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Max Payout</span>
            </div>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {maxPayout} {selectedTokenData ? getTokenName(selectedTokenData.address) : "ETH"}
            </span>
          </div>
        )}

        {/* Info Card */}
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-2">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium mb-1">Bond Mechanics</p>
              <p>
                Your bond remains locked as collateral until the protocol releases it. Bonds encourage honest
                participation in governance decisions.
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !amount || Number.parseFloat(amount) <= 0}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            "Deposit Bond"
          )}
        </button>
      </div>
    </Modal>
  )
}
