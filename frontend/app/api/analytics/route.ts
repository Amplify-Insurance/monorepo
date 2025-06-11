import { NextResponse } from 'next/server';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_SUBGRAPH_URL;

async function fetchEvents(eventName: string) {
  if (!SUBGRAPH_URL) throw new Error('SUBGRAPH_URL not configured');
  const pageSize = 1000;
  let skip = 0;
  const items: any[] = [];
  while (true) {
    const query = `{
      genericEvents(first: ${pageSize}, skip: ${skip}, orderBy: timestamp, orderDirection: asc, where: { eventName: "${eventName}" }) {
        timestamp
        data
      }
    }`;
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const batch = json?.data?.genericEvents || [];
    items.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return items;
}

export async function GET() {
  try {
    if (!SUBGRAPH_URL) throw new Error('SUBGRAPH_URL not configured');

    const [createdEv, lapsedEv, claimEv, premiumEv, depositEv] = await Promise.all([
      fetchEvents('PolicyCreated'),
      fetchEvents('PolicyLapsed'),
      fetchEvents('ClaimProcessed'),
      fetchEvents('PremiumPaid'),
      fetchEvents('Deposit'),
    ]);

    type E = { timestamp: number; type: string; policyId: number; coverage?: bigint };
    const events: E[] = [];
    const coverageMap = new Map<number, bigint>();
    const lapsedHistory: { timestamp: number; amount: string }[] = [];
    const policyHolderSet = new Set<string>();
    const underwriterSet = new Set<string>();
    let totalClaimFees = 0n;
    for (const ev of createdEv) {
      const [user, policyIdStr, poolIdStr, coverageStr] = ev.data.split(',');
      const cov = BigInt(coverageStr);
      const pid = Number(policyIdStr);
      coverageMap.set(pid, cov);
      policyHolderSet.add(user.toLowerCase());
      events.push({ timestamp: Number(ev.timestamp), type: 'created', policyId: pid, coverage: cov });
    }
    for (const ev of lapsedEv) {
      const [policyIdStr] = ev.data.split(',');
      events.push({ timestamp: Number(ev.timestamp), type: 'lapsed', policyId: Number(policyIdStr) });
    }
    for (const ev of claimEv) {
      const [policyIdStr, , , netPayoutStr] = ev.data.split(',');
      events.push({ timestamp: Number(ev.timestamp), type: 'claim', policyId: Number(policyIdStr), coverage: undefined, payout: BigInt(netPayoutStr) });
    }
    let totalPremiums = 0n;
    for (const ev of premiumEv) {
      const [, , amountPaidStr] = ev.data.split(',');
      totalPremiums += BigInt(amountPaidStr);
    }

    for (const ev of depositEv) {
      const [user] = ev.data.split(',');
      underwriterSet.add(user.toLowerCase());
    }

    events.sort((a, b) => a.timestamp - b.timestamp);
    const activeHistory: { timestamp: number; active: string }[] = [];
    let active = 0n;
    const knownCoverage = new Map(coverageMap);
    for (const ev of events) {
      if (ev.type === 'created' && ev.coverage !== undefined) {
        active += ev.coverage;
        knownCoverage.set(ev.policyId, ev.coverage);
      } else if (ev.type === 'lapsed') {
        const cov = knownCoverage.get(ev.policyId);
        if (cov) {
          active -= cov;
          knownCoverage.delete(ev.policyId);
          lapsedHistory.push({ timestamp: ev.timestamp, amount: cov.toString() });
        }
      } else if (ev.type === 'claim') {
        const cov = knownCoverage.get(ev.policyId);
        if (cov) {
          active -= cov;
          knownCoverage.delete(ev.policyId);
          lapsedHistory.push({ timestamp: ev.timestamp, amount: cov.toString() });
          const fee = cov > (ev as any).payout ? cov - (ev as any).payout : 0n;
          totalClaimFees += fee;
        }
      }
      activeHistory.push({ timestamp: ev.timestamp, active: active.toString() });
    }

    return NextResponse.json({
      totalActiveCover: active.toString(),
      activeCoverHistory: activeHistory,
      totalPremiumsPaid: totalPremiums.toString(),
      totalClaimFees: totalClaimFees.toString(),
      lapsedCoverHistory: lapsedHistory,
      underwriterCount: underwriterSet.size,
      policyHolderCount: policyHolderSet.size,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
