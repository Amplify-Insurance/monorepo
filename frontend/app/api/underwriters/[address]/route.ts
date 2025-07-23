// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { getCapitalPool } from '@/lib/capitalPool'
import { getUnderwriterManager } from '@/lib/underwriterManager'
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
      const rm = getUnderwriterManager(dep.underwriterManager, dep.name)
      const pr = getPoolRegistry(dep.poolRegistry, dep.name)
      const ld = getLossDistributor(dep.lossDistributor, dep.name)
      const multicall = getMulticallReader(dep.multicallReader, dep.name)

      try {
        const baseCalls = [
          { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('getUnderwriterAccount', [addr]) },
          { target: dep.poolRegistry, callData: pr.interface.encodeFunctionData('getPoolCount') },
        ]
        const baseResults = await multicall.tryAggregate(false, baseCalls)

        const account = baseResults[0].success
          ? cp.interface.decodeFunctionResult('getUnderwriterAccount', baseResults[0].returnData)
          : [0n, 0n, 0n, 0n]

        // Fetch notice period and withdrawal request data directly
        const [noticePeriod, requestCount, deallocationPeriod] = await Promise.all([
          cp.underwriterNoticePeriod(),
          cp.getWithdrawalRequestCount(addr),
          rm.deallocationNoticePeriod(),
        ])

        let withdrawalRequestTimestamp = 0n
        let withdrawalRequestShares = 0n
        if (requestCount > 0n) {
          try {
            const req = await cp.withdrawalRequests(addr, 0)
            withdrawalRequestShares = req.shares
            if (req.unlockTimestamp > noticePeriod) {
              withdrawalRequestTimestamp = req.unlockTimestamp - noticePeriod
            }
          } catch {}
        }

        let poolCount = 0n
        if (baseResults[1].success) {
          try {
            poolCount = pr.interface.decodeFunctionResult('getPoolCount', baseResults[1].returnData)[0]
          } catch {}
        }
        if (!baseResults[1].success) {
          while (true) {
            try { await pr.getPoolStaticData(poolCount); poolCount++ } catch { break }
          }
        }

        const pledge = account[0]

        const allocCalls: { target: string; callData: string }[] = []
        for (let i = 0; i < Number(poolCount); i++) {
          allocCalls.push({
            target: dep.underwriterManager,
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
            callData: ld.interface.encodeFunctionData('getProspectiveLosses', [addr, BigInt(id), pledge]),
          })
        }

        const lossResults = await multicall.tryAggregate(false, lossCalls)

        const pendingLosses: Record<string, string> = {}
        for (let i = 0; i < lossResults.length; i++) {
          if (!lossResults[i].success) continue
          try {
            const [loss] = ld.interface.decodeFunctionResult('getProspectiveLosses', lossResults[i].returnData)
            pendingLosses[allocatedPoolIds[i]] = loss.toString()
          } catch {}
        }

        const deallocCalls: { target: string; callData: string }[] = []
        for (const id of allocatedPoolIds) {
          deallocCalls.push({
            target: dep.underwriterManager,
            callData: rm.interface.encodeFunctionData('deallocationRequestTimestamp', [addr, BigInt(id)]),
          })
        }

        const deallocResults = await multicall.tryAggregate(false, deallocCalls)

        const deallocationRequests: Record<string, string> = {}
        for (let i = 0; i < deallocResults.length; i++) {
          if (!deallocResults[i].success) continue
          try {
            const [ts] = rm.interface.decodeFunctionResult('deallocationRequestTimestamp', deallocResults[i].returnData)
            if (ts > 0n) {
              deallocationRequests[allocatedPoolIds[i]] = ts.toString()
            }
          } catch {}
        }

        details.push({
          deployment: dep.name,
          totalDepositedAssetPrincipal: account[0].toString(),
          yieldChoice: account[1].toString(),
          masterShares: account[2].toString(),
          withdrawalRequestTimestamp: withdrawalRequestTimestamp.toString(),
          withdrawalRequestShares: withdrawalRequestShares.toString(),
          deallocationNoticePeriod: deallocationPeriod.toString(),
          deallocationRequests,
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
