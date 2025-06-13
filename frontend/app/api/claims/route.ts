import { NextResponse } from "next/server";

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_SUBGRAPH_URL;

export async function GET() {
  try {
    if (!SUBGRAPH_URL) {
      throw new Error("SUBGRAPH_URL not configured");
    }

    const pageSize = 1000;
    let skip = 0;
    const items: any[] = [];

    while (true) {
      const query = `{
        claims(first: ${pageSize}, skip: ${skip}, orderBy: timestamp, orderDirection: desc) {
          policyId
          poolId
          claimant
          coverage
          netPayoutToClaimant
          claimFee
          protocolTokenAmountReceived
          timestamp
          transactionHash
        }
      }`;

      const response = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const json = await response.json();
      const batch = json?.data?.claims || [];
      items.push(...batch);

      if (batch.length < pageSize) break;
      skip += pageSize;
    }

    const claims = items.map((c) => ({
      transactionHash: c.transactionHash,
      timestamp: Number(c.timestamp),
      policyId: Number(c.policyId),
      poolId: Number(c.poolId),
      claimant: c.claimant,
      coverage: c.coverage,
      netPayoutToClaimant: c.netPayoutToClaimant,
      claimFee: c.claimFee,
      protocolTokenAmountReceived: c.protocolTokenAmountReceived,
    }));

    return NextResponse.json({ claims });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
