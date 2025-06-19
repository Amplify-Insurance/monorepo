"use client";
import { useState, useEffect, Fragment } from "react";
import { TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { formatCurrency, formatPercentage } from "../utils/formatting";
import ManageCoverageModal from "./ManageCoverageModal";
import ManageAllocationModal from "./ManageAllocationModal";
import { useAccount } from "wagmi";
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails";
import usePools from "../../hooks/usePools";
import useYieldAdapters from "../../hooks/useYieldAdapters";
import { ethers } from "ethers";
import { getRiskManagerWithSigner } from "../../lib/riskManager";
import { getCapitalPoolWithSigner } from "../../lib/capitalPool";
import {
  getTokenName,
  getTokenLogo,
  getProtocolLogo,
  getProtocolName,
  getProtocolType,
} from "../config/tokenNameMap";
import deployments, { getDeployment } from "../config/deployments";

export default function UnderwritingPositions({ displayCurrency }) {
  const NOTICE_PERIOD = 600; // seconds
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [isClaimingDistressed, setIsClaimingDistressed] = useState(false);
  const [isClaimingAllDistressed, setIsClaimingAllDistressed] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [expandedRows, setExpandedRows] = useState([]);
  const toggleRow = (id) => {
    setExpandedRows((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [rewardsMap, setRewardsMap] = useState({});
  const { address } = useAccount();
  const { details } = useUnderwriterDetails(address);
  const { pools } = usePools();
  const defaultDeployment = details?.[0]?.deployment;
  const adapters = useYieldAdapters(defaultDeployment);

const underwritingPositions = (details || [])
  .flatMap((d) =>
    d.allocatedPoolIds.map((pid) => {
      const pool = pools.find(
        (pl) => pl.deployment === d.deployment && Number(pl.id) === Number(pid)
      );
      if (!pool) return null;
      const protocol = getTokenName(pool.id);
      const amount = Number(
        ethers.utils.formatUnits(
          d.totalDepositedAssetPrincipal,
          pool.underlyingAssetDecimals ?? 6,
        )
      );
      const pendingLossStr = d.pendingLosses?.[pid] ?? '0';
      const pendingLoss = Number(
        ethers.utils.formatUnits(
          pendingLossStr,
          pool.underlyingAssetDecimals ?? 6,
        ),
      );
      return {
        id: `${d.deployment}-${pid}`,
        deployment: d.deployment,
        protocol,
        type: getProtocolType(pool.id),
        pool: pool.protocolTokenToCover,
        poolName: getTokenName(pool.id),
        poolId: pid,
        amount,
        nativeValue: amount,
        usdValue: amount * (pool.tokenPriceUsd ?? 1),
        pendingLoss,
        pendingLossUsd: pendingLoss * (pool.tokenPriceUsd ?? 1),
        yield: Number(pool.underwriterYieldBps || 0) / 100,
        status:
          Number(ethers.utils.formatUnits(d.withdrawalRequestShares)) > 0
            ? 'requested withdrawal'
            : 'active',
        shares: d.masterShares,
        yieldChoice: d.yieldChoice,
      };
    })
  )
  .filter(Boolean);

  useEffect(() => {
    async function loadRewards() {
      if (!address) return;
      const map = {};
      for (const pos of underwritingPositions) {
        try {
          const res = await fetch(`/api/underwriters/${address}/rewards/${pos.poolId}?deployment=${pos.deployment}`);
          if (res.ok) {
            const data = await res.json();
            const item = (data.rewards || []).find((r) => r.deployment === pos.deployment);
            map[pos.id] = item ? item.pending : '0';
          }
        } catch (err) {
          console.error('Failed to load pending rewards', err);
        }
      }
      setRewardsMap(map);
    }
    loadRewards();
  }, [address, underwritingPositions]);

  const protocolPositions = underwritingPositions.filter(
    (p) => p.type === 'protocol'
  );
  const stablecoinPositions = underwritingPositions.filter(
    (p) => p.type === 'stablecoin'
  );

  const activePositions = underwritingPositions.filter(
    (p) => p.status === "active"
  );
  const withdrawalPositions = underwritingPositions.filter(
    (p) => p.status === "requested withdrawal"
  );

  const showPendingLoss = underwritingPositions.some(
    (p) => p.pendingLoss > 0
  );

  const hasDistressedAssets = underwritingPositions.some(
    (p) => p.pendingLoss > 0
  );

  console.log(activePositions, "activePositions")

  const unlockTimestamp =
    Number(ethers.utils.formatUnits(details?.[0]?.withdrawalRequestTimestamp || 0)) + NOTICE_PERIOD;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const unlockDays = Math.max(
    0,
    Math.ceil((unlockTimestamp - currentTimestamp) / 86400)
  );
  const withdrawalReady = currentTimestamp >= unlockTimestamp;

  const handleOpenModal = (position) => {
    setSelectedPosition(position);
    setModalOpen(true);
  };

  const handleClaimRewards = async (position) => {
    setIsClaiming(true);
    try {
      const dep = getDeployment(position.deployment);
      const rm = await getRiskManagerWithSigner(dep.riskManager);
      if (typeof rm.claimPremiumRewards === "function") {
        await (await rm.claimPremiumRewards(position.poolId)).wait();
      }
      if (typeof rm.claimDistressedAssets === "function") {
        await (await rm.claimDistressedAssets(position.poolId)).wait();
      }
    } catch (err) {
      console.error("Failed to claim rewards", err);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClaimAllRewards = async () => {
    if (underwritingPositions.length === 0) return;
    setIsClaimingAll(true);
    try {
      const grouped = underwritingPositions.reduce((acc, p) => {
        (acc[p.deployment] = acc[p.deployment] || []).push(p.poolId);
        return acc;
      }, {});
      for (const [depName, ids] of Object.entries(grouped)) {
        const dep = getDeployment(depName);
        const rm = await getRiskManagerWithSigner(dep.riskManager);
        for (const id of ids) {
          if (typeof rm.claimPremiumRewards === "function") {
            await (await rm.claimPremiumRewards(id)).wait();
          }
          if (typeof rm.claimDistressedAssets === "function") {
            await (await rm.claimDistressedAssets(id)).wait();
          }
        }
      }
    } catch (err) {
      console.error("Failed to claim all rewards", err);
    } finally {
      setIsClaimingAll(false);
    }
  };

  const handleClaimDistressed = async (position) => {
    setIsClaimingDistressed(true);
    try {
      const dep = getDeployment(position.deployment);
      const rm = await getRiskManagerWithSigner(dep.riskManager);
      if (typeof rm.claimDistressedAssets === "function") {
        await (await rm.claimDistressedAssets(position.poolId)).wait();
      }
    } catch (err) {
      console.error("Failed to claim distressed assets", err);
    } finally {
      setIsClaimingDistressed(false);
    }
  };

  const handleClaimAllDistressed = async () => {
    if (underwritingPositions.length === 0) return;
    setIsClaimingAllDistressed(true);
    try {
      const grouped = underwritingPositions.reduce((acc, p) => {
        if (p.pendingLoss > 0) {
          (acc[p.deployment] = acc[p.deployment] || []).push(p.poolId);
        }
        return acc;
      }, {});
      for (const [depName, ids] of Object.entries(grouped)) {
        const dep = getDeployment(depName);
        const rm = await getRiskManagerWithSigner(dep.riskManager);
        for (const id of ids) {
          if (typeof rm.claimDistressedAssets === "function") {
            await (await rm.claimDistressedAssets(id)).wait();
          }
        }
      }
    } catch (err) {
      console.error("Failed to claim all distressed assets", err);
    } finally {
      setIsClaimingAllDistressed(false);
    }
  };

  const handleExecuteWithdrawal = async () => {
    setIsExecuting(true);
    try {
      const dep = getDeployment(defaultDeployment);
      const cp = await getCapitalPoolWithSigner(dep.capitalPool);
      await (await cp.executeWithdrawal()).wait();
    } catch (err) {
      console.error("Failed to execute withdrawal", err);
    } finally {
      setIsExecuting(false);
    }
  };

  // Calculate total yield and value
  const totalValue = underwritingPositions.reduce(
    (sum, position) => sum + position.nativeValue,
    0
  );
  const weightedYield = underwritingPositions.reduce(
    (sum, position) => sum + position.yield * position.nativeValue,
    0
  );
  const averageYield = totalValue > 0 ? weightedYield / totalValue : 0;

  const totalDeposited = (details || []).reduce((sum, d) => {
    const dec =
      pools.find((p) => p.deployment === d.deployment)?.underlyingAssetDecimals ?? 6;
    return sum + Number(ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, dec));
  }, 0);
  const totalDepositedUsd = (details || []).reduce((sum, d) => {
    const pool = pools.find((p) => p.deployment === d.deployment);
    const price = pool?.tokenPriceUsd ?? 1;
    const dec = pool?.underlyingAssetDecimals ?? 6;
    console.log(price, sum, d.totalDepositedAssetPrincipal, "price totalDepositedUsd");

    return sum + Number(ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, dec)) * price;
  }, 0);
  const totalUnderwritten = underwritingPositions.reduce(
    (sum, p) => sum + p.nativeValue,
    0
  );

  const totalUnderwrittenUsd = underwritingPositions.reduce((sum, p) => sum + p.usdValue, 0);
  const baseAdapter = adapters.find((a) => a.id === Number(details?.[0]?.yieldChoice));
  const baseYieldApr = baseAdapter?.apr || 0;
  const totalApr = baseYieldApr + averageYield;

  const renderTables = (positions, title) => {
    const active = positions.filter((p) => p.status === 'active');
    const withdrawal = positions.filter((p) => p.status === 'requested withdrawal');
    return (
      <div className="mt-6">
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        {active.length > 0 && (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle">
              <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Protocol</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pool</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">{displayCurrency === 'native' ? 'Amount' : 'Value'}</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Yield APY</th>
                      {showPendingLoss && (
                        <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Pending Loss</th>
                      )}
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Status</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {active.map((position) => (
                      <Fragment key={position.id}>
                        <tr className="hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                              <Image src={getProtocolLogo(position.poolId)} alt={position.protocol} width={32} height={32} className="rounded-full" />
                            </div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{getProtocolName(position.poolId)}</div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-6 w-6 mr-2">
                              <Image src={getTokenLogo(position.pool)} alt={position.poolName} width={24} height={24} className="rounded-full" />
                            </div>
                            <div className="text-sm text-gray-900 dark:text-white">{getTokenName(position.pool)}</div>
                          </div>
                          <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                            {displayCurrency === 'native' ? `${position.amount}` : formatCurrency(position.usdValue, 'USD', 'usd')}
                          </div>
                          <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                            {formatPercentage(position.yield)}
                          </div>
                          {position.pendingLoss > 0 && (
                            <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                              Loss: {formatCurrency(displayCurrency === 'native' ? position.pendingLoss : position.pendingLossUsd, 'USD', displayCurrency)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm text-gray-900 dark:text-white">
                            {displayCurrency === 'native' ? `${position.amount}` : formatCurrency(position.usdValue, 'USD', 'usd')}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm font-medium text-green-600 dark:text-green-400">{formatPercentage(position.yield)}</div>
                        </td>
                        {showPendingLoss && (
                          <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                            <div className="text-sm text-gray-900 dark:text-white">
                              {formatCurrency(displayCurrency === 'native' ? position.pendingLoss : position.pendingLossUsd, 'USD', displayCurrency)}
                            </div>
                          </td>
                        )}
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${position.status === 'requested withdrawal' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'}`}>{position.status}</span>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => toggleRow(position.id)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 flex items-center justify-end gap-1 ml-auto"
                          >
                            <span className="hidden sm:inline">
                              {expandedRows.includes(position.id) ? 'Hide' : 'Actions'}
                            </span>
                            {expandedRows.includes(position.id) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                      {expandedRows.includes(position.id) && (
                        <tr>
                          <td colSpan={showPendingLoss ? 7 : 6} className="px-3 sm:px-6 py-4">
                            <div className="flex flex-wrap gap-3 items-center">
                              <div className="text-sm text-gray-700 dark:text-gray-200">
                                Pending Rewards: {((Number(rewardsMap[position.id] || 0) / 1e18).toFixed(4))}
                              </div>
                              <button
                                className="py-2 px-3 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm"
                                onClick={() => handleClaimRewards(position)}
                                disabled={isClaiming}
                              >
                                {isClaiming ? 'Claiming...' : 'Claim Rewards'}
                              </button>
                              <button
                                className="py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm"
                                onClick={() => handleOpenModal(position)}
                              >
                                Manage
                              </button>
                              <Link
                                href={`/pool/${position.poolId}/${position.pool}`}
                                className="py-2 px-3 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 rounded-md text-sm"
                              >
                                Pool Page
                              </Link>
                              {position.pendingLoss > 0 && (
                                <button
                                  className="py-2 px-3 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm"
                                  onClick={() => handleClaimDistressed(position)}
                                  disabled={isClaimingDistressed}
                                >
                                  {isClaimingDistressed ? 'Claiming...' : 'Claim Distressed'}
                                </button>
                              )}
                              {withdrawalReady && details?.[0]?.withdrawalRequestShares > 0 && (
                                <button
                                  className="py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm"
                                  onClick={handleExecuteWithdrawal}
                                  disabled={isExecuting}
                                >
                                  {isExecuting ? 'Executing...' : 'Execute Withdrawal'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {withdrawal.length > 0 && (
          <div className="mt-8 overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle">
              <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Protocol</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pool</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">{displayCurrency === 'native' ? 'Amount' : 'Value'}</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Unlock</th>
                      <th scope="col" className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {withdrawal.map((position) => (
                      <tr key={position.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                              <Image src={getProtocolLogo(position.id)} alt={position.protocol} width={32} height={32} className="rounded-full" />
                            </div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{getProtocolName(position.id)}</div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-6 w-6 mr-2">
                              <Image src={getTokenLogo(position.pool)} alt={position.poolName} width={24} height={24} className="rounded-full" />
                            </div>
                            <div className="text-sm text-gray-900 dark:text-white">{getTokenName(position.pool)}</div>
                          </div>
                          <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                            {displayCurrency === 'native' ? `${position.amount}` : formatCurrency(position.usdValue, 'USD', 'usd')}
                          </div>
                          <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">{unlockDays}d</div>
                          {position.pendingLoss > 0 && (
                            <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                              Loss: {formatCurrency(displayCurrency === 'native' ? position.pendingLoss : position.pendingLossUsd, 'USD', displayCurrency)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm text-gray-900 dark:text-white">
                            {displayCurrency === 'native' ? `${position.amount}` : formatCurrency(position.usdValue, 'USD', 'usd')}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                          <div className="text-sm font-medium text-green-600 dark:text-green-400">{unlockDays}d</div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {withdrawalReady && (
                            <button onClick={handleExecuteWithdrawal} disabled={isExecuting} className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 disabled:opacity-50">
                              {isExecuting ? 'Executing...' : 'Withdraw'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (underwritingPositions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <TrendingUp className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
          {totalDeposited > 0
            ? "Capital deposited but not allocated"
            : "No underwriting positions"}
        </h3>
        {totalDeposited > 0 ? (
          <div>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              You have {formatCurrency(
                displayCurrency === 'native' ? totalDeposited : totalDepositedUsd,
                'USD',
                displayCurrency,
              )} ready to allocate.
            </p>
            <button
              onClick={() => setShowAllocModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
            >
              Allocate Capital
            </button>
            {showAllocModal && (
              <ManageAllocationModal
                isOpen={showAllocModal}
                onClose={() => setShowAllocModal(false)}
                deployment={defaultDeployment}
              />
            )}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-gray-400">
            You don't have any active underwriting positions. Visit the markets
            page to provide coverage.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Value Deposited</div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(
                displayCurrency === 'native' ? totalDeposited : totalDepositedUsd,
                'USD',
                displayCurrency,
              )}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Value Underwritten</div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(
                displayCurrency === 'native' ? totalUnderwritten : totalUnderwrittenUsd,
                'USD',
                displayCurrency,
              )}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              Base Yield {baseAdapter ? `(${baseAdapter.name})` : ""}
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatPercentage(baseYieldApr)}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total APR</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatPercentage(totalApr)}
            </div>
          </div>
        </div>
      </div>
      {renderTables(protocolPositions, "Protocol Cover")}
      {renderTables(stablecoinPositions, "Stablecoin Cover")}
      {hasDistressedAssets && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleClaimAllDistressed}
            disabled={isClaimingAllDistressed}
            className="mr-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md"
          >
            {isClaimingAllDistressed ? "Claiming..." : "Claim All Distressed"}
          </button>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setShowAllocModal(true)}
          className="mr-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
        >
          Edit Allocation
        </button>
        <button
          onClick={handleClaimAllRewards}
          disabled={isClaimingAll}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md"
        >
          {isClaimingAll ? "Claiming..." : "Claim All Rewards"}
        </button>
      </div>

      {/* Manage Position Modal */}
      {selectedPosition && (
        <ManageCoverageModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          type="position"
          protocol={selectedPosition.protocol}
          token={selectedPosition.pool}
          amount={selectedPosition.amount}
          yield={selectedPosition.yield}
          shares={selectedPosition.shares}
          poolId={selectedPosition.poolId}
          yieldChoice={selectedPosition.yieldChoice}
          deployment={selectedPosition.deployment}
        />
      )}
      {showAllocModal && (
        <ManageAllocationModal
          isOpen={showAllocModal}
          onClose={() => setShowAllocModal(false)}
          deployment={defaultDeployment}
        />
      )}
    </div>
  );
}
