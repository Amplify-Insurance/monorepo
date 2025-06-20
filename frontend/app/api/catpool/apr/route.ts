import { NextResponse } from 'next/server';
import { getProvider } from '../../../../lib/provider';
import { ethers } from 'ethers';
import { getCatPool } from '../../../../lib/catPool';
import deployments from '../../../config/deployments';

const APR_ABI = ['function currentApr() view returns (uint256)'];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];

    const cp = getCatPool(dep.catInsurancePool, dep.name);
    const adapterAddr = await cp.adapter();
    let apr = '0';
    if (adapterAddr !== ethers.constants.AddressZero) {
      const contract = new ethers.Contract(adapterAddr, APR_ABI, getProvider(dep.name));
      try {
        const res = await contract.currentApr();
        apr = res.toString();
      } catch {}
    }
    return NextResponse.json({ address: adapterAddr, apr });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
