import { NextResponse } from 'next/server';
import { getProvider } from '../../../../../lib/provider'
import { getCatPool } from '../../../../../lib/catPool'
import { getMulticallReader } from '../../../../../lib/multicallReader'
import ERC20 from '../../../../../abi/ERC20.json';
import { ethers } from 'ethers';
import deployments from '../../../../config/deployments';

export async function GET(req: Request, { params }: { params: { address: string } }) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];
    const cp = getCatPool(dep.catInsurancePool, dep.name)

    const addr = params.address.toLowerCase()
    const catShareAddr = await cp.catShareToken()
    const token = new ethers.Contract(
      catShareAddr,
      // Ethers v6 does not automatically extract the ABI from Hardhat artifacts
      // so we need to pass the `abi` array explicitly.
      ERC20.abi,
      getProvider(dep.name),
    )
    const multicall = getMulticallReader(dep.multicallReader, dep.name)

    const calls = [
      { target: catShareAddr, callData: token.interface.encodeFunctionData('balanceOf', [addr]) },
      { target: catShareAddr, callData: token.interface.encodeFunctionData('totalSupply') },
      { target: dep.catInsurancePool, callData: cp.interface.encodeFunctionData('liquidUsdc') },
    ]

    const res = await multicall.tryAggregate(false, calls)

    const balance = res[0].success
      ? token.interface.decodeFunctionResult('balanceOf', res[0].returnData)[0]
      : 0n
    const totalSupply = res[1].success
      ? token.interface.decodeFunctionResult('totalSupply', res[1].returnData)[0]
      : 0n
    const liquid = res[2].success
      ? cp.interface.decodeFunctionResult('liquidUsdc', res[2].returnData)[0]
      : 0n
    let value = 0n;
    if (totalSupply > 0n) {
      value = (balance * liquid) / totalSupply;
    }
    return NextResponse.json({ address: addr, balance: balance.toString(), value: value.toString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
