import { NextResponse } from 'next/server';
import { getCapitalPool } from '../../../lib/capitalPool'
import { getMulticallReader } from '../../../lib/multicallReader'
import { ethers } from 'ethers'
import deployments from '../../config/deployments';
import { YieldPlatform } from '../../config/yieldPlatforms';

const ADAPTER_ABI = [
  'function currentApr() view returns (uint256)',
  'function asset() view returns (address)',
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];

    const cp = getCapitalPool(dep.capitalPool, dep.name)
    const multicall = getMulticallReader(dep.multicallReader, dep.name)
    const iface = new ethers.utils.Interface(ADAPTER_ABI)

    const adapters: { id: number; address: string; apr: string; asset: string }[] = []

    const ids = [YieldPlatform.AAVE, YieldPlatform.COMPOUND, YieldPlatform.OTHER_YIELD]
    const addrCalls = ids.map((id) => ({
      target: dep.capitalPool,
      callData: cp.interface.encodeFunctionData('baseYieldAdapters', [id]),
    }))

    const addrResults = await multicall.tryAggregate(false, addrCalls)

    const adapterCalls: { target: string; callData: string }[] = []
    const addrMap: { id: number; address: string }[] = []
    for (let i = 0; i < addrResults.length; i++) {
      const res = addrResults[i]
      if (!res.success) continue
      try {
        const [addr] = cp.interface.decodeFunctionResult('baseYieldAdapters', res.returnData)
        if (addr && addr !== ethers.constants.AddressZero) {
          addrMap.push({ id: ids[i], address: addr })
          adapterCalls.push({ target: addr, callData: iface.encodeFunctionData('currentApr') })
          adapterCalls.push({ target: addr, callData: iface.encodeFunctionData('asset') })
        }
      } catch {}
    }

    const adapterResults = await multicall.tryAggregate(false, adapterCalls)

    for (let i = 0; i < addrMap.length; i++) {
      let apr = '0'
      let asset = ethers.constants.AddressZero
      const aprRes = adapterResults[2 * i]
      const assetRes = adapterResults[2 * i + 1]
      if (aprRes && aprRes.success) {
        try {
          const [val] = iface.decodeFunctionResult('currentApr', aprRes.returnData)
          apr = val.toString()
        } catch {}
      }
      if (assetRes && assetRes.success) {
        try {
          const [val] = iface.decodeFunctionResult('asset', assetRes.returnData)
          asset = val
        } catch {}
      }
      adapters.push({ id: addrMap[i].id, address: addrMap[i].address, apr, asset })
    }

    return NextResponse.json({ adapters });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
