import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { redeemVoucher } from '@/app/lib/vouchers';

/**
 * POST /api/user/vouchers/redeem
 * Instant plan upgrade or credit allocation via voucher code.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { code } = await req.json();
    if (!code) return NextResponse.json({ error: 'Voucher code is required' }, { status: 400 });

    const userId = (session.user as any).id;
    const result = await redeemVoucher(code, userId);

    return NextResponse.json({ 
      success: true, 
      message: result.type === 'PLAN_UPGRADE' ? `Successfully upgraded to ${result.value}!` : 'Credits applied.',
      type: result.type,
      value: result.value
    });
  } catch (error: any) {
    console.error('Voucher redemption error:', error);
    return NextResponse.json({ error: error.message || 'Redemption failed' }, { status: 400 });
  }
}
