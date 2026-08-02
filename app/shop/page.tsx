import { redirect } from 'next/navigation'
import { STEAM_ACCOUNT_SHOP_URL } from '@/app/lib/steam-accounts-shop'

export default function ShopPage() {
  redirect(STEAM_ACCOUNT_SHOP_URL)
}
