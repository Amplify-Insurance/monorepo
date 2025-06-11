import { NextResponse } from 'next/server';
import { catPool, provider } from '../../../../lib/catPool';
import { ethers } from 'ethers';

const APR_ABI = ['function currentApr() view returns (uint256)'];

export async function GET() {
  try {
    const adapterAddr = await catPool.adapter();
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
