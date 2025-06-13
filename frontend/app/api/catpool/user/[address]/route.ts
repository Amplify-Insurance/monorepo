import { NextResponse } from 'next/server';
import { getProvider } from '../../../../../lib/provider';
import CatPoolAbi from '../../../../../abi/CatInsurancePool.json';
import ERC20 from '../../../../../abi/ERC20.json';
import { ethers } from 'ethers';
import deployments from '../../../../config/deployments';

export async function GET(req: Request, { params }: { params: { address: string } }) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const provider = getProvider(dep);
    const cp = new ethers.Contract(dep.catPool, CatPoolAbi, provider);

    const addr = params.address.toLowerCase();
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
