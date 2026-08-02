import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Plan } from '@prisma/client'
import { authOptions } from '@/app/lib/auth-options'
import { createAuditLog } from '@/app/lib/audit'
import { prisma } from '@/app/lib/prisma'
import { createVoucher } from '@/app/lib/vouchers'

export const dynamic = 'force-dynamic'

const UPGRADE_PLANS: Plan[] = ['REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS', 'CUSTOM']

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
  })
  if (!user || user.role !== 'OWNER') return null
  return user
}

function parsePlanValue(plan: unknown, months: unknown) {
  if (typeof plan !== 'string' || !UPGRADE_PLANS.includes(plan as Plan)) {
    return { error: 'Invalid plan selected.' }
  }

  const monthCount = Number(months)
  if (!Number.isFinite(monthCount) || monthCount < 1 || monthCount > 36) {
    return { error: 'Duration must be between 1 and 36 months.' }
  }

  return { value: `${plan}:${Math.round(monthCount)}` }
}

export async function GET() {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const vouchers = await prisma.voucher.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        creator: { select: { username: true, discordId: true } },
        usedBy: { select: { username: true, discordId: true } },
      },
    })

    return NextResponse.json({ vouchers })
  } catch (error) {
    console.error('[admin/vouchers] GET error:', error)
    return NextResponse.json({ error: 'Failed to load vouchers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parsePlanValue(body.plan, body.months)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const uses = Math.min(100, Math.max(1, Number(body.uses) || 1))
    const quantity = Math.min(50, Math.max(1, Number(body.quantity) || 1))
    const customCode = typeof body.customCode === 'string' ? body.customCode.trim().toUpperCase() : ''

    if (quantity > 1 && customCode) {
      return NextResponse.json(
        { error: 'Custom codes can only be used when generating a single voucher.' },
        { status: 400 }
      )
    }

    let expiresAt: Date | undefined
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt)
      if (Number.isNaN(expiresAt.getTime())) {
        return NextResponse.json({ error: 'Invalid expiry date.' }, { status: 400 })
      }
    }

    const created = []
    for (let i = 0; i < quantity; i += 1) {
      const voucher = await createVoucher({
        creatorId: owner.id,
        type: 'PLAN_UPGRADE',
        value: parsed.value,
        uses,
        expiresAt,
        code: i === 0 ? customCode || undefined : undefined,
      })
      created.push(voucher)
    }

    await createAuditLog(
      owner.id,
      'CREATE_VOUCHER',
      created[0]?.id,
      JSON.stringify({
        quantity: created.length,
        value: parsed.value,
        uses,
        codes: created.map((v) => v.code),
      }),
      'AdminPanel'
    )

    return NextResponse.json({
      vouchers: created,
      message:
        created.length === 1
          ? `Voucher ${created[0].code} created.`
          : `${created.length} vouchers created.`,
    })
  } catch (error: any) {
    console.error('[admin/vouchers] POST error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create voucher' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'Voucher id is required.' }, { status: 400 })

    const voucher = await prisma.voucher.findUnique({ where: { id } })
    if (!voucher) return NextResponse.json({ error: 'Voucher not found.' }, { status: 404 })

    await prisma.voucher.delete({ where: { id } })

    await createAuditLog(
      owner.id,
      'DELETE_VOUCHER',
      id,
      JSON.stringify({ code: voucher.code, value: voucher.value }),
      'AdminPanel'
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/vouchers] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete voucher' }, { status: 500 })
  }
}
