import { useState, useEffect } from 'react'
import { getPoolRegistry } from '../lib/poolRegistry'
import { getCapitalPool } from '../lib/capitalPool'
import { getPolicyManager } from '../lib/policyManager'
import deployments from '../app/config/deployments'

export default function useReserveConfig(deployment, poolId = 0) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const dep =
          deployments.find((d) => d.name === deployment) ?? deployments[0]
        const pr = getPoolRegistry(dep.poolRegistry, dep.name)
        const cp = getCapitalPool(dep.capitalPool, dep.name)
        const pm = getPolicyManager(dep.policyManager, dep.name)
        const [cooldown, poolData, notice] = await Promise.all([
          pm.coverCooldownPeriod(),
          pr.getPoolStaticData(poolId),
          cp.underwriterNoticePeriod(),
        ])
        const claimFee = poolData.claimFeeBps ?? poolData[4]
        setConfig({
          coverCooldownPeriod: Number(cooldown.toString()),
          claimFeeBps: Number(claimFee.toString()),
          underwriterNoticePeriod: Number(notice.toString()),
        })
      } catch (err) {
        console.error('Failed to load reserve config', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [deployment, poolId])

  return { config, loading }
}
