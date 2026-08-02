import { NextResponse } from 'next/server'
import { getPublicSteamAccountProducts } from '@/app/lib/steam-accounts-shop'

export async function GET() {
  return NextResponse.json({
    products: getPublicSteamAccountProducts(),
  })
}
