import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import {
  clearBotQuarantine,
  getFailoverMode,
  isBotQuarantined,
  resolveActiveBotToken,
  resolveGuildBotToken,
  resolveBackupBotToken,
  resolvePrimaryBotToken,
  sendBotDmWithFailover,
  setFailoverMode,
  type FailoverMode,
} from '@/app/lib/discord-bot-credentials'
import { buildMainBotInviteUrl, getMainBotGuildId } from '@/app/lib/main-bot-invite'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as { discordId?: string }).discordId },
  })
  if (!user || user.role !== 'OWNER') return null
  return user
}

export async function GET() {
  const user = await requireOwner()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [mode, quarantined, dmActive, guildActive, primary, backup, backupClientId, guildId] =
    await Promise.all([
      getFailoverMode(),
      isBotQuarantined(),
      resolveActiveBotToken(),
      resolveGuildBotToken(),
      resolvePrimaryBotToken(),
      resolveBackupBotToken(),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BACKUP_CLIENT_ID' } }),
      getMainBotGuildId(),
    ])

  const backupInvite =
    backupClientId?.value?.trim() && guildId
      ? buildMainBotInviteUrl(backupClientId.value.trim(), guildId)
      : null

  return NextResponse.json({
    mode,
    quarantined,
    activeSource: dmActive.source,
    guildSource: guildActive.source,
    hasPrimaryToken: Boolean(primary),
    hasBackupToken: Boolean(backup),
    backupInviteUrl: backupInvite,
  })
}

export async function POST(request: NextRequest) {
  const user = await requireOwner()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'set_mode') {
    const mode = body.mode as FailoverMode
    if (!['primary', 'backup', 'auto'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
    }
    await setFailoverMode(mode)
    const [dmActive, guildActive] = await Promise.all([
      resolveActiveBotToken(),
      resolveGuildBotToken(),
    ])
    return NextResponse.json({
      ok: true,
      mode,
      activeSource: dmActive.source,
      guildSource: guildActive.source,
    })
  }

  if (action === 'clear_quarantine') {
    await clearBotQuarantine()
    const [dmActive, guildActive] = await Promise.all([
      resolveActiveBotToken(),
      resolveGuildBotToken(),
    ])
    return NextResponse.json({
      ok: true,
      activeSource: dmActive.source,
      guildSource: guildActive.source,
    })
  }

  if (action === 'test_dm') {
    const discordId = typeof body.discordId === 'string' ? body.discordId.trim() : user.discordId
    if (!discordId) {
      return NextResponse.json({ error: 'discordId required' }, { status: 400 })
    }
    const result = await sendBotDmWithFailover(
      discordId,
      'OpenSteam backup bot failover test — if you received this, DM delivery is working.'
    )
    return NextResponse.json({ ok: result.sent, ...result })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
