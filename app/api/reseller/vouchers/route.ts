import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth-options';
import { prisma } from '@/app/lib/prisma';
import { createVoucher } from '@/app/lib/vouchers';

/**
 * GET /api/reseller/vouchers
 * List vouchers created by the reseller, or ALL vouchers if caller is Admin/Owner.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (userRecord.plan !== 'RESELLER' && userRecord.role !== 'ADMIN' && userRecord.role !== 'OWNER') {
    return NextResponse.json({ error: 'Access denied. Reseller plan required.' }, { status: 403 });
  }

  try {
    const isStaff = userRecord.role === 'ADMIN' || userRecord.role === 'OWNER';
    const vouchers = await (prisma as any).voucher.findMany({
      where: isStaff ? {} : { creatorId: userRecord.id },
      include: {
        creator: {
          select: { username: true, id: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json({ vouchers });
  } catch (error) {
    console.error('Fetch vouchers error:', error);
    return NextResponse.json({ error: 'Failed to fetch vouchers' }, { status: 500 });
  }
}

/**
 * POST /api/reseller/vouchers
 * Create a new voucher for distribution. Supports Plan Upgrade (PLAN:MONTHS format) or Credits.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (userRecord.plan !== 'RESELLER' && userRecord.role !== 'ADMIN' && userRecord.role !== 'OWNER') {
    return NextResponse.json({ error: 'Access denied. Reseller plan required.' }, { status: 403 });
  }

  try {
    const { type, value, uses, expiresAt } = await req.json();
    if (!type || !value) {
      return NextResponse.json({ error: 'Type and value are required' }, { status: 400 });
    }

    const voucher = await createVoucher({
      creatorId: userRecord.id,
      type,
      value,
      uses: parseInt(uses, 10) || 1,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    return NextResponse.json({ voucher });
  } catch (error) {
    console.error('Create voucher error:', error);
    return NextResponse.json({ error: 'Failed to create voucher' }, { status: 500 });
  }
}

/**
 * PUT /api/reseller/vouchers
 * Rebrand / edit / update an existing voucher code or properties.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (userRecord.plan !== 'RESELLER' && userRecord.role !== 'ADMIN' && userRecord.role !== 'OWNER') {
    return NextResponse.json({ error: 'Access denied. Reseller plan required.' }, { status: 403 });
  }

  try {
    const { id, code, type, value, uses, expiresAt } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Voucher ID is required' }, { status: 400 });
    }

    const voucher = await (prisma as any).voucher.findUnique({
      where: { id }
    });

    if (!voucher) {
      return NextResponse.json({ error: 'Voucher not found' }, { status: 404 });
    }

    const isStaff = userRecord.role === 'ADMIN' || userRecord.role === 'OWNER';
    if (voucher.creatorId !== userRecord.id && !isStaff) {
      return NextResponse.json({ error: 'Access denied. You do not own this voucher.' }, { status: 403 });
    }

    let finalCode = voucher.code;
    if (code && code.trim() !== voucher.code) {
      const cleanCode = code.trim().toUpperCase();
      const existing = await (prisma as any).voucher.findUnique({
        where: { code: cleanCode }
      });
      if (existing) {
        return NextResponse.json({ error: 'Voucher code already in use' }, { status: 400 });
      }
      finalCode = cleanCode;
    }

    const updated = await (prisma as any).voucher.update({
      where: { id },
      data: {
        code: finalCode,
        type: type || voucher.type,
        value: value || voucher.value,
        uses: uses !== undefined ? parseInt(uses, 10) : voucher.uses,
        expiresAt: expiresAt ? new Date(expiresAt) : voucher.expiresAt,
      }
    });

    return NextResponse.json({ voucher: updated });
  } catch (error) {
    console.error('Update voucher error:', error);
    return NextResponse.json({ error: 'Failed to update voucher' }, { status: 500 });
  }
}

/**
 * DELETE /api/reseller/vouchers
 * Delete / revoke a voucher from distribution.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRecord = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  });

  if (!userRecord) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (userRecord.plan !== 'RESELLER' && userRecord.role !== 'ADMIN' && userRecord.role !== 'OWNER') {
    return NextResponse.json({ error: 'Access denied. Reseller plan required.' }, { status: 403 });
  }

  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Voucher ID is required' }, { status: 400 });
    }

    const voucher = await (prisma as any).voucher.findUnique({
      where: { id }
    });

    if (!voucher) {
      return NextResponse.json({ error: 'Voucher not found' }, { status: 404 });
    }

    const isStaff = userRecord.role === 'ADMIN' || userRecord.role === 'OWNER';
    if (voucher.creatorId !== userRecord.id && !isStaff) {
      return NextResponse.json({ error: 'Access denied. You do not own this voucher.' }, { status: 403 });
    }

    await (prisma as any).voucher.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete voucher error:', error);
    return NextResponse.json({ error: 'Failed to delete voucher' }, { status: 500 });
  }
}
