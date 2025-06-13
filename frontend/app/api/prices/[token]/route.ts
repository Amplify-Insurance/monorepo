import { NextResponse } from 'next/server'
import { priceOracle } from '../../../../lib/priceOracle'

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const [rawPrice, decimals] = await priceOracle.getLatestUsdPrice(params.token)
    return NextResponse.json({ price: rawPrice.toString(), decimals })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
