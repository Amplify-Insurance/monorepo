import { useState, useEffect } from 'react'
import { getRiskManager } from '../lib/riskManager'
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
        const rm = getRiskManager(dep.riskManager, dep.name)
        const cp = getCapitalPool(dep.capitalPool, dep.name)
        const pm = getPoolManager(dep.poolManager, dep.name)
        const [cooldown, claimFee, notice] = await Promise.all([
          pm.COVER_COOLDOWN_PERIOD(),
          rm.CLAIM_FEE_BPS(),
          cp.UNDERWRITER_NOTICE_PERIOD(),
        ])
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
