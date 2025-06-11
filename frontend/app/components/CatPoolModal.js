"use client";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import Image from "next/image";
import { Info } from "lucide-react";
import Modal from "./Modal";
import {
  getCatPoolWithSigner,
  getUsdcAddress,
  getUsdcDecimals,
  getCatShareAddress,
} from "../../lib/catPool";
import { getERC20WithSigner, getTokenDecimals } from "../../lib/erc20";
import { getTokenLogo } from "../config/tokenNameMap";

export default function CatPoolModal({ isOpen, onClose, mode, token, apr = 0, assetSymbol = 'USDC' }) {
  const isDeposit = mode === "deposit";
  const symbol = isDeposit ? assetSymbol : "CATLP";
  const [amount, setAmount] = useState("");
  const [usdValue, setUsdValue] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [balance, setBalance] = useState("0");
  const projected = amount ? (parseFloat(amount) * (apr / 100)).toFixed(2) : "0";

  const [tokenAddr, setTokenAddr] = useState(
    token || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ); // default USDC

  const handleAmountChange = (e) => {
    const value = e.target.value;
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      setUsdValue(value || "0");
    }
  };

  const loadBalance = async () => {
    try {
      let addr = tokenAddr;
      if (!isDeposit) {
        addr = await getCatShareAddress();
        setTokenAddr(addr);
      }
      const dec = await getTokenDecimals(addr);
      const tokenContract = await getERC20WithSigner(addr);
      const signerAddr = await tokenContract.signer.getAddress();
      const bal = await tokenContract.balanceOf(signerAddr);
      const human = ethers.utils.formatUnits(bal, dec);
      setBalance(human);
      return human;
    } catch {
      setBalance("0");
      return "0";
    }
  };

  const handleSetMax = async () => {
    const human = await loadBalance();
    setAmount(human);
    setUsdValue(human);
  };

  useEffect(() => {
    if (isOpen) {
      loadBalance();
    }
  }, [isOpen, isDeposit, tokenAddr]);

  const handleSubmit = async () => {
    if (!amount) return;
    setIsSubmitting(true);
    try {
      const cp = await getCatPoolWithSigner();
      if (isDeposit) {
        const dec = await getUsdcDecimals();
        const amountBn = ethers.utils.parseUnits(amount, dec);
        const usdcAddr = await getUsdcAddress();
        const usdcToken = await getERC20WithSigner(usdcAddr);
        const addr = await usdcToken.signer.getAddress();
        const allowance = await usdcToken.allowance(
          addr,
          process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
        );
        if (allowance.lt(amountBn)) {
          const approveTx = await usdcToken.approve(
            process.env.NEXT_PUBLIC_CAT_POOL_ADDRESS,
            amountBn,
          );
          await approveTx.wait();
        }
        const tx = await cp.depositLiquidity(amountBn);
        await tx.wait();
      } else {
        const sharesBn = ethers.utils.parseUnits(amount, 18);
        const tx = await cp.withdrawLiquidity(sharesBn);
        await tx.wait();
      }
      onClose();
      setAmount("");
    } catch (err) {
      console.error("CatPool action failed", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isDeposit ? `Deposit ${symbol}` : "Withdraw"}
    >
      <div className="space-y-6">
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Amount
            </label>
            <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
              <Info className="h-3 w-3 mr-1" />
              <span>{isDeposit ? "Deposit" : "Withdraw"} amount</span>
            </div>
          </div>
          <div className="relative rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
            <div className="flex items-center p-3">
              <input
                type="text"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0.00"
                className="w-full bg-transparent text-xl font-medium text-gray-900 dark:text-white outline-none"
              />
              <div className="flex items-center ml-2">
                <div className="h-6 w-6 mr-2">
                  <Image src={getTokenLogo(tokenAddr)} alt="token" width={24} height={24} className="rounded-full" />
                </div>
                <span className="text-base font-medium text-gray-900 dark:text-white">{symbol}</span>
              </div>
            </div>
            <div className="flex justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">${usdValue}</span>
              {isDeposit && (
                <button onClick={handleSetMax} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
                  MAX
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Balance: {parseFloat(balance).toFixed(4)} {symbol}</div>
        </div>
        {isDeposit && (
          <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-700 dark:text-blue-300">
            You are providing Re-Insurance against Catastrophe events.
          </div>
        )}
        {isDeposit && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Projected yearly earnings: {projected} {symbol}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !amount}
          className="w-full py-3 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? "Processing..." : isDeposit ? "Deposit" : "Withdraw"}
        </button>
      </div>
    </Modal>
  );
}
