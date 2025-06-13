import { NextResponse } from 'next/server';
import { getCatPool } from '../../../../lib/catPool';
import { getProvider } from '../../../../lib/provider';
import { ethers } from 'ethers';

const APR_ABI = ['function currentApr() view returns (uint256)'];

export async function GET() {
  try {
    const provider = getProvider();
    const cp = getCatPool(undefined, provider);
    const adapterAddr = await cp.adapter();
    let apr = '0';
    if (adapterAddr !== ethers.constants.AddressZero) {
      const contract = new ethers.Contract(adapterAddr, APR_ABI, provider);
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
