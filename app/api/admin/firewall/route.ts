import { authOptions } from '@/app/lib/auth-options';
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/app/lib/prisma'
import { getActiveJails, clearIpJail } from '@/app/lib/ratelimit'
import { sendWebhook } from '@/app/lib/webhooks'
import { getClientIp } from '@/app/lib/ip'

export const dynamic = 'force-dynamic'

/**
 * GET: List active IP jails
 * DELETE: Clear an IP jail
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!user || (user.role as any) !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const jails = await getActiveJails()
    const blacklist = await (prisma as any).blacklistedIp.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json({ jails, blacklist })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!user || user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { ip } = await request.json()
    const { searchParams } = new URL(request.url)
    const isPermanent = searchParams.get('permanent') === 'true'

    if (ip) {
      if (isPermanent) {
        await (prisma as any).blacklistedIp.delete({ where: { ip } })
        const { refreshBlacklist } = await import('@/app/lib/ratelimit')
        await refreshBlacklist()
      } else {
        await clearIpJail(ip)
      }
      
      if (isPermanent) {
        sendWebhook('IP_UNBANNED', {
          username: user.username,
          ip: ip
        })
      } else {
        sendWebhook('ADMIN_ACTION', {
          action: 'IP_JAIL_CLEARED',
          username: user.username,
          ip: ip,
          details: `Cleared temporary jail for ${ip}`
        })
      }

      const { createAuditLog } = await import('@/app/lib/audit')
      const clientIp = getClientIp(request)
      await createAuditLog(
        user.id, 
        isPermanent ? 'UNBLACKLIST_IP' : 'CLEAR_JAIL', 
        ip, 
        isPermanent ? 'Removed from permanent blacklist' : 'Cleared rate-limit jail',
        clientIp
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to clear jail' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const caller = await prisma.user.findUnique({
      where: { discordId: (session.user as any).discordId }
    })

    if (!caller || caller.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { ip, reason } = await request.json()
    if (!ip) return NextResponse.json({ error: 'IP is required' }, { status: 400 })

    await (prisma as any).blacklistedIp.upsert({
      where: { ip },
      update: { reason: reason || 'Banned by Admin' },
      create: { ip, reason: reason || 'Banned by Admin' }
    })

    // Refresh memory
    const { refreshBlacklist } = await import('@/app/lib/ratelimit')
    await refreshBlacklist()

    sendWebhook('IP_BANNED', {
      username: caller.username,
      ip: ip,
      details: reason || 'Banned by Admin for persistent abuse'
    })

    const { createAuditLog } = await import('@/app/lib/audit')
    const clientIp = getClientIp(request)
    await createAuditLog(
      caller.id, 
      'BLACKLIST_IP', 
      ip, 
      reason || 'Banned by Admin', 
      clientIp
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Firewall Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}
