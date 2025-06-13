import { NextResponse } from 'next/server';
import { getCatPool } from '../../../../../lib/catPool';
import { getProvider } from '../../../../../lib/provider';
import ERC20 from '../../../../../abi/ERC20.json';
import { ethers } from 'ethers';

export async function GET(_req: Request, { params }: { params: { address: string } }) {
  try {
    const addr = params.address.toLowerCase();
    const provider = getProvider();
    const cp = getCatPool(undefined, provider);
    const catShareAddr = await cp.catShareToken();
    const token = new ethers.Contract(catShareAddr, ERC20, provider);
    const [balance, totalSupply, liquid] = await Promise.all([
      token.balanceOf(addr),
      token.totalSupply(),
      cp.liquidUsdc(),
    ]);
    let value = 0n;
    if (totalSupply > 0n) {
      value = (balance * liquid) / totalSupply;
    }
    return NextResponse.json({ address: addr, balance: balance.toString(), value: value.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
