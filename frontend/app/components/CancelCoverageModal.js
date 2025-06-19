"use client";

import { useState } from "react";
import Modal from "./Modal";
import Image from "next/image";
import { getDeployment } from "../config/deployments";
import {
  getProtocolLogo,
  getProtocolName,
  getTokenName,
} from "../config/tokenNameMap";
import { getPoolManagerWithSigner } from "../../lib/poolManager";
import { getTxExplorerUrl } from "../utils/explorer";

export default function CancelCoverageModal({ isOpen, onClose, coverage }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState("");

  if (!coverage) return null;

  const tokenName = getTokenName(coverage.pool);
  const protocolName = coverage.protocol || getProtocolName(coverage.pool);
  const protocolLogo = coverage.protocolLogo || getProtocolLogo(coverage.pool);

  const handleCancel = async () => {
    setIsSubmitting(true);
    try {
      const dep = getDeployment(coverage.deployment);
      const pm = await getPoolManagerWithSigner(dep.poolManager);
      const tx = await pm.cancelCover(coverage.id, { gasLimit: 500000 });
      setTxHash(tx.hash);
      await tx.wait();
      onClose(true);
    } catch (err) {
      console.error("Failed to cancel coverage", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => onClose(false)}
      title="Cancel Coverage"
    >
      <div className="space-y-4">
        <div className="flex items-center space-x-3">
          <Image
            src={protocolLogo}
            alt={protocolName}
            width={32}
            height={32}
            className="rounded-full"
          />
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {protocolName} {tokenName}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Coverage ID #{coverage.id}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Canceling returns any unused premium and ends your protection early.
        </p>
        <div className="flex justify-end pt-2">
          <button
            onClick={() => onClose(false)}
            className="mr-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-md text-sm"
          >
            Close
          </button>
          <button
            onClick={handleCancel}
            disabled={isSubmitting}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm disabled:opacity-50"
          >
            {isSubmitting ? "Cancelling..." : "Confirm"}
          </button>
          {txHash && (
            <p className="text-xs text-center mt-2 w-full">
              Transaction submitted.{' '}
              <a
                href={getTxExplorerUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View on block explorer
              </a>
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
