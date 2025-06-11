import { NextResponse } from "next/server";
import { riskManager } from "../../../lib/riskManager";
import { policyNft } from "../../../lib/policyNft";

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_SUBGRAPH_URL;

export async function GET() {
  try {
    if (!SUBGRAPH_URL) {
      throw new Error("SUBGRAPH_URL not configured");
    }

    const pageSize = 1000;
    let skip = 0;
    const events: any[] = [];

    while (true) {
      const query = `{
        genericEvents(first: ${pageSize}, skip: ${skip}, orderBy: timestamp, orderDirection: desc, where: { eventName: "ClaimProcessed" }) {
          blockNumber
          timestamp
          transactionHash
          data
        }
      }`;

      const response = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const json = await response.json();
      const batch = json?.data?.genericEvents || [];
      events.push(...batch);

      if (batch.length < pageSize) break;
      skip += pageSize;
    }

    const claims = await Promise.all(
      events.map(async (ev: any) => {
        const [policyIdStr, poolIdStr, claimant, netPayoutStr] = (
          ev.data as string
        ).split(",");
        const policyId = Number(policyIdStr);
        const poolId = Number(poolIdStr);

        let coverage = 0n;
        try {
          const pol = await policyNft.getPolicy(BigInt(policyId));
          coverage = BigInt(pol.coverage.toString());
        } catch (err) {
          console.error(`Failed to fetch policy ${policyId}`, err);
        }

        let scale = 0n;
        try {
          const info = await riskManager.getPoolInfo(poolId);
          scale = BigInt(info.scaleToProtocolToken.toString());
        } catch (err) {
          console.error(`Failed to fetch pool ${poolId}`, err);
        }

        const protocolTokenAmountReceived = (coverage * scale).toString();
        const netPayout = BigInt(netPayoutStr);
        const claimFee =
          coverage > netPayout ? (coverage - netPayout).toString() : "0";

        return {
          transactionHash: ev.transactionHash,
          blockNumber: Number(ev.blockNumber),
          timestamp: Number(ev.timestamp),
          policyId,
          poolId,
          claimant,
          coverage: coverage.toString(),
          netPayoutToClaimant: netPayoutStr,
          claimFee,
          protocolTokenAmountReceived,
        };
      })
    );

    return NextResponse.json({ claims });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
