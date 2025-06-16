import { NextResponse } from 'next/server'
import { getProvider } from '../../../../../../lib/provider'
import { getCatPool } from '../../../../../../lib/catPool'
import deployments from '../../../../../config/deployments'
import { ethers } from 'ethers'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string; token: string }> },
) {
  try {
    const { address, token } = await params
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCatPool(dep.catPool, dep.name);
    const amount = await cp.calculateClaimableProtocolAssetRewards(address, token);
    return NextResponse.json({ address, token, claimable: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
