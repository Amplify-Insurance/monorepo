import { NextResponse } from 'next/server'
import { policyNft } from '../../../../../lib/policyNft'
import { ethers } from 'ethers'

export async function GET(_req: Request, { params }: { params: { address: string }}) {
  try {
    const addr = params.address.toLowerCase()
    const nextId: bigint = await policyNft.nextId()
    const policies: any[] = []
    for (let i = 1n; i < nextId; i++) {
      try {
        const owner: string = await policyNft.ownerOf(i)
        if (owner.toLowerCase() === addr) {
          const p = await policyNft.getPolicy(i)
          policies.push({ id: Number(i), ...p })
        }
      } catch (err) {
        // ignore non-existent tokens
      }
    }
    return NextResponse.json({ address: addr, policies })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
