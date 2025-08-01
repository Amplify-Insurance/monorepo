// app/api/pools/route.ts
import { NextResponse } from "next/server";
import { getPoolRegistry } from "../../../../lib/poolRegistry";
import { getPolicyManager } from "../../../../lib/policyManager";
import { getPriceOracle } from "../../../../lib/priceOracle";
import { getMulticallReader } from "../../../../lib/multicallReader";
import {
  getUnderlyingAssetAddress,
  getUnderlyingAssetDecimals,
} from "../../../../lib/capitalPool";
import { getUnderwriterManager } from "../../../../lib/underwriterManager";
import { getCapitalPool } from "../../../../lib/capitalPool";
import { getLossDistributor } from "../../../../lib/lossDistributor";
import bnToString from "../../../../lib/bnToString";
import { ethers } from "ethers";
import deployments from "../../../config/deployments";
import { getProvider } from "../../../../lib/provider";

type CachedPools = {
  block: number;
  pools: any[];
};

const poolsCache = new Map<string, CachedPools>();

interface RiskCacheEntry {
  totalCoverageSold: string;
  totalCapitalPledgedToPool: string;
  capitalPendingWithdrawal: string;
  capacity: string;
}

const riskCache = new Map<string, Map<number, RiskCacheEntry>>();

function pLimit(concurrency: number) {
  const queue: (() => void)[] = [];
  let active = 0;
  const next = () => {
    active--;
    if (queue.length) {
      const fn = queue.shift();
      if (fn) fn();
    }
  };
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

const limit = pLimit(5);

/**
 * Basis‑points denominator (10 000) expressed as bigint for fixed‑point math.
 */
const BPS = 10_000n;

/**
 * Recursively walk a value converting:
 * • native `bigint` → `string`
 * • ethers `BigNumber` → `string`
 * While doing so we strip the numeric index keys automatically added by the
 * ABI‑coder so the final JSON only contains the *named* Solidity struct fields.
 *
 * For inner structs that come back as an *array* **and** also carry named keys
 * (e.g. `rateModel`), we keep the named‑key object instead of an index array so
 * callers can reference `rateModel.base` rather than guessing positions.
 */

/**
 * Pool‑utilisation helper used by the premium‑rate function.
 */
function calcUtilization(pool: any): bigint {
  const totalCapital = BigInt(pool.totalCapitalPledgedToPool);
  const sold = BigInt(pool.totalCoverageSold);
  if (totalCapital === 0n) return 0n;
  return (sold * BPS) / totalCapital;
}

/**
 * Effective annual yield to underwriters in basis points.
 */
function calcUnderwriterYieldBps(pool: any, catPremiumBps: bigint): bigint {
  const rate = calcPremiumRateBps(pool);
  const sold = BigInt(pool.totalCoverageSold);
  const totalCapital = BigInt(pool.totalCapitalPledgedToPool);
  if (totalCapital === 0n || sold === 0n) return 0n;
  const uwRate = (rate * (BPS - catPremiumBps)) / BPS;
  return (uwRate * sold) / totalCapital;
}

/**
 * Piece‑wise linear rate model taken from the contract.
 */
function calcPremiumRateBps(pool: any): bigint {
  const u = calcUtilization(pool);
  const base = BigInt(pool.rateModel.base);
  const slope1 = BigInt(pool.rateModel.slope1);
  const slope2 = BigInt(pool.rateModel.slope2);
  const kink = BigInt(pool.rateModel.kink);
  if (u < kink) {
    return base + (slope1 * u) / BPS;
  }
  return base + (slope1 * kink) / BPS + (slope2 * (u - kink)) / BPS;
}

async function calcRiskAdjustedCapacity(
  dep: any,
  poolId: number,
  coverageSold: string,
) {
  try {
    const uwm = getUnderwriterManager(dep.underwriterManager, dep.name);
    const cp = getCapitalPool(dep.capitalPool, dep.name);
    const ld = getLossDistributor(dep.lossDistributor, dep.name);
    const underwriters: string[] = await uwm.getPoolUnderwriters(poolId);

    const netVals = await Promise.all(
      underwriters.map(async (uw) => {
        const [account, allocations] = await Promise.all([
          cp.getUnderwriterAccount(uw),
          uwm.getUnderwriterAllocations(uw),
        ]);
        const [, , masterShares] = account;

        const grossValPromise = cp.sharesToValue(masterShares);
        const pendingSharesArr = await Promise.all(
          allocations.map(async (pid) => {
            const pledge = await uwm.underwriterPoolPledge(uw, pid);
            const pending = await ld.getPendingLosses(uw, pid, pledge);
            return BigInt(pending.toString());
          }),
        );
        const pendingShares = pendingSharesArr.reduce(
          (sum, val) => sum + val,
          0n,
        );
        const grossVal = BigInt((await grossValPromise).toString());
        const pendingVal =
          pendingShares > 0n
            ? BigInt((await cp.sharesToValue(pendingShares)).toString())
            : 0n;
        const net = grossVal > pendingVal ? grossVal - pendingVal : 0n;
        return net;
      }),
    );

    const totalNet = netVals.reduce((sum, val) => sum + val, 0n);
    const sold = BigInt(coverageSold);
    const capacity = totalNet > sold ? totalNet - sold : 0n;
    return capacity.toString();
  } catch (err) {
    console.error("Failed to calc risk adjusted capacity", err);
    return "0";
  }
}

/**
 * GET /api/pools – returns protocol pool metadata enriched with calculated
 * premium rates and underwriter yields.
 */
export async function GET() {
  const allPools: any[] = [];
  for (const dep of deployments) {
    const provider = getProvider(dep.name);
    const block = await provider.getBlockNumber();
    const cached = poolsCache.get(dep.name);
    if (cached && cached.block === block) {
      allPools.push(...cached.pools);
      continue;
    }

    const poolRegistry = getPoolRegistry(dep.poolRegistry, dep.name);
    const policyManager = getPolicyManager(dep.policyManager, dep.name);
    const priceOracle = getPriceOracle(dep.priceOracle, dep.name);
    const underwriterManager = getUnderwriterManager(dep.underwriterManager, dep.name);
    const prevRisk = riskCache.get(dep.name) || new Map<number, RiskCacheEntry>();
    const newRisk = new Map<number, RiskCacheEntry>();
    const depPools: any[] = [];
    try {
      /* 1️⃣ How many pools exist? */
      let count = 0n;
      try {
        count = await poolRegistry.getPoolCount();
      } catch {
        // Fallback: iterate until call‑revert when the length function is absent.
        while (true) {
          try {
            await poolRegistry.getPoolStaticData(count);
            count++;
          } catch {
            break;
          }
        }
      }

      /* 2️⃣ Fetch catastrophe premium bps */
      let catPremiumBps: bigint = 2000n; // default
      try {
        const raw = await policyManager.catPremiumBps();
        catPremiumBps = BigInt(raw.toString());
      } catch {
        // ignore – fallback already set
      }

      /* 3️⃣ Pull each pool and compute derivatives via multicall */
      const multicall = getMulticallReader(dep.multicallReader, dep.name);
      const pools: any[] = [];
      let underlyingDec = 6;
      let underlyingAsset = "";
      try {
        underlyingAsset = await getUnderlyingAssetAddress(
          dep.capitalPool,
          dep.name,
        );
        underlyingDec = Number(
          await getUnderlyingAssetDecimals(dep.capitalPool, dep.name),
        );
      } catch {
        // ignore
      }

      const poolCalls = [] as { target: string; callData: string }[];
      for (let i = 0; i < Number(count); i++) {
        poolCalls.push({
          target: dep.poolRegistry,
          callData: poolRegistry.interface.encodeFunctionData(
            "getPoolStaticData",
            [i]
          ),
        });
        poolCalls.push({
          target: dep.poolRegistry,
          callData: poolRegistry.interface.encodeFunctionData(
            "getPoolRateModel",
            [i]
          ),
        });
        poolCalls.push({
          target: dep.underwriterManager,
          callData: underwriterManager.interface.encodeFunctionData(
            "totalCapitalPledgedToPool",
            [i]
          ),
        });
        poolCalls.push({
          target: dep.underwriterManager,
          callData: underwriterManager.interface.encodeFunctionData(
            "capitalPendingWithdrawal",
            [i]
          ),
        });
        // --- FIX: Use the correct function name 'getPoolRiskRating' ---
        poolCalls.push({
          target: dep.poolRegistry,
          callData: poolRegistry.interface.encodeFunctionData("getPoolRiskRating", [i]),
        });
      }

      const poolResults = await multicall.tryAggregate(true, poolCalls);

      for (let i = 0; i < Number(count); i++) {
        const dataRes = poolResults[5 * i];
        const rateRes = poolResults[5 * i + 1];
        const totalRes = poolResults[5 * i + 2];
        const pendingRes = poolResults[5 * i + 3];
        const riskRes = poolResults[5 * i + 4];
        if (!dataRes.success || !rateRes.success) continue;
        try {
          const dataDec = poolRegistry.interface.decodeFunctionResult(
            "getPoolStaticData",
            dataRes.returnData,
          );
          const rateDec = poolRegistry.interface.decodeFunctionResult(
            "getPoolRateModel",
            rateRes.returnData,
          );
          const [totalDec] = underwriterManager.interface.decodeFunctionResult(
            "totalCapitalPledgedToPool",
            totalRes.returnData,
          );
          const [pendingDec] = underwriterManager.interface.decodeFunctionResult(
            "capitalPendingWithdrawal",
            pendingRes.returnData,
          );
          // --- FIX: Use the correct function name 'getPoolRiskRating' to decode ---
          const [riskDec] = poolRegistry.interface.decodeFunctionResult(
            "getPoolRiskRating",
            riskRes.returnData,
          );

          const rawInfo = {
            protocolTokenToCover: dataDec.protocolTokenToCover ?? dataDec[0],
            totalCoverageSold: dataDec.totalCoverageSold ?? dataDec[1],
            isPaused: dataDec.isPaused ?? dataDec[2],
            feeRecipient: dataDec.feeRecipient ?? dataDec[3],
            claimFeeBps: dataDec.claimFeeBps ?? dataDec[4],
            totalCapitalPledgedToPool: totalDec,
            capitalPendingWithdrawal: pendingDec,
            rateModel: rateDec[0],
            riskRating: riskDec,
          };
          const info = bnToString(rawInfo);
          const rate = calcPremiumRateBps(info);
          const uwYield = calcUnderwriterYieldBps(info, catPremiumBps);
          pools.push({
            id: i,
            ...info,
            premiumRateBps: rate.toString(),
            underwriterYieldBps: uwYield.toString(),
            tokenPriceUsd: 0,
          });
        } catch {}
      }

      const priceCalls = pools.map((p) => ({
        target: dep.priceOracle,
        callData: priceOracle.interface.encodeFunctionData(
          "getLatestUsdPrice",
          [p.protocolTokenToCover]
        ),
      }));

      const priceResults = await multicall.tryAggregate(false, priceCalls);

      // Fetch ERC20 decimals for each protocol token
      const decInterface = new ethers.utils.Interface([
        "function decimals() view returns (uint8)",
      ]);
      const decCalls = pools.map((p) => ({
        target: p.protocolTokenToCover,
        callData: decInterface.encodeFunctionData("decimals"),
      }));
      const decResults = await multicall.tryAggregate(false, decCalls);

      for (let i = 0; i < priceResults.length; i++) {
        if (!priceResults[i].success) continue;
        try {
          const [price, dec] = priceOracle.interface.decodeFunctionResult(
            "getLatestUsdPrice",
            priceResults[i].returnData
          );
          pools[i].tokenPriceUsd = parseFloat(
            ethers.utils.formatUnits(price, dec)
          );
        } catch {}
        // Set token decimals from ERC20 call
        let protoDec = 18;
        const decRes = decResults[i];
        if (decRes && decRes.success) {
          try {
            const [val] = decInterface.decodeFunctionResult(
              "decimals",
              decRes.returnData
            );
            protoDec = Number(val);
          } catch {}
        }
        pools[i].protocolTokenDecimals = protoDec;
      }

      await Promise.all(
        pools.map((p) =>
          limit(async () => {
            const prev = prevRisk.get(p.id);
            if (
              prev &&
              prev.totalCoverageSold === p.totalCoverageSold &&
              prev.totalCapitalPledgedToPool === p.totalCapitalPledgedToPool &&
              prev.capitalPendingWithdrawal === p.capitalPendingWithdrawal
            ) {
              depPools.push({
                deployment: dep.name,
                underlyingAssetDecimals: underlyingDec,
                underlyingAsset,
                riskAdjustedCapacity: prev.capacity,
                ...p,
              });
              newRisk.set(p.id, prev);
              return;
            }
            const riskAdjustedCapacity = await calcRiskAdjustedCapacity(
              dep,
              p.id,
              p.totalCoverageSold,
            );
            depPools.push({
              deployment: dep.name,
              underlyingAssetDecimals: underlyingDec,
              underlyingAsset,
              riskAdjustedCapacity,
              ...p,
            });
            newRisk.set(p.id, {
              totalCoverageSold: p.totalCoverageSold,
              totalCapitalPledgedToPool: p.totalCapitalPledgedToPool,
              capitalPendingWithdrawal: p.capitalPendingWithdrawal,
              capacity: riskAdjustedCapacity,
            });
          })
        )
      );
      riskCache.set(dep.name, newRisk);
      poolsCache.set(dep.name, { block, pools: depPools });
      allPools.push(...depPools);
    } catch (err: any) {
      console.error("Failed to load pools for deployment", dep.name, err);
    }
  }

  return NextResponse.json({ pools: allPools });
}