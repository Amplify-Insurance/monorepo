// app/api/pools/route.ts
import { NextResponse } from "next/server";
import { getPoolRegistry } from "../../../../lib/poolRegistry";
import { getPoolManager } from "../../../../lib/poolManager";
import { getPriceOracle } from "../../../../lib/priceOracle";
import { getMulticallReader } from "../../../../lib/multicallReader";
import { getUnderlyingAssetDecimals } from "../../../../lib/capitalPool";
import { ethers } from "ethers";
import deployments from "../../../config/deployments";

/**
 * Basis‑points denominator (10 000) expressed as bigint for fixed‑point math.
 */
const BPS = 10_000n;

/**
 * Recursively walk a value converting:
 *   • native `bigint` → `string`
 *   • ethers `BigNumber` → `string`
 * While doing so we strip the numeric index keys automatically added by the
 * ABI‑coder so the final JSON only contains the *named* Solidity struct fields.
 *
 * For inner structs that come back as an *array* **and** also carry named keys
 * (e.g. `rateModel`), we keep the named‑key object instead of an index array so
 * callers can reference `rateModel.base` rather than guessing positions.
 */
function bnToString(value: any): any {
  // 1️⃣ Native bigint ────────────────────────────
  if (typeof value === "bigint") return value.toString();

  // 2️⃣ ethers.js BigNumber ─────────────────────
  if (value && typeof value === "object" && value._isBigNumber) {
    return value.toString();
  }

  // 3️⃣ Array (may also have named props) ───────
  if (Array.isArray(value)) {
    const hasNamedKeys = Object.keys(value).some((k) => isNaN(Number(k)));

    if (hasNamedKeys) {
      // Convert to a plain object of the named keys only.
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => isNaN(Number(k)))
          .map(([k, v]) => [k, bnToString(v)])
      );
    }

    // Pure, positional array → recurse element‑wise.
    return value.map(bnToString);
  }

  // 4️⃣ Plain object ─────────────────────────────
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => isNaN(Number(k))) // drop numeric keys
        .map(([k, v]) => [k, bnToString(v)])
    );
  }

  return value;
}

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

/**
 * GET /api/pools – returns protocol pool metadata enriched with calculated
 * premium rates and underwriter yields.
 */
export async function GET() {
  const allPools: any[] = [];
  for (const dep of deployments) {
    const poolRegistry = getPoolRegistry(dep.poolRegistry, dep.name);
    const poolManager = getPoolManager(dep.poolManager, dep.name);
    const priceOracle = getPriceOracle(dep.priceOracle, dep.name);
    try {
      /* 1️⃣ How many pools exist? */
      let count = 0n;
      try {
        count = await poolRegistry.getPoolCount();
      } catch {
        // Fallback: iterate until call‑revert when the length function is absent.
        while (true) {
          try {
            await poolRegistry.getPoolData(count);
            count++;
          } catch {
            break;
          }
        }
      }

      /* 2️⃣ Fetch catastrophe premium bps */
      let catPremiumBps: bigint = 2000n; // default
      try {
        const raw = await poolManager.catPremiumBps();
        catPremiumBps = BigInt(raw.toString());
      } catch {
        // ignore – fallback already set
      }

      /* 3️⃣ Pull each pool and compute derivatives via multicall */
      const multicall = getMulticallReader(dep.multicallReader, dep.name);
      const pools: any[] = [];
      let underlyingDec = 6;
      try {
        underlyingDec = Number(
          await getUnderlyingAssetDecimals(dep.capitalPool, dep.name)
        );
      } catch {
        // ignore
      }

      const poolCalls = [] as { target: string; callData: string }[];
      for (let i = 0; i < Number(count); i++) {
        poolCalls.push({
          target: dep.poolRegistry,
          callData: poolRegistry.interface.encodeFunctionData("getPoolData", [
            i,
          ]),
        });
        poolCalls.push({
          target: dep.poolRegistry,
          callData: poolRegistry.interface.encodeFunctionData(
            "getPoolRateModel",
            [i]
          ),
        });
      }

      const poolResults = await multicall.tryAggregate(true, poolCalls);

      for (let i = 0; i < Number(count); i++) {
        const dataRes = poolResults[2 * i];
        const rateRes = poolResults[2 * i + 1];
        if (!dataRes.success || !rateRes.success) continue;
        try {
          const dataDec = poolRegistry.interface.decodeFunctionResult(
            "getPoolData",
            dataRes.returnData
          );
          const rateDec = poolRegistry.interface.decodeFunctionResult(
            "getPoolRateModel",
            rateRes.returnData
          );
          const rawInfo = {
            protocolTokenToCover: dataDec.protocolTokenToCover ?? dataDec[0],
            totalCapitalPledgedToPool:
              dataDec.totalCapitalPledgedToPool ?? dataDec[1],
            totalCoverageSold: dataDec.totalCoverageSold ?? dataDec[2],
            capitalPendingWithdrawal:
              dataDec.capitalPendingWithdrawal ?? dataDec[3],
            isPaused: dataDec.isPaused ?? dataDec[4],
            feeRecipient: dataDec.feeRecipient ?? dataDec[5],
            rateModel: rateDec[0],
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

      for (const p of pools) {
        allPools.push({
          deployment: dep.name,
          underlyingAssetDecimals: underlyingDec,
          ...p,
        });
      }
    } catch (err: any) {
      console.error("Failed to load pools for deployment", dep.name, err);
    }
  }

  return NextResponse.json({ pools: allPools });
}
