import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { HostedBotStatus } from '@prisma/client'
import { getHostedBotAdminSnapshot } from '@/app/lib/hosted-bot'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.discordId) return null
  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId as string } })
  if (!user || user.role !== 'OWNER') return null
  return user
}

const HEARTBEAT_FRESH_MS = 90_000

function serializeInstance(inst: Awaited<ReturnType<typeof getHostedBotAdminSnapshot>>['instances'][number]) {
  const heartbeatFresh =
    !!inst.lastHeartbeatAt && Date.now() - new Date(inst.lastHeartbeatAt).getTime() < HEARTBEAT_FRESH_MS
  return {
    id: inst.id,
    type: inst.type,
    guildId: inst.guildId,
    status: inst.status,
    lockedByOwner: inst.lockedByOwner,
    lockedReason: inst.lockedReason,
    botClientId: inst.botClientId,
    hasCredentials: !!(inst.botClientId && inst.botTokenEnc),
    inviteUrl: inst.inviteUrl,
    lastStartedAt: inst.lastStartedAt,
    lastStoppedAt: inst.lastStoppedAt,
    createdAt: inst.createdAt,
    updatedAt: inst.updatedAt,
    user: inst.user,
    setupStep: getCustomSetupStep(inst),
    isConnected: inst.status === 'ACTIVE' && !!inst.guildId,
    // Runtime metadata captured by the daemons
    botUsername: inst.botUsername,
    guildName: inst.guildName,
    guildOwnerId: inst.guildOwnerId,
    guildOwnerName: inst.guildOwnerName,
    memberCount: inst.memberCount,
    connectedAt: inst.connectedAt,
    lastHeartbeatAt: inst.lastHeartbeatAt,
    liveConnected: heartbeatFresh,
  }
}

function getCustomSetupStep(inst: {
  type: string
  botClientId: string | null
  botTokenEnc: string | null
  guildId: string | null
  status: string
}) {
  if (inst.type !== 'CUSTOM') {
    return inst.guildId ? 'connected' : inst.status.toLowerCase()
  }
  if (!inst.botClientId || !inst.botTokenEnc) return 'credentials'
  if (!inst.guildId) return 'link-server'
  if (inst.status === 'ACTIVE') return 'connected'
  return 'link-server'
}

export async function GET() {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const snapshot = await getHostedBotAdminSnapshot()
    return NextResponse.json({
      instances: snapshot.instances.map(serializeInstance),
      eligibleUsers: snapshot.eligibleUsers,
      meta: {
        syncCreated: snapshot.syncCreated,
        counts: snapshot.counts,
      },
    })
  } catch (e: any) {
    console.error('[admin/hosted-bot/instances GET]', e)
    const message = String(e?.message || e)
    const needsMigration =
      message.includes('hosted_bot_instances') ||
      message.includes('HostedBotInstance') ||
      message.includes('does not exist')

    return NextResponse.json(
      {
        error: needsMigration
          ? 'Hosted bot tables are missing. Run npx prisma db push on the server.'
          : 'Failed to load hosted bot instances',
        details: message,
        instances: [],
        eligibleUsers: [],
        meta: { syncCreated: 0, counts: { eligible: 0, brandedEligible: 0, customEligible: 0, instances: 0, brandedInstances: 0, customInstances: 0, connected: 0 } },
      },
      { status: needsMigration ? 503 : 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  const owner = await requireOwner()
  if (!owner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const instanceId = String(body.instanceId || '')
  const action = String(body.action || '').toLowerCase()

  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId is required' }, { status: 400 })
  }

  const instance = await prisma.hostedBotInstance.findUnique({ where: { id: instanceId } })
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  let data: {
    status?: HostedBotStatus
    lockedByOwner?: boolean
    lockedReason?: string | null
    lastStartedAt?: Date
    lastStoppedAt?: Date
  } = {}

  switch (action) {
    case 'lock':
      data = {
        lockedByOwner: true,
        lockedReason: String(body.reason || 'Locked by platform owner'),
        status: 'LOCKED',
      }
      break
    case 'unlock':
      data = {
        lockedByOwner: false,
        lockedReason: null,
        status: instance.guildId ? 'ACTIVE' : instance.type === 'CUSTOM' && instance.botClientId ? 'SETUP' : 'PENDING',
      }
      break
    case 'stop':
      data = { status: 'STOPPED', lastStoppedAt: new Date() }
      break
    case 'start':
    case 'restart':
      data = {
        status: 'ACTIVE',
        lastStartedAt: new Date(),
        ...(action === 'restart' ? { lastStoppedAt: new Date() } : {}),
      }
      break
    default:
      return NextResponse.json({ error: 'action must be lock, unlock, start, stop, or restart' }, { status: 400 })
  }

  const updated = await prisma.hostedBotInstance.update({
    where: { id: instanceId },
    data,
  })

  await prisma.auditLog.create({
    data: {
      userId: owner.id,
      action: `HOSTED_BOT_${action.toUpperCase()}`,
      details: JSON.stringify({ instanceId, type: instance.type, guildId: instance.guildId }),
    },
  })

  return NextResponse.json({ success: true, instance: updated })
}
