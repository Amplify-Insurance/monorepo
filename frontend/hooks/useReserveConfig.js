import { useState, useEffect } from 'react'
import { getPoolRegistry } from '../lib/poolRegistry'
import { getCapitalPool } from '../lib/capitalPool'
import { getPoolManager } from '../lib/poolManager'
import deployments from '../app/config/deployments'

export default function useReserveConfig(deployment) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const dep =
          deployments.find((d) => d.name === deployment) ?? deployments[0]
        const pr = getPoolRegistry(dep.poolRegistry, dep.name)
        const cp = getCapitalPool(dep.capitalPool, dep.name)
        const pm = getPoolManager(dep.poolManager, dep.name)
        const [cooldown, poolData, notice] = await Promise.all([
          pm.coverCooldownPeriod(),
          pr.getPoolData(0),
          cp.underwriterNoticePeriod(),
        ])
        const claimFee = poolData.claimFeeBps ?? poolData[6]
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
  }, [deployment])

  return { config, loading }
}
