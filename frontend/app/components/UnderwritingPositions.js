"use client";
import { useState } from "react";
import { TrendingUp, MoreHorizontal } from "lucide-react";
import Image from "next/image";
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
import { getTokenName, getTokenLogo, getProtocolLogo, getProtocolName } from "../config/tokenNameMap";
import deployments, { getDeployment } from "../config/deployments";

export default function UnderwritingPositions({ displayCurrency }) {
  const NOTICE_PERIOD = 600; // seconds
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [showAllocModal, setShowAllocModal] = useState(false);
  const { address } = useAccount();
  const { details } = useUnderwriterDetails(address);
  const { pools } = usePools();
  const adapters = useYieldAdapters();
  const defaultDeployment = details?.[0]?.deployment;

const underwritingPositions = (details || [])
  .flatMap((d) =>
    d.allocatedPoolIds.map((pid) => {
      const pool = pools.find(
        (pl) => pl.deployment === d.deployment && Number(pl.id) === Number(pid)
      );
      if (!pool) return null;
      const protocol = getTokenName(pool.id);
      const amount = Number(
        ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, 6)
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
        pool: pool.protocolTokenToCover,
        poolName: getTokenName(pool.id),
        poolId: pid,
        amount,
        nativeValue: amount,
        pendingLoss,
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

  const activePositions = underwritingPositions.filter(
    (p) => p.status === "active"
  );
  const withdrawalPositions = underwritingPositions.filter(
    (p) => p.status === "requested withdrawal"
  );

  const showPendingLoss = underwritingPositions.some(
    (p) => p.pendingLoss > 0
  );

  console.log(details, "the deets")

  const unlockTimestamp =
    Number(ethers.utils.formatUnits(details?.[0]?.withdrawalRequestTimestamp || 0)) + NOTICE_PERIOD;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const unlockDays = Math.max(
    0,
    Math.ceil((unlockTimestamp - currentTimestamp) / 86400)
  );
  const withdrawalReady = currentTimestamp >= unlockTimestamp;

  console.log(pools, "pool details");

  console.log("Underwriting positions:", underwritingPositions);


  const handleOpenModal = (position) => {
    setSelectedPosition(position);
    setModalOpen(true);
  };

  const handleClaimRewards = async (position) => {
    setIsClaiming(true);
    try {
      const dep = getDeployment(position.deployment);
      const rm = await getRiskManagerWithSigner(dep.riskManager);
      await (await rm.claimPremiumRewards(position.poolId)).wait();
      await (await rm.claimDistressedAssets(position.poolId)).wait();
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
          await (await rm.claimPremiumRewards(id)).wait();
          await (await rm.claimDistressedAssets(id)).wait();
        }
      }
    } catch (err) {
      console.error("Failed to claim all rewards", err);
    } finally {
      setIsClaimingAll(false);
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

  const totalDeposited = (details || []).reduce(
    (sum, d) => sum + Number(ethers.utils.formatUnits(d.totalDepositedAssetPrincipal, 6)),
    0
  );
  const totalUnderwritten = totalDeposited * underwritingPositions.length;
  const baseAdapter = adapters.find((a) => a.id === Number(details?.[0]?.yieldChoice));
  const baseYieldApr = baseAdapter?.apr || 0;
  const totalApr = baseYieldApr + averageYield;

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
              You have {formatCurrency(totalDeposited)} ready to allocate.
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
              {formatCurrency(totalDeposited)}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">Total Value Underwritten</div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(totalUnderwritten)}
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
        <div className="mt-4 text-right">
          <button
            onClick={() => setShowAllocModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
          >
            Edit Allocation
          </button>
        </div>
      </div>

      {activePositions.length > 0 && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="inline-block min-w-full align-middle">
            <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      Protocol
                    </th>
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      Pool
                    </th>
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                    >
                      {displayCurrency === "native" ? "Amount" : "Value"}
                    </th>
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                    >
                      Yield APY
                    </th>
                    {showPendingLoss && (
                      <th
                        scope="col"
                        className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                      >
                        Pending Loss
                      </th>
                    )}
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {activePositions.map((position) => (
                    <tr
                      key={position.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-750"
                    >
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                            <Image
                              src={getProtocolLogo(position.id)}
                              alt={position.protocol}
                              width={32}
                              height={32}
                              className="rounded-full"
                            />
                          </div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {getProtocolName(position.id)}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-6 w-6 mr-2">
                            <Image
                              src={getTokenLogo(position.pool)}
                              alt={position.poolName}
                              width={24}
                              height={24}
                              className="rounded-full"
                            />
                          </div>
                          <div className="text-sm text-gray-900 dark:text-white">
                            {getTokenName(position.pool)}
                          </div>
                        </div>
                        <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                          {displayCurrency === "native"
                            ? `${position.amount}`
                            : formatCurrency(position.nativeValue, "USD", "usd")}
                        </div>
                        <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                          {formatPercentage(position.yield)}
                        </div>
                        {position.pendingLoss > 0 && (
                          <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                            Loss: {formatCurrency(position.pendingLoss, 'USD', displayCurrency)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {displayCurrency === "native"
                            ? `${position.amount}`
                            : formatCurrency(position.nativeValue, "USD", "usd")}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm font-medium text-green-600 dark:text-green-400">
                        {formatPercentage(position.yield)}
                      </div>
                    </td>
                    {showPendingLoss && (
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {formatCurrency(position.pendingLoss, 'USD', displayCurrency)}
                        </div>
                      </td>
                    )}
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${position.status === 'requested withdrawal'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                            }`}
                        >
                          {position.status}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium relative">
                        <button
                          onClick={() =>
                            setOpenDropdown(
                              openDropdown === position.id ? null : position.id
                            )
                          }
                          className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                        {openDropdown === position.id && (
                          <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10">
                            <div className="py-1" role="menu" aria-orientation="vertical">
                              <button
                                className="block px-4 py-2 text-sm w-full text-left text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                onClick={() => {
                                  handleOpenModal(position);
                                  setOpenDropdown(null);
                                }}
                              >
                                Manage
                              </button>
                              <button
                                className="block px-4 py-2 text-sm w-full text-left text-green-600 dark:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                onClick={() => {
                                  handleClaimRewards(position);
                                  setOpenDropdown(null);
                                }}
                                disabled={isClaiming}
                              >
                                {isClaiming ? "Claiming..." : "Claim Rewards"}
                              </button>
                              {withdrawalReady && details?.[0]?.withdrawalRequestShares > 0 && (
                                <button
                                  className="block px-4 py-2 text-sm w-full text-left text-purple-600 dark:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  onClick={() => {
                                    handleExecuteWithdrawal();
                                    setOpenDropdown(null);
                                  }}
                                  disabled={isExecuting}
                                >
                                  {isExecuting ? "Executing..." : "Execute Withdrawal"}
                                </button>
                              )}
                            </div>
                          </div>
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

      {withdrawalPositions.length > 0 && (
        <div className="mt-8 overflow-x-auto -mx-4 sm:mx-0">
          <div className="inline-block min-w-full align-middle">
            <div className="overflow-visible shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Protocol</th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pool</th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">{displayCurrency === "native" ? "Amount" : "Value"}</th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Unlock</th>
                    <th scope="col" className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {withdrawalPositions.map((position) => (
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
                          {displayCurrency === "native" ? `${position.amount}` : formatCurrency(position.nativeValue, "USD", "usd")}
                        </div>
                        <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                          {unlockDays}d
                        </div>
                        {position.pendingLoss > 0 && (
                          <div className="mt-1 sm:hidden text-xs text-red-600 dark:text-red-400">
                            Loss: {formatCurrency(position.pendingLoss, 'USD', displayCurrency)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {displayCurrency === "native" ? `${position.amount}` : formatCurrency(position.nativeValue, "USD", "usd")}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="text-sm font-medium text-green-600 dark:text-green-400">{unlockDays}d</div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {withdrawalReady && (
                          <button
                            onClick={handleExecuteWithdrawal}
                            disabled={isExecuting}
                            className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 disabled:opacity-50"
                          >
                            {isExecuting ? "Executing..." : "Withdraw"}
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
      <div className="mt-4 flex justify-end">
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
