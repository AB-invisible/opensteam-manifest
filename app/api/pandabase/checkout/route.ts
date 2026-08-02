import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/lib/auth-options";
import { createCheckoutSession } from "@/app/lib/pandabase";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json()
    const { planName, productId } = body

    if (productId) {
      const { STEAM_ACCOUNT_SHOP_URL } = await import('@/app/lib/steam-accounts-shop')
      return NextResponse.json(
        {
          error: 'Steam account purchases are handled on our external shop.',
          shopUrl: STEAM_ACCOUNT_SHOP_URL,
        },
        { status: 503 }
      )
    }

    const productIdMap: Record<string, string | undefined> = {
      REGULAR: process.env.PANDABASE_PRODUCT_REGULAR,
      PREMIUM: process.env.PANDABASE_PRODUCT_PREMIUM,
      RESELLER: process.env.PANDABASE_PRODUCT_RESELLER,
      BUSINESS: process.env.PANDABASE_PRODUCT_BUSINESS,
      UNBAN: process.env.PANDABASE_PRODUCT_UNBAN,
    };

    const pandabaseProductId = productIdMap[planName];
    if (!pandabaseProductId) {
      return NextResponse.json({ error: `No Pandabase product ID configured for ${planName}` }, { status: 400 });
    }

    const checkout = await createCheckoutSession({
      items: [{ product_id: pandabaseProductId, quantity: 1 }],
      metadata: {
        userId: String(userId),
        planName: String(planName),
        purchaseType: planName === 'UNBAN' ? 'unban' : 'plan',
      },
    });

    return NextResponse.json({ sessionId: checkout.sessionId, storeId: checkout.storeId });
  } catch (err: any) {
    console.error("Pandabase checkout error:", err);
    return NextResponse.json({ error: err.message || "Failed to create checkout session" }, { status: 500 });
  }
}
