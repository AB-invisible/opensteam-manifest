import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { getClientIp } from '@/app/lib/ip'
import { prisma } from '@/app/lib/prisma'
import {
  applyAdminPlanUpgrade,
  computePlanExpiry,
  findUserByIdentifier,
  getAdminPlanOptions,
  isValidPlan,
} from '@/app/lib/admin-plan-upgrade'

export const dynamic = 'force-dynamic'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId as string },
  })
  if (!user || user.role !== 'OWNER') return null
  return user
}

export async function GET(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) {
    return NextResponse.json({ error: 'Forbidden. Owner access required.' }, { status: 403 })
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  let user = null
  if (q) {
    user = await findUserByIdentifier(q)
  }

  return NextResponse.json({
    plans: getAdminPlanOptions(),
    user,
  })
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner()
  if (!owner) {
    return NextResponse.json({ error: 'Forbidden. Owner access required.' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required.' }, { status: 400 })
    }

    if (!isValidPlan(body.plan)) {
      return NextResponse.json({ error: 'Invalid plan selected.' }, { status: 400 })
    }

    const target = await findUserByIdentifier(userId)
    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    let planExpiry: Date | null
    try {
      planExpiry = computePlanExpiry({
        plan: body.plan,
        indefinite: body.indefinite === true,
        months: body.months !== undefined ? Number(body.months) : undefined,
        expiryDate: typeof body.expiryDate === 'string' ? body.expiryDate : null,
        currentPlan: target.plan,
        currentExpiry: target.planExpiry,
      })
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Invalid duration.' }, { status: 400 })
    }

    const updatedUser = await applyAdminPlanUpgrade({
      callerId: owner.id,
      targetUserId: target.id,
      plan: body.plan,
      planExpiry,
      ip: getClientIp(request),
    })

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        discordId: updatedUser.discordId,
        username: updatedUser.username,
        plan: updatedUser.plan,
        planExpiry: updatedUser.planExpiry,
      },
      message: `Upgraded ${updatedUser.username} to ${updatedUser.plan}.`,
    })
  } catch (error: any) {
    console.error('[admin/users/upgrade] POST error:', error)
    return NextResponse.json({ error: error.message || 'Failed to upgrade plan.' }, { status: 500 })
  }
}
