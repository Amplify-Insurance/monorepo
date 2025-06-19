"use client";
import { useState, useEffect } from "react";
import Modal from "./Modal";
import usePools from "../../hooks/usePools";
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails";
import { useAccount } from "wagmi";
import Image from "next/image";
import Link from "next/link";
import { getProtocolLogo, getProtocolName } from "../config/tokenNameMap";
import { formatPercentage } from "../utils/formatting";
import { getRiskManagerWithSigner } from "../../lib/riskManager";
import deployments, { getDeployment } from "../config/deployments";
import { YieldPlatform } from "../config/yieldPlatforms";
import { notifyTx } from "../utils/explorer";

export default function ManageAllocationModal({ isOpen, onClose, deployment }) {
  const { pools } = usePools();
  const { address } = useAccount();
  const { details } = useUnderwriterDetails(address);
  const [selectedDeployment, setSelectedDeployment] = useState(deployment);

  const YIELD_TO_PROTOCOL_MAP = {
    [YieldPlatform.AAVE]: 0,
    [YieldPlatform.COMPOUND]: 1,
  };

  const baseProtocolId = (() => {
    const d = Array.isArray(details)
      ? details.find((dt) => dt.deployment === selectedDeployment)
      : details;
    return d ? YIELD_TO_PROTOCOL_MAP[d.yieldChoice] : undefined;
  })();

  const poolsForDeployment = pools
    .filter((p) => p.deployment === selectedDeployment)
    .filter((p) =>
      baseProtocolId === undefined ? true : Number(p.id) !== baseProtocolId
    );
  const [selectedPools, setSelectedPools] = useState([]);
  const [initialPools, setInitialPools] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (details) {
      const d = Array.isArray(details)
        ? details.find((dt) => dt.deployment === selectedDeployment)
        : details;
      const baseId = d ? YIELD_TO_PROTOCOL_MAP[d.yieldChoice] : undefined;
      if (d?.allocatedPoolIds) {
        const filtered = d.allocatedPoolIds.filter(
          (pid) => (baseId === undefined ? true : Number(pid) !== baseId)
        );
        setSelectedPools(filtered);
        setInitialPools(filtered);
      } else {
        setSelectedPools([]);
        setInitialPools([]);
      }
    }
  }, [details, selectedDeployment]);

  const togglePool = (id) => {
    setSelectedPools((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const dep = getDeployment(selectedDeployment);
      const rm = await getRiskManagerWithSigner(dep.riskManager);
      const toAllocate = selectedPools.filter((p) => !initialPools.includes(p));
      const toDeallocate = initialPools.filter((p) => !selectedPools.includes(p));

      if (toAllocate.length > 0) {
        const tx = await rm.allocateCapital(toAllocate);
        notifyTx(tx.hash);
        await tx.wait();
      }

      if (toDeallocate.length > 0) {
        const tx2 = await rm.deallocateCapital(toDeallocate);
        notifyTx(tx2.hash);
        await tx2.wait();
      }

      onClose();
    } catch (err) {
      console.error("Failed to allocate capital", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableDeployments = Array.isArray(details)
    ? details.map((d) => d.deployment)
    : deployment
    ? [deployment]
    : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Protocol Allocation">
      {availableDeployments.length > 1 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Asset
          </label>
          <select
            className="mt-1 block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            value={selectedDeployment}
            onChange={(e) => setSelectedDeployment(e.target.value)}
          >
            {availableDeployments.map((dep) => (
              <option key={dep} value={dep}>
                {dep.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-4">
        {poolsForDeployment.map((pool) => {
          const yieldRate = Number(pool.underwriterYieldBps || 0) / 100;
          return (
            <div
              key={pool.id}
              className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2"
            >
              <div className="flex items-center space-x-2">
                <Image
                  src={getProtocolLogo(pool.id)}
                  alt={getProtocolName(pool.id)}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
                <Link
                  href={`/pool/${pool.id}/${pool.protocolTokenToCover}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {getProtocolName(pool.id)}
                </Link>
                <span className="text-xs text-gray-500">
                  {formatPercentage(yieldRate)} APY
                </span>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                checked={selectedPools.includes(pool.id)}
                onChange={() => togglePool(pool.id)}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
        >
          {isSubmitting ? "Submitting..." : "Save"}
        </button>
      </div>
    </Modal>
  );
}
