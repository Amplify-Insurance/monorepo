// app/api/underwriters/[address]/route.ts
import { NextResponse } from 'next/server'
import { getCapitalPool } from '@/lib/capitalPool'
import { getUnderwriterManager } from '@/lib/underwriterManager'
import { getPoolRegistry } from '@/lib/poolRegistry'
import deployments from '../../../config/deployments'
import { getLossDistributor } from '@/lib/lossDistributor'
import { getMulticallReader } from '@/lib/multicallReader'

/**
 * @interface UnderwriterDeploymentDetails
 * @description Defines the shape of the data returned for each deployment.
 * It includes a status field to distinguish between successful and failed data fetches.
 */
interface UnderwriterDeploymentDetails {
  deployment: string;
  status: 'success' | 'error';
  error?: string;
  totalDepositedAssetPrincipal?: string;
  yieldChoice?: string;
  masterShares?: string;
  withdrawalRequestTimestamp?: string;
  withdrawalRequestShares?: string;
  deallocationNoticePeriod?: string;
  deallocationRequests?: Record<string, string>;
  allocatedPoolIds?: number[];
  pendingLosses?: Record<string, string>;
  riskAdjustedPledges?: Record<string, string>;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await context.params;
    const addr = address.toLowerCase();

    const details: UnderwriterDeploymentDetails[] = [];

    // Use Promise.all to fetch details for all deployments in parallel
    await Promise.all(deployments.map(async (dep) => {
      try {
        const cp = getCapitalPool(dep.capitalPool, dep.name);
        const rm = getUnderwriterManager(dep.underwriterManager, dep.name);
        const pr = getPoolRegistry(dep.poolRegistry, dep.name);
        const ld = getLossDistributor(dep.lossDistributor, dep.name);
        const multicall = getMulticallReader(dep.multicallReader, dep.name);

        // --- 1. Base Data Multicall ---
        const baseCalls = [
          { target: dep.capitalPool, callData: cp.interface.encodeFunctionData('getUnderwriterAccount', [addr]) },
          { target: dep.poolRegistry, callData: pr.interface.encodeFunctionData('getPoolCount') },
        ];
        const baseResults = await multicall.tryAggregate(false, baseCalls);

        // Handle underwriter account data
        const account = baseResults[0].success
          ? cp.interface.decodeFunctionResult('getUnderwriterAccount', baseResults[0].returnData)
          : [0n, 0n, 0n, 0n]; // Default to zeroed-out account on failure

        // Handle pool count
        if (!baseResults[1].success) {
          throw new Error('Failed to fetch pool count from PoolRegistry.');
        }
        const poolCount = pr.interface.decodeFunctionResult('getPoolCount', baseResults[1].returnData)[0];
        
        // --- 2. Parallel Individual Calls ---
        const [noticePeriod, requestCount, deallocationPeriod] = await Promise.all([
          cp.underwriterNoticePeriod(),
          cp.getWithdrawalRequestCount(addr),
          rm.deallocationNoticePeriod(),
        ]);

        let withdrawalRequestTimestamp = 0n;
        let withdrawalRequestShares = 0n;
        if (requestCount > 0n) {
          try {
            // Fetch only the first withdrawal request (index 0)
            const req = await cp.withdrawalRequests(addr, 0);
            withdrawalRequestShares = req.shares;
            // The timestamp when the request was made is unlockTimestamp - noticePeriod
            if (req.unlockTimestamp > noticePeriod) {
              withdrawalRequestTimestamp = req.unlockTimestamp - noticePeriod;
            }
          } catch (e) {
            console.warn(`Could not fetch withdrawal request for ${addr} on ${dep.name}:`, e);
          }
        }
        
        // --- 3. Get Allocated Pools ---
        const allocCalls = Array.from({ length: Number(poolCount) }, (_, i) => ({
          target: dep.underwriterManager,
          callData: rm.interface.encodeFunctionData('isAllocatedToPool', [addr, BigInt(i)]),
        }));
        
        const allocResults = allocCalls.length > 0 ? await multicall.tryAggregate(false, allocCalls) : [];

        const allocatedPoolIds: number[] = [];
        allocResults.forEach((result, i) => {
          if (result.success) {
            try {
              const [isAllocated] = rm.interface.decodeFunctionResult('isAllocatedToPool', result.returnData);
              if (isAllocated) {
                allocatedPoolIds.push(i);
              }
            } catch (e) {
              console.warn(`Could not decode isAllocatedToPool result for pool ${i} on ${dep.name}:`, e);
            }
          }
        });

        // --- 4. Fetch Pool-Specific Data in Parallel Multicalls ---
        const [lossResults, netResults, deallocResults] = await Promise.all([
          // Pending Losses
          multicall.tryAggregate(false, allocatedPoolIds.map(id => ({
            target: dep.lossDistributor,
            callData: ld.interface.encodeFunctionData('getPendingLosses', [addr, BigInt(id), account[0]]),
          }))),
          // Risk-Adjusted Pledges
          multicall.tryAggregate(false, allocatedPoolIds.map(id => ({
            target: dep.underwriterManager,
            callData: rm.interface.encodeFunctionData('getRiskAdjustedPledge', [addr, BigInt(id)]),
          }))),
          // Deallocation Requests
          multicall.tryAggregate(false, allocatedPoolIds.map(id => ({
            target: dep.underwriterManager,
            callData: rm.interface.encodeFunctionData('deallocationRequestTimestamp', [addr, BigInt(id)]),
          }))),
        ]);

        // --- 5. Process and Assemble Results ---
        const pendingLosses: Record<string, string> = {};
        const riskAdjustedPledges: Record<string, string> = {};
        const deallocationRequests: Record<string, string> = {};

        allocatedPoolIds.forEach((poolId, i) => {
          // Process losses
          if (lossResults[i]?.success) {
            try {
              const [loss] = ld.interface.decodeFunctionResult('getPendingLosses', lossResults[i].returnData);
              pendingLosses[poolId] = loss.toString();
            } catch (e) { console.warn(`Could not decode pendingLosses for pool ${poolId} on ${dep.name}:`, e); }
          }
          // Process risk-adjusted pledges
          if (netResults[i]?.success) {
            try {
              const [net] = rm.interface.decodeFunctionResult('getRiskAdjustedPledge', netResults[i].returnData);
              riskAdjustedPledges[poolId] = net.toString();
            } catch (e) { console.warn(`Could not decode riskAdjustedPledge for pool ${poolId} on ${dep.name}:`, e); }
          }
          // Process deallocation requests
          if (deallocResults[i]?.success) {
            try {
              const [ts] = rm.interface.decodeFunctionResult('deallocationRequestTimestamp', deallocResults[i].returnData);
              if (ts > 0n) {
                deallocationRequests[poolId] = ts.toString();
              }
            } catch (e) { console.warn(`Could not decode deallocationRequestTimestamp for pool ${poolId} on ${dep.name}:`, e); }
          }
        });

        // Push the successful result
        details.push({
          deployment: dep.name,
          status: 'success',
          totalDepositedAssetPrincipal: account[0].toString(),
          yieldChoice: account[1].toString(),
          masterShares: account[2].toString(),
          withdrawalRequestTimestamp: withdrawalRequestTimestamp.toString(),
          withdrawalRequestShares: withdrawalRequestShares.toString(),
          deallocationNoticePeriod: deallocationPeriod.toString(),
          deallocationRequests,
          allocatedPoolIds,
          pendingLosses,
          riskAdjustedPledges,
        });

      } catch (err) {
        // If anything in the try block fails for a deployment, log it and push an error object.
        console.error(`Failed to fetch underwriter details for deployment ${dep.name}:`, err);
        details.push({
          deployment: dep.name,
          status: 'error',
          error: (err as Error).message || 'An unknown error occurred.',
        });
      }
    }));

    return NextResponse.json({ address: addr, details });
  } catch (err: any) {
    // This outer catch handles fundamental errors, like failing to parse the request params.
    return NextResponse.json(
      { error: err?.message ?? 'Internal Server Error' },
      { status: 500 },
    );
  }
}