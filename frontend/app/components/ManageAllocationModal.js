"use client";
import { useState, useEffect } from "react";
import Modal from "./Modal";
import usePools from "../../hooks/usePools";
import useUnderwriterDetails from "../../hooks/useUnderwriterDetails";
import { useAccount } from "wagmi";
import Image from "next/image";
import { getProtocolLogo, getProtocolName } from "../config/tokenNameMap";
import { getRiskManagerWithSigner } from "../../lib/riskManager";

export default function ManageAllocationModal({ isOpen, onClose }) {
  const { pools } = usePools();
  const { address } = useAccount();
  const { details } = useUnderwriterDetails(address);
  const [selectedPools, setSelectedPools] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (details?.allocatedPoolIds) {
      setSelectedPools(details.allocatedPoolIds);
    }
  }, [details]);

  const togglePool = (id) => {
    setSelectedPools((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const rm = await getRiskManagerWithSigner();
      const tx = await rm.allocateCapital(selectedPools);
      await tx.wait();
      onClose();
    } catch (err) {
      console.error("Failed to allocate capital", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Protocol Allocation">
      <div className="space-y-4">
        {pools.map((pool) => (
          <div
            key={pool.id}
            className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2"
          >
            <div className="flex items-center">
              <Image
                src={getProtocolLogo(pool.id)}
                alt={getProtocolName(pool.id)}
                width={32}
                height={32}
                className="rounded-full mr-2"
              />
              <span className="text-sm text-gray-900 dark:text-gray-200">
                {getProtocolName(pool.id)}
              </span>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              checked={selectedPools.includes(pool.id)}
              onChange={() => togglePool(pool.id)}
            />
          </div>
        ))}
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
