"use client";
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  ChevronDown,
  TrendingUp,
  DollarSign,
  Users,
  Check,
} from "lucide-react";
import { ethers } from "ethers";
import Image from "next/image";
import CatPoolModal from "../components/CatPoolModal";
import CatPoolDeposits from "../components/CatPoolDeposits";
import { formatCurrency } from "../utils/formatting";
import { getTokenLogo } from "../config/tokenNameMap";
import SUPPORTED_TOKENS from "../config/supportedTokens";
import useCatPoolUserInfo from "../../hooks/useCatPoolUserInfo";
import useCatPoolStats from "../../hooks/useCatPoolStats";
import useAnalytics from "../../hooks/useAnalytics";
import useCatPoolWithdrawalRequest from "../../hooks/useCatPoolWithdrawalRequest";
import deployments from "../config/deployments";
import { getUsdcAddress } from "../../lib/catPool";
import { getERC20WithSigner } from "../../lib/erc20";

export default function CatPoolPage() {
  const { address } = useAccount();
  const { info, refresh } = useCatPoolUserInfo(address);
  const { stats } = useCatPoolStats();
  const { data: analytics } = useAnalytics();
  const { request: withdrawalRequest, NOTICE_PERIOD } =
    useCatPoolWithdrawalRequest(address);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("deposit");
  const [selectedToken, setSelectedToken] = useState(SUPPORTED_TOKENS[0]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [poolStats, setPoolStats] = useState({
    totalLiquidity: 0,
    apr: 0,
    totalDepositors: 0,
  });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const withdrawalReady =
    withdrawalRequest &&
    Date.now() / 1000 >= withdrawalRequest.timestamp + NOTICE_PERIOD;

  const handleActionComplete = () => {
    setRefreshTrigger((prev) => prev + 1);
    refresh();
  };

  const openModal = (mode) => {
    setModalMode(mode);
    setIsModalOpen(true);
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      const usdcAddr = await getUsdcAddress();
      const token = await getERC20WithSigner(usdcAddr);
      const tx = await token.approve(
        deployments[0]?.catInsurancePool,
        ethers.constants.MaxUint256
      );
      await tx.wait();
      setNeedsApproval(false);
    } catch (err) {
      console.error("Approval failed", err);
    } finally {
      setIsApproving(false);
    }
  };

  useEffect(() => {
    const checkAllowance = async () => {
      if (!address) return setNeedsApproval(false);
      try {
        const usdcAddr = await getUsdcAddress();
        const token = await getERC20WithSigner(usdcAddr);
        const allowance = await token.allowance(
          address,
          deployments[0]?.catInsurancePool
        );
        setNeedsApproval(allowance.eq(0));
      } catch (err) {
        console.error("Failed to check allowance", err);
        setNeedsApproval(false);
      }
    };
    checkAllowance();
  }, [address]);

  useEffect(() => {
    const totalLiquidity = Number(
      ethers.utils.formatUnits(stats.liquidUsdc || "0", 6)
    );
    const apr = Number(ethers.utils.formatUnits(stats.apr || "0", 18)) * 100;
    const totalDepositors = analytics?.underwriterCount || 0;
    setPoolStats({ totalLiquidity, apr, totalDepositors });
  }, [stats, analytics]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Backstop Pool
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Provide liquidity to the catastrophe insurance pool and earn rewards
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Total Liquidity
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(poolStats.totalLiquidity, "USD", "USD")}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Current APR
                </p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {poolStats.apr.toFixed(1)}%
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Depositors
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {poolStats.totalDepositors.toLocaleString()}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Layout */}
        <div className="space-y-8">
          {/* Manage Position Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-8">
              Manage Position
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Token Selection */}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Select Token
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                          <Image
                            src={
                              getTokenLogo(selectedToken.address) ||
                              "/placeholder.svg"
                            }
                            alt={selectedToken.symbol}
                            width={40}
                            height={40}
                            className="rounded-full"
                          />
                        </div>
                        <div className="text-left">
                          <p className="text-base font-medium text-gray-900 dark:text-white">
                            {selectedToken.symbol}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {selectedToken.name}
                          </p>
                        </div>
                      </div>
                      <ChevronDown
                        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                          isDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Dropdown Menu */}
                    {isDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 overflow-hidden">
                        {SUPPORTED_TOKENS.map((token) => (
                          <button
                            key={token.address}
                            onClick={() => {
                              setSelectedToken(token);
                              setIsDropdownOpen(false);
                            }}
                            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 text-left"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                                <Image
                                  src={
                                    getTokenLogo(token.address) ||
                                    "/placeholder.svg"
                                  }
                                  alt={token.symbol}
                                  width={40}
                                  height={40}
                                  className="rounded-full"
                                />
                              </div>
                              <div>
                                <p className="text-base font-medium text-gray-900 dark:text-white">
                                  {token.symbol}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                  {token.name}
                                </p>
                              </div>
                            </div>
                            {selectedToken.address === token.address && (
                              <Check className="w-5 h-5 text-blue-500" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Token Info */}
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Current APR
                      </p>
                      <p className="text-xl font-bold text-blue-900 dark:text-blue-100">
                        {poolStats.apr.toFixed(2)}%
                      </p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-blue-500" />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Actions
                </h3>
                <div className="space-y-3">
                  {needsApproval && (
                    <button
                      onClick={handleApprove}
                      disabled={isApproving}
                      className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md text-lg disabled:opacity-50"
                    >
                      {isApproving
                        ? "Approving..."
                        : `Approve ${selectedToken.symbol}`}
                    </button>
                  )}
                  <button
                    onClick={() => openModal("deposit")}
                    disabled={needsApproval}
                    className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md text-lg disabled:opacity-50"
                  >
                    Deposit {selectedToken.symbol}
                  </button>
                  {info && info.balance !== "0" && (
                    <button
                      onClick={() => openModal("withdraw")}
                      disabled={!withdrawalReady}
                      className="w-full py-4 px-6 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-xl transition-all duration-200 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Withdraw {selectedToken.symbol}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* My Deposits Section */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              My Backstop Pool Deposits
            </h2>
            <CatPoolDeposits
              displayCurrency="USD"
              refreshTrigger={refreshTrigger}
            />
          </div>
        </div>
      </div>

      <CatPoolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        token={selectedToken.address}
        apr={poolStats.apr}
        assetSymbol={selectedToken.symbol}
        onActionComplete={handleActionComplete}
      />
    </div>
  );
}
