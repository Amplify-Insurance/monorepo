import { useAccount } from 'wagmi'
import { useMemo } from 'react'
import useUnderwriterDetails from './useUnderwriterDetails'
import usePools from './usePools'

export default function useMaxWithdrawable() {
  const { address } = useAccount()
  const { details } = useUnderwriterDetails(address)
  const { pools } = usePools()

  const maxWithdrawablePct = useMemo(() => {
    if (!address) return 1
    if (!details || pools.length === 0) return 1

    let maxUtil = 0
    for (const d of details) {
      const alloc = d.allocatedPoolIds || []
      for (const pid of alloc) {
        const pool = pools.find(
          (p) => p.deployment === d.deployment && Number(p.id) === Number(pid),
        )
        if (!pool) continue
        const pledged = Number(pool.totalCapitalPledgedToPool || 0)
        const sold = Number(pool.totalCoverageSold || 0)
        const util = pledged > 0 ? sold / pledged : 0
        if (util > maxUtil) maxUtil = util
      }
    }
    const pct = 1 - maxUtil
    return pct < 0 ? 0 : pct
  }, [address, details, pools])

  return { maxWithdrawablePct }
}
