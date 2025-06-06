"use client";
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import Image from "next/image";
import { formatCurrency, formatPercentage } from "../utils/formatting";
import ManageCoverageModal from "./ManageCoverageModal";
import { useAccount } from "wagmi";
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails";
import usePools from "../../hooks/usePools";
import { ethers } from "ethers";
import { getCoverPoolWithSigner } from "../lib/coverPool";

const PROTOCOL_NAMES = {
  1: "Protocol A",
  2: "Protocol B",
  3: "Protocol C",
  4: "Lido stETH",
  5: "Rocket rETH",
};

export default function UnderwritingPositions({ displayCurrency }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const { address } = useAccount();
  const { details } = useUnderwriterDetails(address);
  const { pools } = usePools();

  const underwritingPositions = (details?.allocatedPoolIds || [])
    .map((pid, i) => {
      const pool = pools.find((pl) => Number(pl.id) === Number(pid));
      if (!pool) return null;
      const protocol =
        PROTOCOL_NAMES[pool.protocolCovered] || `Pool ${pool.id}`;
      const amount = Number(
        ethers.formatUnits(
          details.totalDepositedAssetPrincipal,
          pool.underlyingAssetDecimals
        )
      );
      return {
        id: i,
        protocol,
        pool: pool.protocolTokenToCover,
        poolId: pid,
        amount,
        nativeValue: amount,
        yield: Number(pool.underwriterYieldBps || 0) / 100,
        status: "active",
        shares: details.masterShares,
      };
    })
    .filter(Boolean);

  const handleOpenModal = (position) => {
    setSelectedPosition(position);
    setModalOpen(true);
  };

  const handleClaimRewards = async (position) => {
    setIsClaiming(true);
    try {
      const cp = await getCoverPoolWithSigner();
      await (await cp.claimPremiumRewards(position.poolId)).wait();
      await (await cp.claimDistressedAssetRewards(position.poolId)).wait();
    } catch (err) {
      console.error("Failed to claim rewards", err);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleExecuteWithdrawal = async () => {
    setIsExecuting(true);
    try {
      const cp = await getCoverPoolWithSigner();
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

  if (underwritingPositions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
          <TrendingUp className="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
          No underwriting positions
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          You don't have any active underwriting positions. Visit the markets
          page to provide coverage.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              Total Value
            </div>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {formatCurrency(totalValue)}
            </div>
          </div>
          <div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              Average Yield
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatPercentage(averageYield)}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <div className="overflow-hidden shadow-sm ring-1 ring-black ring-opacity-5 sm:rounded-lg">
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
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Value
                  </th>
                  <th
                    scope="col"
                    className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell"
                  >
                    Yield APY
                  </th>
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
                {underwritingPositions.map((position) => (
                  <tr
                    key={position.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-750"
                  >
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 mr-2 sm:mr-3">
                          <Image
                            src={`/images/protocols/${position.protocol.toLowerCase()}.png`}
                            alt={position.protocol}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        </div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {position.protocol}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-6 w-6 mr-2">
                          <Image
                            src={`/images/tokens/${position.pool.toLowerCase()}.png`}
                            alt={position.pool}
                            width={24}
                            height={24}
                            className="rounded-full"
                          />
                        </div>
                        <div className="text-sm text-gray-900 dark:text-white">
                          {position.pool}
                        </div>
                      </div>
                      <div className="mt-1 sm:hidden text-xs text-gray-500 dark:text-gray-400">
                        {displayCurrency === "native"
                          ? `${position.amount} ${position.pool}`
                          : formatCurrency(position.nativeValue, "USD", "usd")}
                      </div>
                      <div className="mt-1 sm:hidden text-xs font-medium text-green-600 dark:text-green-400">
                        {formatPercentage(position.yield)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {displayCurrency === "native"
                          ? `${position.amount} ${position.pool}`
                          : formatCurrency(position.nativeValue, "USD", "usd")}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {formatCurrency(
                          position.nativeValue,
                          "USD",
                          displayCurrency
                        )}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <div className="text-sm font-medium text-green-600 dark:text-green-400">
                        {formatPercentage(position.yield)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap hidden sm:table-cell">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                        {position.status}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-2"
                        onClick={() => handleOpenModal(position)}
                      >
                        Manage
                      </button>
                      <button
                        className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 mr-2"
                        onClick={() => handleClaimRewards(position)}
                        disabled={isClaiming}
                      >
                        {isClaiming ? "Claiming..." : "Claim Rewards"}
                      </button>
                      <button
                        className="text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300"
                        onClick={handleExecuteWithdrawal}
                        disabled={isExecuting}
                      >
                        {isExecuting ? "Executing..." : "Execute Withdrawal"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
        />
      )}
    </div>
  );
}
