import { HostedBotStatus, HostedBotType, Plan, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  canLinkBrandedHostedBot,
  getHostedBotTypeForPlan,
  isHostedBotPlanActive,
  isPlanEligibleForHostedBot,
  resolveBrandedHostedInstancePlan,
  resolveCustomHostedInstancePlan,
} from './hosted-bot-plans'
import { encryptHostedBotSecret, canEncryptHostedBotSecrets } from './hosted-bot-crypto'

export const HOSTED_BOT_INVITE_PERMISSIONS = 51200 // Send Messages, Embed Links, Attach Files

export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
}

export function buildBotInviteUrl(clientId: string): string {
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${HOSTED_BOT_INVITE_PERMISSIONS}&scope=bot%20applications.commands`
}

export function getBrandedOAuthRedirectUrl(): string {
  return `${getAppBaseUrl()}/api/hosted-bot/branded/oauth/callback`
}

export function getCustomOAuthRedirectUrl(): string {
  return `${getAppBaseUrl()}/api/hosted-bot/custom/oauth/callback`
}

export async function getBrandedBotConfig() {
  const keys = [
    'HOSTED_BRANDED_CLIENT_ID',
    'HOSTED_BRANDED_CLIENT_SECRET',
    'HOSTED_BRANDED_BOT_TOKEN',
    'HOSTED_BRANDED_ENABLED',
  ]
  const configs = await prisma.systemConfig.findMany({ where: { key: { in: keys } } })
  const map = Object.fromEntries(configs.map((c) => [c.key, c.value]))
  return {
    clientId: map.HOSTED_BRANDED_CLIENT_ID || '',
    clientSecret: map.HOSTED_BRANDED_CLIENT_SECRET || '',
    botToken: map.HOSTED_BRANDED_BOT_TOKEN || '',
    enabled: map.HOSTED_BRANDED_ENABLED === 'true',
    hasClientId: !!map.HOSTED_BRANDED_CLIENT_ID,
    hasClientSecret: !!map.HOSTED_BRANDED_CLIENT_SECRET,
    hasBotToken: !!map.HOSTED_BRANDED_BOT_TOKEN,
  }
}

export async function upsertHostedBotInstanceForUser(userId: string, plan: Plan) {
  const type = getHostedBotTypeForPlan(plan)
  if (!type) {
    await suspendHostedBotInstance(userId, true)
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiry: true, planIsCanceled: true },
  })

  const existing = await prisma.hostedBotInstance.findUnique({ where: { userId } })
  if (existing) {
    const data: Prisma.HostedBotInstanceUpdateInput = { type }
    if (existing.type !== type) {
      data.guildId = null
      data.status = 'PENDING'
      data.inviteUrl = null
      if (type === 'BRANDED') {
        data.botClientId = null
        data.botTokenEnc = null
        data.botSecretEnc = null
      }
      if (type === 'CUSTOM' && existing.type === 'BRANDED') {
        data.botClientId = null
        data.botTokenEnc = null
        data.botSecretEnc = null
      }
    }
    if (user && isHostedBotPlanActive(user)) {
      if (existing.status === 'SUSPENDED' && !existing.lockedByOwner) {
        data.status = existing.guildId ? 'ACTIVE' : existing.botClientId ? 'SETUP' : 'PENDING'
      }
    }
    return prisma.hostedBotInstance.update({ where: { userId }, data })
  }

  return prisma.hostedBotInstance.create({
    data: { userId, type, status: 'PENDING' },
  })
}

export async function suspendHostedBotInstance(userId: string, wipeCustomCredentials = false) {
  const data: Prisma.HostedBotInstanceUpdateInput = {
    status: 'SUSPENDED',
    lastStoppedAt: new Date(),
  }
  if (wipeCustomCredentials) {
    data.botTokenEnc = null
    data.botSecretEnc = null
  }
  return prisma.hostedBotInstance.updateMany({ where: { userId }, data })
}

export async function verifyBotInGuild(botToken: string, guildId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function verifyUserManagesGuild(
  userAccessToken: string,
  guildId: string
): Promise<boolean> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    })
    if (!res.ok) return false
    const guilds = (await res.json()) as Array<{ id: string; permissions: string }>
    const guild = guilds.find((g) => g.id === guildId)
    if (!guild) return false
    const perms = BigInt(guild.permissions)
    const MANAGE_GUILD = BigInt(0x20)
    const ADMINISTRATOR = BigInt(0x8)
    return (perms & ADMINISTRATOR) !== BigInt(0) || (perms & MANAGE_GUILD) !== BigInt(0)
  } catch {
    return false
  }
}

/** One Discord server ↔ one OpenSteam account; one custom bot ↔ one guild. */
export function validateHostedGuildLink(input: {
  actingUserId: string
  targetGuildId: string
  linkType: HostedBotType
  currentInstance: { userId: string; guildId: string | null; type: HostedBotType } | null
  existingGuildBinding: { userId: string; type: HostedBotType } | null
}): { ok: true } | { ok: false; error: string; status: number } {
  if (input.currentInstance?.guildId && input.currentInstance.guildId !== input.targetGuildId) {
    return {
      ok: false,
      error:
        'Your OpenSteam bot is already linked to a different Discord server. Unlink from the dashboard first.',
      status: 409,
    }
  }

  if (!input.existingGuildBinding) return { ok: true }

  if (input.existingGuildBinding.userId !== input.actingUserId) {
    const otherLabel = input.existingGuildBinding.type === 'CUSTOM' ? 'custom' : 'branded'
    return {
      ok: false,
      error: `This Discord server is already linked to another OpenSteam account (${otherLabel} bot). Only one OpenSteam bot is allowed per server.`,
      status: 409,
    }
  }

  return { ok: true }
}

/** @deprecated use validateHostedGuildLink */
export function assertGuildBindingExclusive(input: {
  actingUserId: string
  guildId: string
  existingGuildOwnerId: string | null
  currentInstance: { id: string; userId: string; guildId: string | null; type: string }
}): { ok: true } | { ok: false; error: string; status: number } {
  if (input.existingGuildOwnerId && input.existingGuildOwnerId !== input.actingUserId) {
    return {
      ok: false,
      error:
        'That Discord server is already linked to a different OpenSteam account. Each server can only belong to one subscriber.',
      status: 409,
    }
  }

  if (input.currentInstance.userId !== input.actingUserId) {
    return { ok: false, error: 'Instance ownership mismatch', status: 403 }
  }

  return { ok: true }
}

export async function getActiveCustomLinkedGuildIds(): Promise<string[]> {
  const rows = await prisma.hostedBotInstance.findMany({
    where: { type: 'CUSTOM', status: 'ACTIVE', guildId: { not: null } },
    select: { guildId: true },
  })
  return rows.map((r) => r.guildId!).filter(Boolean)
}

export async function getActiveBrandedLinkedGuildIds(): Promise<string[]> {
  const rows = await prisma.hostedBotInstance.findMany({
    where: { type: 'BRANDED', status: 'ACTIVE', guildId: { not: null } },
    select: { guildId: true },
  })
  return rows.map((r) => r.guildId!).filter(Boolean)
}

export async function saveCustomBotCredentials(
  userId: string,
  input: { botToken: string; clientId: string; clientSecret: string }
) {
  if (!canEncryptHostedBotSecrets()) {
    throw new Error('HOSTED_BOT_ENCRYPTION_KEY is not configured on the server')
  }

  const existing = await prisma.hostedBotInstance.findUnique({ where: { userId } })
  const clientId = String(input.clientId || '').trim() || existing?.botClientId || ''
  const botToken = String(input.botToken || '').trim()
  const clientSecret = String(input.clientSecret || '').trim()

  const botTokenEnc = botToken
    ? encryptHostedBotSecret(botToken)
    : existing?.botTokenEnc ?? null
  const botSecretEnc = clientSecret
    ? encryptHostedBotSecret(clientSecret)
    : existing?.botSecretEnc ?? null

  if (!clientId || !botTokenEnc || !botSecretEnc) {
    throw new Error('Bot token, client ID, and client secret are required')
  }

  const inviteUrl = buildBotInviteUrl(clientId)
  const encrypted = {
    type: 'CUSTOM' as const,
    botClientId: clientId,
    botTokenEnc,
    botSecretEnc,
    inviteUrl,
    status: 'SETUP' as const,
  }

  return prisma.hostedBotInstance.upsert({
    where: { userId },
    create: {
      userId,
      ...encrypted,
    },
    update: encrypted,
  })
}

export function serializeHostedBotInstance(
  instance: {
    id: string
    type: HostedBotType
    guildId: string | null
    status: HostedBotStatus
    lockedByOwner: boolean
    lockedReason: string | null
    botClientId: string | null
    botTokenEnc?: string | null
    inviteUrl: string | null
    lastStartedAt: Date | null
    lastStoppedAt: Date | null
    createdAt: Date
    updatedAt: Date
    modules?: string[]
  },
  options?: { includeClientId?: boolean }
) {
  return {
    id: instance.id,
    type: instance.type,
    guildId: instance.guildId,
    status: instance.status,
    lockedByOwner: instance.lockedByOwner,
    lockedReason: instance.lockedReason,
    botClientId: options?.includeClientId ? instance.botClientId : instance.botClientId ? '••••••••' : null,
    hasCredentials: !!(instance.botClientId && instance.botTokenEnc),
    inviteUrl: instance.inviteUrl,
    lastStartedAt: instance.lastStartedAt,
    lastStoppedAt: instance.lastStoppedAt,
    modules: instance.modules || [],
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  }
}

export async function ensureBrandedHostedInstanceForUser(user: {
  id: string
  plan: Plan
  role?: string | null
}) {
  const instancePlan = resolveBrandedHostedInstancePlan(user)
  if (!instancePlan) return null
  return upsertHostedBotInstanceForUser(user.id, instancePlan)
}

export async function ensureCustomHostedInstanceForUser(user: { id: string; plan: Plan }) {
  const instancePlan = resolveCustomHostedInstancePlan(user)
  if (!instancePlan) return null
  return upsertHostedBotInstanceForUser(user.id, instancePlan)
}

export async function ensureHostedInstanceForSessionUser(user: {
  id: string
  plan: Plan
  role?: string | null
}) {
  const botType = getHostedBotTypeForPlan(user.plan)
  if (botType === 'CUSTOM') return ensureCustomHostedInstanceForUser(user)
  if (botType === 'BRANDED') return ensureBrandedHostedInstanceForUser(user)
  if (user.role === 'OWNER') return ensureBrandedHostedInstanceForUser(user)
  return null
}

/** Ensures every REGULAR/PREMIUM/RESELLER/BUSINESS user has a hosted_bot_instances row (admin visibility). */
export async function syncEligibleHostedBotInstances() {
  const eligibleUsers = await prisma.user.findMany({
    where: { plan: { in: ['REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS'] } },
    select: { id: true, plan: true },
  })
  if (eligibleUsers.length === 0) return 0

  const existing = await prisma.hostedBotInstance.findMany({
    where: { userId: { in: eligibleUsers.map((u) => u.id) } },
    select: { userId: true },
  })
  const existingIds = new Set(existing.map((row) => row.userId))

  let created = 0
  for (const user of eligibleUsers) {
    if (existingIds.has(user.id)) continue
    await upsertHostedBotInstanceForUser(user.id, user.plan)
    created += 1
  }
  return created
}

const HOSTED_ELIGIBLE_PLANS = ['REGULAR', 'PREMIUM', 'RESELLER', 'BUSINESS'] as const

export async function getHostedBotAdminSnapshot() {
  const syncCreated = await syncEligibleHostedBotInstances()

  const [instances, eligibleUsers] = await Promise.all([
    prisma.hostedBotInstance.findMany({
      include: {
        user: {
          select: {
            id: true,
            username: true,
            discordId: true,
            plan: true,
            planExpiry: true,
            planIsCanceled: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.user.findMany({
      where: { plan: { in: [...HOSTED_ELIGIBLE_PLANS] } },
      select: {
        id: true,
        username: true,
        discordId: true,
        plan: true,
      },
      orderBy: { username: 'asc' },
    }),
  ])

  return {
    syncCreated,
    eligibleUsers,
    instances,
    counts: {
      eligible: eligibleUsers.length,
      brandedEligible: eligibleUsers.filter((u) => ['REGULAR', 'PREMIUM'].includes(u.plan)).length,
      customEligible: eligibleUsers.filter((u) => ['RESELLER', 'BUSINESS'].includes(u.plan)).length,
      instances: instances.length,
      brandedInstances: instances.filter((i) => i.type === 'BRANDED').length,
      customInstances: instances.filter((i) => i.type === 'CUSTOM').length,
      connected: instances.filter((i) => i.status === 'ACTIVE' && i.guildId).length,
    },
  }
}
