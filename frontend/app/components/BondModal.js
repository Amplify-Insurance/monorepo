"use client"

import { useState, useEffect } from "react"
import { ethers } from "ethers"
import Image from "next/image"
import { AlertTriangle, Info, DollarSign, ChevronDown, Check } from "lucide-react"
import { getCommittee, getCommitteeWithSigner } from "../../lib/committee"
import Modal from "./Modal"
import usePools from "../../hooks/usePools"
// Bond deposits are denominated in the underlying asset of each deployment
// rather than the protocol token being covered. Use the same token mapping as
// the Insurance Markets page so only unique underlying assets show up in the
// dropdown.
import { getUnderlyingTokenLogo, getUnderlyingTokenName } from "../config/tokenNameMap"
import { getTxExplorerUrl } from "../utils/explorer"
import useClaims from "../../hooks/useClaims"
import { getProtocolName, getProtocolLogo } from "../config/tokenNameMap"
import { STAKING_TOKEN_ADDRESS, COMMITTEE_ADDRESS } from "../config/deployments"
import { getERC20WithSigner, getTokenDecimals, getTokenSymbol } from "../../lib/erc20"

export default function BondModal({ isOpen, onClose }) {
  const { pools } = usePools()
  const { claims } = useClaims()
  // Build a list of unique underlying assets across all deployments. This
  // mirrors the behaviour of the Insurance Markets page so only the actual
  // deposit assets (e.g. USDC) show up in the dropdown.
  const tokens = pools
    ? Array.from(
        new Set(pools.map((p) => p.underlyingAsset.toLowerCase())),
      ).map((address) => ({
        address,
        symbol: getUnderlyingTokenName(address),
      }))
    : []
  const [selectedAsset, setSelectedAsset] = useState("")
  const [selectedProtocol, setSelectedProtocol] = useState("")
  const [amount, setAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState("")
  const [maxPayout, setMaxPayout] = useState("0")
  const tokenAddress = STAKING_TOKEN_ADDRESS
  const [symbol, setSymbol] = useState("")
  const [decimals, setDecimals] = useState(18)
  const [balance, setBalance] = useState("0")
  const [assetSymbol, setAssetSymbol] = useState("")
  const [feeShareBps, setFeeShareBps] = useState(0)
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false)
  const [protocolDropdownOpen, setProtocolDropdownOpen] = useState(false)

  const handleAmountChange = (e) => {
    const value = e.target.value
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
    }
  }

  const handleSetMax = () => {
    setAmount(balance)
  }

  useEffect(() => {
    if (!selectedAsset && tokens && tokens.length > 0) {
      setSelectedAsset(tokens[0].address)
    }
  }, [tokens, selectedAsset])

  useEffect(() => {
    if (!selectedAsset) return
    const first = pools.find(
      (p) => p.underlyingAsset.toLowerCase() === selectedAsset.toLowerCase(),
    )
    if (first) setSelectedProtocol(String(first.id))
    else setSelectedProtocol("")
  }, [selectedAsset, pools])

  useEffect(() => {
    if (!selectedProtocol && pools && pools.length > 0) {
      const first = pools.find(
        (p) => p.underlyingAsset.toLowerCase() === selectedAsset.toLowerCase(),
      )
      if (first) setSelectedProtocol(String(first.id))
    }
  }, [pools, selectedProtocol, selectedAsset])

  useEffect(() => {
    async function loadTokenInfo() {
      if (!tokenAddress) return
      try {
        const token = await getERC20WithSigner(tokenAddress)
        const addr = await token.signer.getAddress()
        const dec = await getTokenDecimals(tokenAddress)
        const bal = await token.balanceOf(addr)
        setBalance(ethers.utils.formatUnits(bal, dec))
        setSymbol(await getTokenSymbol(tokenAddress))
        setDecimals(dec)
      } catch (err) {
        console.error("Failed to load staking token info", err)
      }
    }

    async function loadFeeShare() {
      try {
        const c = getCommittee()
        const bps = await c.proposerFeeShareBps()
        setFeeShareBps(Number(bps.toString()))
      } catch (err) {
        console.error("Failed to load proposer fee share", err)
      }
    }

    if (isOpen) {
      loadTokenInfo()
      loadFeeShare()
    }
  }, [isOpen, tokenAddress])

  useEffect(() => {
    if (!selectedAsset) return
    setAssetSymbol(getUnderlyingTokenName(selectedAsset))
  }, [selectedAsset])

  // Calculate max payout based on claim fees for the selected pool
  useEffect(() => {
    const pool = pools.find((p) => String(p.id) === selectedProtocol)
    if (!pool) return setMaxPayout("0")

    const dec = pool.underlyingAssetDecimals ?? 18
    const totalFees = claims
      .filter((c) => Number(c.poolId) === Number(selectedProtocol))
      .reduce((sum, c) => {
        try {
          return sum + Number(ethers.utils.formatUnits(c.claimFee, dec))
        } catch {
          return sum
        }
      }, 0)

    const payout = (totalFees * feeShareBps) / 10000
    setMaxPayout(payout.toFixed(4))
  }, [selectedProtocol, claims, pools, feeShareBps])

  const handleSubmit = async () => {
    if (!amount || !selectedProtocol) return
    if (Number(amount) < 1000) return
    const pool = pools.find((p) => String(p.id) === selectedProtocol)
    if (!pool) return
    setIsSubmitting(true)
    try {
      const committee = await getCommitteeWithSigner()
      const token = await getERC20WithSigner(tokenAddress)
      const value = ethers.utils.parseUnits(amount, decimals)
      const owner = await token.signer.getAddress()
      const allowance = await token.allowance(owner, COMMITTEE_ADDRESS)
      if (allowance.lt(value)) {
        const approveTx = await token.approve(COMMITTEE_ADDRESS, value)
        await approveTx.wait()
      }
      const tx = await committee.createProposal(pool.id, 1, value)
      setTxHash(tx.hash)
      await tx.wait()
      setAmount("")
      onClose()
    } catch (err) {
      console.error("Bond deposit failed", err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const CustomDropdown = ({
    options,
    value,
    onChange,
    isOpen,
    setIsOpen,
    placeholder,
    getLabel,
    getLogo,
    renderOption,
  }) => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl hover:border-gray-300 dark:hover:border-gray-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        <div className="flex items-center space-x-3">
          {value && (
            <Image
              src={getLogo(value) || "/placeholder.svg"}
              alt={getLabel(value)}
              width={24}
              height={24}
              className="rounded-full"
            />
          )}
          <span className="text-gray-900 dark:text-gray-100 font-medium">{value ? getLabel(value) : placeholder}</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                onChange(option)
                setIsOpen(false)
              }}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="flex items-center space-x-3">
                <Image
                  src={getLogo(option) || "/placeholder.svg"}
                  alt={getLabel(option)}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span className="text-gray-900 dark:text-gray-100 font-medium">{getLabel(option)}</span>
              </div>
              {value === option && <Check className="w-4 h-4 text-blue-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Deposit Bond">
      <div className="space-y-6">
        {/* Warning Card */}
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p className="font-semibold mb-1">Slashing Risk</p>
              <p>
                Your bond may be slashed if voting support is not achieved. Only deposit what you can afford to lose.
              </p>
            </div>
          </div>
        </div>

        {/* Asset Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Asset</label>
          <CustomDropdown
            options={tokens.map((t) => t.address)}
            value={selectedAsset}
            onChange={setSelectedAsset}
            isOpen={assetDropdownOpen}
            setIsOpen={setAssetDropdownOpen}
            placeholder="Select asset"
            getLabel={(address) => getUnderlyingTokenName(address)}
            getLogo={(address) => getUnderlyingTokenLogo(address)}
          />
        </div>

        {/* Protocol Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Protocol</label>
          <CustomDropdown
            options={pools
              .filter((p) =>
                p.underlyingAsset.toLowerCase() === selectedAsset.toLowerCase(),
              )
              .map((p) => p.id)}
            value={selectedProtocol}
            onChange={setSelectedProtocol}
            isOpen={protocolDropdownOpen}
            setIsOpen={setProtocolDropdownOpen}
            placeholder="Select protocol"
            getLabel={(id) => getProtocolName(id)}
            getLogo={(id) => getProtocolLogo(id)}
          />
        </div>

        {/* Bond Amount Input */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Bond Amount</label>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Balance: {Number.parseFloat(balance).toFixed(4)} {symbol}
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center justify-between p-4 border-2 border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all duration-200">
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
                  className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-lg transition-colors duration-200"
                >
                  MAX
                </button>
                <div className="flex items-center space-x-2 px-3 py-2 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{symbol || "TOKEN"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Max Payout Info */}
        {amount && Number.parseFloat(amount) > 0 && (
          <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold text-blue-800 dark:text-blue-200">Max Payout</span>
            </div>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {maxPayout} {assetSymbol}
            </span>
          </div>
        )}

        {/* Info Card */}
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-semibold mb-1">Bond Mechanics</p>
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
          disabled={isSubmitting || !amount || Number.parseFloat(amount) < 1000}
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
        {txHash && (
          <p className="text-xs text-center mt-2">
            Transaction submitted.{" "}
            <a href={getTxExplorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="underline">
              View on block explorer
            </a>
          </p>
        )}
      </div>
    </Modal>
  )
}
