"use client"
import { useState, useEffect } from "react"
import { ethers } from "ethers"
import Image from "next/image"
import { Info, AlertTriangle, Clock, TrendingUp } from "lucide-react"
import Modal from "./Modal"
import { getCatPoolWithSigner, getUsdcAddress, getUsdcDecimals, getCatShareAddress } from "../../lib/catPool"
import { getERC20WithSigner, getTokenDecimals } from "../../lib/erc20"
import { getTokenLogo } from "../config/tokenNameMap"

export default function CatPoolModal({
  isOpen,
  onClose,
  mode,
  token,
  apr = 0,
  assetSymbol = "USDC",
  onActionComplete,
}) {
  const isDeposit = mode === "deposit"
  const symbol = isDeposit ? assetSymbol : "CATLP"
  const [amount, setAmount] = useState("")
  const [usdValue, setUsdValue] = useState("0")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [balance, setBalance] = useState("0")
  const projected = amount ? (Number.parseFloat(amount) * (apr / 100)).toFixed(2) : "0"

  const [tokenAddr, setTokenAddr] = useState(token || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") // default USDC

  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
      setUsdValue(value || "0")
    }
  }

  const loadBalance = async () => {
    try {
      let addr = tokenAddr
      if (!isDeposit) {
        addr = await getCatShareAddress()
        setTokenAddr(addr)
      }
      const dec = await getTokenDecimals(addr)
      const tokenContract = await getERC20WithSigner(addr)
      const signerAddr = await tokenContract.signer.getAddress()
      const bal = await tokenContract.balanceOf(signerAddr)
      const human = ethers.utils.formatUnits(bal, dec)
      setBalance(human)
      return human
    } catch {
      setBalance("0")
      return "0"
    }
  }

  const handleSetMax = async () => {
    const human = await loadBalance()
    setAmount(human)
    setUsdValue(human)
  }

  useEffect(() => {
    if (isOpen) {
      loadBalance()
    }
  }, [isOpen, isDeposit, tokenAddr])

  const handleSubmit = async () => {
    if (!amount) return
    setIsSubmitting(true)
    try {
      const cp = await getCatPoolWithSigner()
      if (isDeposit) {
        const dec = await getUsdcDecimals()
        const amountBn = ethers.utils.parseUnits(amount, dec)
        const usdcAddr = await getUsdcAddress()
        const usdcToken = await getERC20WithSigner(usdcAddr)
        const addr = await usdcToken.signer.getAddress()
        const allowance = await usdcToken.allowance(addr, process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS)
        if (allowance.lt(amountBn)) {
          const approveTx = await usdcToken.approve(process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS, amountBn)
          await approveTx.wait()
        }
        const tx = await cp.depositLiquidity(amountBn)
        await tx.wait()
      } else {
        const sharesBn = ethers.utils.parseUnits(amount, 18)
        const tx = await cp.withdrawLiquidity(sharesBn)
        await tx.wait()
      }
      setAmount("")
      onActionComplete && onActionComplete()
      onClose()
    } catch (err) {
      console.error("CatPool action failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${isDeposit ? "Deposit" : "Withdraw"} ${symbol}`}>
      <div className="space-y-6">
        {/* Amount Input Section */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isDeposit ? "Deposit Amount" : "Withdraw Amount"}
            </label>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <span>
                Balance: {Number.parseFloat(balance).toFixed(4)} {symbol}
              </span>
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
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">≈ ${usdValue}</div>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={handleSetMax}
                  className="px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  MAX
                </button>
                <div className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  <Image
                    src={getTokenLogo(tokenAddr) || "/placeholder.svg"}
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

        {/* Information Cards */}
        <div className="space-y-3">
          {isDeposit ? (
            <>
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">Current APR</span>
                </div>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">{apr.toFixed(2)}%</span>
              </div>

              {amount && (
                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Projected yearly earnings
                  </span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                    {projected} {symbol}
                  </span>
                </div>
              )}

              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-start space-x-2">
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    <p className="font-medium mb-1">Catastrophe Insurance</p>
                    <p>
                      You are providing re-insurance against catastrophic events. Your funds help cover extreme losses
                      when individual pools are depleted.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                <div className="flex items-start space-x-2">
                  <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-orange-800 dark:text-orange-200">
                    <p className="font-medium mb-1">30-Day Notice Period</p>
                    <p>
                      Withdrawals require a 30-day notice period. Your funds will be available for withdrawal after this
                      period expires.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-800 dark:text-red-200">
                    <p className="font-medium mb-1">Risk Warning</p>
                    <p>Withdrawals may be delayed or reduced if catastrophic events occur during the notice period.</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !amount || Number.parseFloat(amount) <= 0}
          className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            `${isDeposit ? "Deposit" : "Withdraw"} ${symbol}`
          )}
        </button>
      </div>
    </Modal>
  )
}
