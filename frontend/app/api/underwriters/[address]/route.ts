// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { getCapitalPool } from '@/lib/capitalPool'
import { getRiskManager } from '@/lib/riskManager'
import { getPoolRegistry } from '@/lib/poolRegistry'
import deployments from '../../../config/deployments'
import { getLossDistributor } from '@/lib/lossDistributor'
import { getMulticallReader } from '@/lib/multicallReader'

export async function GET(
  _req: Request,
  context: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await context.params
    const addr = address.toLowerCase()

    const details: any[] = []

    for (const dep of deployments) {
      const cp = getCapitalPool(dep.capitalPool, dep.name)
      const rm = getRiskManager(dep.riskManager, dep.name)
      const pr = getPoolRegistry(dep.poolRegistry, dep.name)
      const ld = getLossDistributor(dep.lossDistributor, dep.name)
      const multicall = getMulticallReader(dep.multicallReader, dep.name)

      try {
        const baseCalls = [
          { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('getUnderwriterAccount', [addr]) },
          { target: dep.poolRegistry, callData: pr.interface.encodeFunctionData('getPoolCount') },
          { target: dep.riskManager, callData: rm.interface.encodeFunctionData('underwriterTotalPledge', [addr]) },
        ]
        const baseResults = await multicall.tryAggregate(false, baseCalls)

        const account = baseResults[0].success
          ? cp.interface.decodeFunctionResult('getUnderwriterAccount', baseResults[0].returnData)
          : [0n, 0n, 0n, 0n, 0n]

        let poolCount = 0n
        if (baseResults[1].success) {
          try {
            poolCount = pr.interface.decodeFunctionResult('getPoolCount', baseResults[1].returnData)[0]
          } catch {}
        }
        if (!baseResults[1].success) {
          while (true) {
            try { await pr.getPoolData(poolCount); poolCount++ } catch { break }
          }
        }

        let pledge = 0n
        if (baseResults[2].success) {
          try {
            pledge = rm.interface.decodeFunctionResult('underwriterTotalPledge', baseResults[2].returnData)[0]
          } catch {}
        }

        const allocCalls: { target: string; callData: string }[] = []
        for (let i = 0; i < Number(poolCount); i++) {
          allocCalls.push({
            target: dep.riskManager,
            callData: rm.interface.encodeFunctionData('isAllocatedToPool', [addr, BigInt(i)]),
          })
        }

        const allocResults = await multicall.tryAggregate(false, allocCalls)

        const allocatedPoolIds: number[] = []
        for (let i = 0; i < allocResults.length; i++) {
          if (!allocResults[i].success) continue
          try {
            const [alloc] = rm.interface.decodeFunctionResult('isAllocatedToPool', allocResults[i].returnData)
            if (alloc) allocatedPoolIds.push(i)
          } catch {}
        }

        const lossCalls: { target: string; callData: string }[] = []
        for (const id of allocatedPoolIds) {
          lossCalls.push({
            target: dep.lossDistributor,
            callData: ld.interface.encodeFunctionData('getPendingLosses', [addr, BigInt(id), pledge]),
          })
        }

        const lossResults = await multicall.tryAggregate(false, lossCalls)

        const pendingLosses: Record<string, string> = {}
        for (let i = 0; i < lossResults.length; i++) {
          if (!lossResults[i].success) continue
          try {
            const [loss] = ld.interface.decodeFunctionResult('getPendingLosses', lossResults[i].returnData)
            pendingLosses[allocatedPoolIds[i]] = loss.toString()
          } catch {}
        }

        details.push({
          deployment: dep.name,
          totalDepositedAssetPrincipal: account[0],
          yieldChoice: account[1],
          masterShares: account[2],
          withdrawalRequestTimestamp: account[3],
          withdrawalRequestShares: account[4],
          allocatedPoolIds,
          pendingLosses,
        })
      } catch {}
    }

    return NextResponse.json({ address: addr, details })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
