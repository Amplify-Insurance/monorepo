"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import { getStakingWithSigner } from "../../lib/staking"
import Modal from "./Modal"
import usePools from "../../hooks/usePools"
import useTokenList from "../../hooks/useTokenList"
import { getProtocolName, getTokenName } from "../config/tokenNameMap"

export default function BondModal({ isOpen, onClose }) {
  const { pools } = usePools()
  const tokens = useTokenList(pools)

  const [selectedToken, setSelectedToken] = useState("")
  const [selectedProtocol, setSelectedProtocol] = useState("")
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const handleSubmit = async () => {
    if (!amount || !selectedProtocol || !selectedToken) return
    const pool = pools.find(
      (p) =>
        String(p.id) === selectedProtocol &&
        p.protocolTokenToCover.toLowerCase() === selectedToken.toLowerCase(),
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Deposit Bond">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Asset
          </label>
          <select
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
          >
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {getTokenName(t.address)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Protocol
          </label>
          <select
            className="w-full p-2 border rounded-md dark:bg-gray-700 dark:text-gray-100"
            value={selectedProtocol}
            onChange={(e) => setSelectedProtocol(e.target.value)}
          >
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {getProtocolName(p.id)}
              </option>
            ))}
          </select>
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
          disabled={isSubmitting || !amount}
          className="w-full py-3 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
        >
          {isSubmitting ? "Processing..." : "Deposit Bond"}
        </button>
      </div>
    </Modal>
  )
}
