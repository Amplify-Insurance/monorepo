import { NextResponse } from 'next/server';
import { getProvider } from '../../../../lib/provider';
import CatPoolAbi from '../../../../abi/CatInsurancePool.json';
import deployments from '../../../config/deployments';
import { ethers } from 'ethers';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = new ethers.Contract(dep.catPool, CatPoolAbi, getProvider(dep.name));
    const amount = await cp.liquidUsdc();
    return NextResponse.json({ liquidUsdc: amount.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
