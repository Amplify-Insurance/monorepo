import { useEffect, useState, useCallback } from 'react'
import { getCatPoolWithSigner } from '../lib/catPool'

const NOTICE_PERIOD = 30 * 24 * 60 * 60 // 30 days in seconds

export default function useCatPoolWithdrawalRequest(address) {
  const [request, setRequest] = useState(null)

  const load = useCallback(async () => {
    if (!address) return
    try {
      const cp = await getCatPoolWithSigner()
      const [shares, ts] = await Promise.all([
        cp.withdrawalRequestShares(address),
        cp.withdrawalRequestTimestamp(address),
      ])
      if (shares && shares.gt(0)) {
        setRequest({ shares, timestamp: ts.toNumber() })
      } else {
        setRequest(null)
      }
    } catch (err) {
      console.error('Failed to load backstop pool withdrawal request', err)
    }
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  return { request, refresh: load, NOTICE_PERIOD }
}
