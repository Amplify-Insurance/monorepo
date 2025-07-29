import { useEffect, useState, useCallback } from "react";
import { getCatPoolWithSigner } from "../lib/catPool";

// Fallback to 30 days if reading from the contract fails
const DEFAULT_NOTICE_PERIOD = 30 * 24 * 60 * 60;

export default function useCatPoolWithdrawalRequest(address) {
  const [request, setRequest] = useState(null);
  const [noticePeriod, setNoticePeriod] = useState(DEFAULT_NOTICE_PERIOD);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const cp = await getCatPoolWithSigner();
      const [shares, ts, np] = await Promise.all([
        cp.withdrawalRequestShares(address),
        cp.withdrawalRequestTimestamp(address),
        cp.NOTICE_PERIOD(),
      ]);
      if (shares && shares.gt(0)) {
        setRequest({ shares, timestamp: ts.toNumber() });
      } else {
        setRequest(null);
      }
      if (np) {
        setNoticePeriod(Number(np));
      }
    } catch (err) {
      console.error("Failed to load backstop pool withdrawal request", err);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  return { request, refresh: load, NOTICE_PERIOD: noticePeriod };
}
