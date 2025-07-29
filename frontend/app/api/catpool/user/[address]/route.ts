import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { getProvider } from '../../../../../lib/provider'
import { getCatPool } from '../../../../../lib/catPool'
import { getMulticallReader } from '../../../../../lib/multicallReader'
import ERC20 from '../../../../../abi/ERC20.json'
import deployments from '../../../../config/deployments'

export async function GET(
  req: Request,
  { params }: { params: { address?: string } }
) {
  try {
    // 1) Validate the “address” param
    const rawAddr = params.address
    if (!rawAddr) {
      return NextResponse.json(
        { error: 'URL param “address” is required' },
        { status: 400 }
      )
    }
    const addr = ethers.utils.getAddress(rawAddr)

    // 2) Pick your deployment
    const url = new URL(req.url)
    const depName = url.searchParams.get('deployment') || deployments[0].name
    const dep = deployments.find((d) => d.name === depName)
    if (!dep) {
      return NextResponse.json(
        { error: `Unknown deployment: ${depName}` },
        { status: 400 }
      )
    }

    // 3) Guard against missing pool addresses
    if (
      !dep.backstopPool ||
      !ethers.utils.isAddress(dep.backstopPool)
    ) {
      return NextResponse.json(
        {
          error: `Invalid backstopPool address for deployment “${dep.name}”`
        },
        { status: 500 }
      )
    }

    const cp = getCatPool(dep.backstopPool, dep.name)
    const catShareAddr = await cp.catShareToken()

    if (!catShareAddr || !ethers.utils.isAddress(catShareAddr)) {
      return NextResponse.json(
        {
          error: `catShareToken() returned invalid address for deployment “${dep.name}”`
        },
        { status: 500 }
      )
    }

    // 4) Instantiate your ERC20
    const token = new ethers.Contract(
      catShareAddr,
      ERC20.abi,
      getProvider(dep.name)
    )

    // 5) Do your multicall
    const multicall = getMulticallReader(dep.multicallReader, dep.name)
    const calls = [
      {
        target: catShareAddr,
        callData: token.interface.encodeFunctionData('balanceOf', [addr])
      },
      {
        target: catShareAddr,
        callData: token.interface.encodeFunctionData('totalSupply')
      },
      {
        target: dep.backstopPool,
        callData: cp.interface.encodeFunctionData('liquidUsdc')
      }
    ]
    const res = await multicall.tryAggregate(false, calls)

    // 6) Decode, compute, and return
    const balance = res[0].success
      ? token.interface.decodeFunctionResult('balanceOf', res[0].returnData)[0]
      : 0n
    const totalSupply = res[1].success
      ? token.interface.decodeFunctionResult('totalSupply', res[1].returnData)[0]
      : 0n
    const liquid = res[2].success
      ? cp.interface.decodeFunctionResult('liquidUsdc', res[2].returnData)[0]
      : 0n

    const value = totalSupply > 0n ? (balance * liquid) / totalSupply : 0n

    return NextResponse.json({
      address: addr,
      balance: balance.toString(),
      value: value.toString()
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
