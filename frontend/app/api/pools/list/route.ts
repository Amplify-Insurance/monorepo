// app/api/pools/route.ts
import { NextResponse } from 'next/server';
import { riskManager } from '../../../../lib/riskManager';

/**
 * Basis-points denominator (10 000) expressed as bigint for fixed-point math.
 */
const BPS = 10_000n;

/**
 * Recursively walk a value converting:
 *   • native `bigint` → `string`
 *   • ethers `BigNumber` → `string`
 * While doing so we **strip the numeric index keys** automatically added by the
 * ABI-coder so the final JSON only contains the *named* Solidity struct fields.
 *
 * For inner structs that come back as an *array* **and** also carry named keys
 * (eg. `rateModel`), we keep the named-key object instead of an index array so
 * that callers can reference `rateModel.base` rather than guessing positions.
 */
function bnToString(value: any): any {
  // 1️⃣ Native bigint -----------------------------
  if (typeof value === 'bigint') return value.toString();

  // 2️⃣ ethers.js BigNumber ----------------------
  if (value && typeof value === 'object' && value._isBigNumber) {
    return value.toString();
  }

  // 3️⃣ Array (may also have named props) --------
  if (Array.isArray(value)) {
    // Does the array carry extra *named* keys?
    const hasNamedKeys = Object.keys(value).some((k) => isNaN(Number(k)));

    if (hasNamedKeys) {
      // Convert to a plain object of the named keys only.
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => isNaN(Number(k)))
          .map(([k, v]) => [k, bnToString(v)]),
      );
    }

    // Pure, positional array → recurse element-wise.
    return value.map(bnToString);
  }

  // 4️⃣ Plain object ------------------------------
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        // filter out numeric keys such as "0", "1", …
        .filter(([k]) => isNaN(Number(k)))
        .map(([k, v]) => [k, bnToString(v)]),
    );
  }

  return value;
}

/**
 * Pool-utilisation helper used by the premium-rate function.
 */
function calcUtilization(pool: any): bigint {
  const totalCapital = BigInt(pool.totalCapitalPledgedToPool);
  const sold = BigInt(pool.totalCoverageSold);
  if (totalCapital === 0n) return sold > 0n ? BPS * 100n : 0n;
  return (sold * BPS * 100n) / totalCapital;
}

/**
 * Piece-wise linear rate model taken from the contract.
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
 * premium-rates and underwriter yields.  Verbose console logging has been
 * added so we can trace exactly where – if anywhere – execution stalls or
 * errors.
 */
export async function GET() {
  console.log('➡️  GET /api/pools – start');

  try {
    /** ****************************
     * 1️⃣  How many pools exist?
     * *****************************/
    console.time('⏱  fetchPoolCount');

    let count = 0n;
    try {
      count = await (riskManager as any).protocolRiskPoolsLength();
      console.log(`✔️  Pool count via protocolRiskPoolsLength(): ${count}`);
    } catch (err) {
      console.warn('⚠️  protocolRiskPoolsLength() failed – falling back to manual count', err);
      // fallback: iterate until call-revert
      while (true) {
        try {
          await riskManager.getPoolInfo(count);
          count++;
        } catch {
          break;
        }
      }
      console.log(`✔️  Pool count via manual probing: ${count}`);
    }

    console.timeEnd('⏱  fetchPoolCount');

    /** ***************************************************
     * 2️⃣  What is the catastrophe premium basis-points?
     * ***************************************************/
    console.time('⏱  fetchCatPremium');

    let catPremiumBps: bigint = 2000n; // default fallback
    try {
      if (typeof (riskManager as any).catPremiumBps === 'function') {
        const raw = await (riskManager as any).catPremiumBps();
        // Ensure we are holding a *BigInt* (not ethers BigNumber) to avoid mixing types later.
        catPremiumBps = BigInt(raw.toString());
      }
      console.log(`✔️  catPremiumBps: ${catPremiumBps}`);
    } catch (err) {
      console.warn('⚠️  catPremiumBps() call failed – using default 2000', err);
    }

    console.timeEnd('⏱  fetchCatPremium');

    /** ********************************************
     * 3️⃣  Fetch each pool and compute derivatives
     * *********************************************/
    const pools: any[] = [];

    console.time('⏱  fetchPools');
    for (let i = 0; i < Number(count); i++) {
      console.log(`➡️  Fetching pool ${i}`);
      try {
        const rawInfo = await riskManager.getPoolInfo(i);
        console.debug(`ℹ️  Raw info for pool ${i}:`, rawInfo);

        const info = bnToString(rawInfo); // stringify + drop numeric keys
        const rate = calcPremiumRateBps(info);
        const uwYield = (rate * (BPS - catPremiumBps)) / BPS;
        console.debug(`📈  Calculated rate=${rate}, uwYield=${uwYield} for pool ${i}`);

        pools.push({
          id: i,
          ...info,
          premiumRateBps: rate.toString(),
          underwriterYieldBps: uwYield.toString(),
        });
      } catch (inner) {
        console.warn(`⚠️  Pool ${i} skipped:`, (inner as any)?.reason ?? inner);
      }
    }
    console.timeEnd('⏱  fetchPools');

    console.log(`✔️  Completed – returning ${pools.length} pools`);
    console.log('⬅️  GET /api/pools – end');

    return NextResponse.json({ pools });
  } catch (err: any) {
    // 🔴  Top-level failure – capture full stack for CloudWatch/Logflare/Sentry
    console.error('🔥  GET /api/pools failed', err);
    return NextResponse.json({ error: err?.message ?? 'Internal Server Error' }, { status: 500 });
  }
}