import { NextResponse } from 'next/server'

const SUBGRAPH_URL = process.env.SUBGRAPH_URL ?? process.env.NEXT_PUBLIC_SUBGRAPH_URL

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!SUBGRAPH_URL) throw new Error('SUBGRAPH_URL not configured')
    const poolId = params.id
    const pageSize = 1000
    let skip = 0
    const snapshots: any[] = []
    while (true) {
      const query = `{
        poolUtilizationSnapshots(first: ${pageSize}, skip: ${skip}, where: { pool: "${poolId}" }, orderBy: timestamp, orderDirection: asc) {
          timestamp
          utilizationBps
          premiumRateBps
        }
      }`
      const res = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })
      const json = await res.json()
      const batch = json?.data?.poolUtilizationSnapshots || []
      snapshots.push(...batch)
      if (batch.length < pageSize) break
      skip += pageSize
    }
    return NextResponse.json({ snapshots })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
