// app/api/pools/route.ts
import { NextResponse } from 'next/server';
import { riskManager } from '../../../../lib/riskManager';

const BPS = 10_000n;

function bnToString(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(bnToString);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bnToString(v)]),
    );
  }
  return value;
}

function calcUtilization(pool: any): bigint {
  const totalCapital = BigInt(pool.totalCapitalPledgedToPool);
  const sold = BigInt(pool.totalCoverageSold);
  if (totalCapital === 0n) return sold > 0n ? BPS * 100n : 0n;
  return (sold * BPS * 100n) / totalCapital;
}

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

export async function GET() {
  try {
    let count = 0n;
    try {
      count = await (riskManager as any).protocolRiskPoolsLength();
    } catch {
      // fallback by iterating until failure
      while (true) {
        try {
          await riskManager.getPoolInfo(count);
          count++;
        } catch {
          break;
        }
      }
    }
    // catPremiumBps may not be present in the minimal ABI
    let catPremiumBps: bigint = 2000n;
    try {
      if (typeof (riskManager as any).catPremiumBps === 'function') {
        catPremiumBps = await (riskManager as any).catPremiumBps();
      }
    } catch { }

    const pools: any[] = [];
    for (let i = 0; i < Number(count); i++) {
      console.log(i,  'fetching pool info')
      try {
        const info = await riskManager.getPoolInfo(i);
        const rate = calcPremiumRateBps(info);
        const uwYield = (rate * (BPS - catPremiumBps)) / BPS;
        pools.push({
          id: i,
          ...bnToString(info),
          premiumRateBps: rate.toString(),
          underwriterYieldBps: uwYield.toString(),
        });
      } catch (inner) {
        console.warn(`pool ${i} skipped:`, inner?.reason ?? inner);
      }
    }
    return NextResponse.json({ pools });
  } catch (err: any) {
    // 🔍 Log the full error for debugging
    console.error('GET /api/pools failed', err);

    return NextResponse.json({ error: err?.message ?? 'Internal Server Error' }, { status: 500 });
  }
}
