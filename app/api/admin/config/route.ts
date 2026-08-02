import { authOptions } from '@/app/lib/auth-options'
import { prisma } from '@/app/lib/prisma'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/config
 * Returns all system configurations. Redacts secrets unless requested.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const configs = await prisma.systemConfig.findMany({
    orderBy: { key: 'asc' }
  })

  // Merge with environment variables for specific keys, prioritizing process.env
  const envKeys = [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_BOT_TOKEN',
    'DISCORD_BACKUP_BOT_TOKEN',
    'DISCORD_BACKUP_CLIENT_ID',
    'DISCORD_BACKUP_CLIENT_SECRET',
    'DISCORD_BOT_FAILOVER_MODE',
    'DISCORD_BOT_QUARANTINED',
    'DISCORD_BACKUP_VERIFY_MESSAGE_ID',
    'DISCORD_AUTO_OUTAGE_BANNER',
    'DISCORD_ADMIN_PUBLIC_KEY',
    'DISCORD_ALERTS_CHANNEL_ID',
    'DISCORD_AI_CHAT_CHANNEL_ID',
    'DISCORD_GUILD_ID',
    'DISCORD_STAFF_CHANNEL_ID',
    'DISCORD_DROP_CHANNEL_ID',
    'DISCORD_MANIFEST_UPLOAD_CHANNEL_ID',
    'DISCORD_ADDED_GAMES_CHANNEL_ID',
    'DISCORD_DROP_ROLE_ID',
    'DISCORD_DROP_MODE',
    'DISCORD_BOT_ENABLED',
    'DISCORD_UNVERIFIED_ROLE_ID',
    'DISCORD_VERIFIED_ROLE_ID',
    'DISCORD_VERIFY_CHANNEL_ID',
    'DISCORD_VERIFY_MESSAGE_ID',
    'DISCORD_VERIFY_BANNER_URL',
    'DISCORD_VERIFY_ENABLED',
    'DISCORD_VERIFY_ALT_BLOCK_MODE',
    'DISCORD_VERIFY_ALT_BLOCK_FLAGS',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_DEFAULT_REGION',
    'AWS_ENDPOINT_URL',
    'AWS_S3_BUCKET_NAME',
    'AUTOGEN_ENABLED',
    'AUTOGEN_MODE',
    'AUTOGEN_PROVIDER_ORDER',
    'AUTOGEN_DAILY_LIMIT',
    'AUTOGEN_DEPOTBOX_DAILY_LIMIT',
    'AUTOGEN_DEPOTBOX_CURSOR',
    'AUTOGEN_DEPOTBOX_SPREAD_HOURS',
    'AUTOGEN_DEPOTBOX_DAY_KEY',
    'AUTOGEN_DEPOTBOX_DAY_COUNT',
    'AUTOGEN_DEPOTBOX_NEXT_RUN_AT',
    'AUTOGEN_OPERATOR_DISCORD_ID',
    'DEPOTBOX_API_KEY',
    'DEPOTBOX_API_BASE',
    'DEPOTBOX_REQUESTS_PER_MINUTE',
    'RYUU_API_KEY',
    'MORRENUS_API_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'RESEND_INBOUND_ADDRESS',
    'RESEND_WEBHOOK_SECRET',
    'SUPPORT_RECIPIENT',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'GLOBAL_RATE_LIMIT',
    'GLOBAL_BURST_LIMIT',
    'GOOGLE_SERVICE_ACCOUNT',
    'TRELLO_API_KEY',
    'TRELLO_API_TOKEN',
    'TRELLO_BOARD_ID',
    'VAULTCORD_API_KEY'
  ]

  const configsMap = new Map<string, { key: string; value: string; isSecret: boolean; hasValue: boolean }>()

  // 1. Fill from DB
  for (const c of configs) {
    configsMap.set(c.key, {
      key: c.key,
      value: c.isSecret ? (c.value ? '••••••••••••••••' : '') : c.value,
      isSecret: c.isSecret,
      hasValue: !!c.value
    })
  }

  // 2. Override with Environment variables if they are set
  for (const key of envKeys) {
    const envVal = process.env[key]
    if (envVal) {
      const isSecret = key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY') || key.includes('PASS') || key === 'GOOGLE_SERVICE_ACCOUNT'
      configsMap.set(key, {
        key,
        value: isSecret ? '••••••••••••••••' : envVal,
        isSecret,
        hasValue: true
      })
    }
  }

  const allConfigs = Array.from(configsMap.values())

  return NextResponse.json({ configs: allConfigs })
}

/**
 * POST /api/admin/config
 * Create or update a configuration key.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { discordId: (session.user as any).discordId }
  })

  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { key, value, isSecret } = await request.json().catch(() => ({}))

  if (!key) {
    return NextResponse.json({ error: 'Key is required' }, { status: 400 })
  }

  const config = await prisma.systemConfig.upsert({
    where: { key },
    update: { value, isSecret: isSecret ?? false },
    create: { key, value, isSecret: isSecret ?? false }
  })

  // Log the administrative action
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'UPDATE_CONFIG',
      targetId: key,
      details: `Updated system configuration key: ${key}`,
      ip: request.headers.get('x-forwarded-for') || '127.0.0.1'
    }
  })

  return NextResponse.json({ success: true, config })
}
