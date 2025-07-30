import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import useClaims from './useClaims'
import usePools from './usePools'
import { getClaimsCollateralManager } from '../lib/claimsCollateralManager'

export default function useUnderwriterClaims(address) {
  const { claims } = useClaims()
  const { pools } = usePools()
  const [positions, setPositions] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const manager = getClaimsCollateralManager()
      const results = []
      for (const c of claims) {
        const pool = pools.find(p => Number(p.id) === c.poolId)
        if (!pool) continue
        try {
          const [amount, claimed] = await manager.getUnderwriterClaimStatus(c.policyId, address)
          if (amount > 0n) {
            const { collateralAsset } = await manager.claims(c.policyId)
            const amountNum = Number(ethers.utils.formatUnits(amount, pool.protocolTokenDecimals ?? 18))
            results.push({
              id: c.policyId,
              poolId: c.poolId,
              collateralAsset,
              amount: amountNum,
              claimed,
              claimDate: new Date(c.timestamp * 1000).toISOString(),
            })
          }
        } catch (err) {
          console.error('Failed to load underwriter claim', err)
        }
      }
      setPositions(results)
    } catch (err) {
      console.error('Failed to load underwriter claims', err)
    } finally {
      setLoading(false)
    }
  }, [address, claims, pools])

  useEffect(() => {
    load()
  }, [load])

  return { positions, loading, refresh: load }
}
