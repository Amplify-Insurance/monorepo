import { NextResponse } from "next/server";
import { provider } from "../../../lib/provider";
import { getRiskManager } from "../../../lib/riskManager";
import { getClaimsCollateralManager } from "../../../lib/claimsCollateralManager";

export async function GET() {
  try {
    const riskManager = getRiskManager();
    const collateralManager = getClaimsCollateralManager();

    const claimTopic = riskManager.interface.getEvent("ClaimProcessed").topicHash;
    const fromBlock = BigInt(
      process.env.CLAIM_START_BLOCK ?? process.env.NEXT_PUBLIC_CLAIM_START_BLOCK ??
        "0"
    );

    const logs = await provider.getLogs({
      address: riskManager.address,
      topics: [claimTopic],
      fromBlock,
      toBlock: "latest",
    });

    const claims = [] as any[];
    for (const log of logs) {
      const parsed = riskManager.interface.parseLog(log);
      const policyId = parsed.args.policyId as bigint;
      const amountClaimed = parsed.args.amountClaimed as bigint;

      const block = await provider.getBlock(log.blockHash!);
      const receipt = await provider.getTransactionReceipt(log.transactionHash);

      let protocolTokenAmountReceived = 0n;
      for (const l of receipt.logs) {
        if (
          l.address.toLowerCase() === collateralManager.address.toLowerCase() &&
          l.topics[0] ===
            collateralManager.interface.getEvent("CollateralDeposited").topicHash
        ) {
          const dep = collateralManager.interface.parseLog(l);
          if (dep.args.claimId === policyId) {
            protocolTokenAmountReceived = dep.args.amount as bigint;
          }
        }
      }

      claims.push({
        transactionHash: log.transactionHash,
        timestamp: Number(block.timestamp),
        policyId: Number(policyId),
        poolId: 0,
        claimant: "0x",
        coverage: amountClaimed.toString(),
        netPayoutToClaimant: amountClaimed.toString(),
        claimFee: "0",
        protocolTokenAmountReceived: protocolTokenAmountReceived.toString(),
      });
    }

    return NextResponse.json({ claims });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
