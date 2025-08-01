import { useState, useEffect } from 'react'
import { getPoolRegistry } from '../lib/poolRegistry'
import { getCapitalPool } from '../lib/capitalPool'
import { getPolicyManager } from '../lib/policyManager'
import { getMulticallReader } from '../lib/multicallReader'
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
        const multicall = getMulticallReader(dep.multicallReader, dep.name)
        const calls = [
          { target: dep.policyManager, callData: pm.interface.encodeFunctionData('coverCooldownPeriod') },
          { target: dep.poolRegistry, callData: pr.interface.encodeFunctionData('getPoolStaticData', [poolId]) },
          { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('underwriterNoticePeriod') },
        ]
        const res = await multicall.tryAggregate(false, calls)
        const cooldown = res[0].success ? pm.interface.decodeFunctionResult('coverCooldownPeriod', res[0].returnData)[0] : 0n
        const poolData = res[1].success ? pr.interface.decodeFunctionResult('getPoolStaticData', res[1].returnData) : null
        const claimFee = poolData ? (poolData.claimFeeBps ?? poolData[4]) : 0n
        const notice = res[2].success ? cp.interface.decodeFunctionResult('underwriterNoticePeriod', res[2].returnData)[0] : 0n
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
