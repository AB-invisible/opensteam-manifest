import { prisma } from './prisma'
import { sendBotAlert } from './bot-admin'

const FUNNEL_ACTIONS = [
  'SESSION_CREATED',
  'SESSION_VALIDATED',
  'OAUTH_STARTED',
  'OAUTH_COMPLETE',
  'OAUTH_ID_MISMATCH',
  'VPN_BLOCKED',
  'VERIFICATION_COMPLETE',
  'GUILD_LEFT_WEB_REVOKE',
] as const

const FAILURE_ACTIONS = new Set(['OAUTH_ID_MISMATCH', 'VPN_BLOCKED', 'SESSION_VALIDATED_FAIL'])

export type VerifyFunnelMetrics = {
  windowHours: number
  counts: Record<string, number>
  sessionsByStatus: Record<string, number>
  failureRate: number
  completionRate: number
}

export async function computeVerifyFunnel(windowHours = 24): Promise<VerifyFunnelMetrics> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const [auditGroups, sessionGroups] = await Promise.all([
    prisma.verificationAuditLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: since } },
      _count: { action: true },
    }),
    prisma.discordVerificationSession.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { status: true },
    }),
  ])

  const counts: Record<string, number> = {}
  for (const action of FUNNEL_ACTIONS) counts[action] = 0
  for (const row of auditGroups) {
    counts[row.action] = row._count.action
  }

  const sessionsByStatus: Record<string, number> = {}
  for (const row of sessionGroups) {
    sessionsByStatus[row.status] = row._count.status
  }

  const started = counts.SESSION_CREATED || 0
  const completed = counts.VERIFICATION_COMPLETE || 0
  const failures =
    (counts.OAUTH_ID_MISMATCH || 0) +
    (counts.VPN_BLOCKED || 0) +
    (sessionsByStatus.FAILED || 0) +
    (sessionsByStatus.EXPIRED || 0)

  return {
    windowHours,
    counts,
    sessionsByStatus,
    failureRate: started > 0 ? failures / started : 0,
    completionRate: started > 0 ? completed / started : 0,
  }
}

let lastFailureAlertAt = 0

/** Alert Discord ops channel when verify failures spike in the last hour. */
export async function checkVerifyFailureSpike() {
  const metrics = await computeVerifyFunnel(1)
  const started = metrics.counts.SESSION_CREATED || 0
  if (started < 5) return

  const failures =
    (metrics.counts.OAUTH_ID_MISMATCH || 0) +
    (metrics.counts.VPN_BLOCKED || 0) +
    (metrics.sessionsByStatus.FAILED || 0)

  const rate = failures / started
  if (rate < 0.4) return

  const now = Date.now()
  if (now - lastFailureAlertAt < 30 * 60 * 1000) return
  lastFailureAlertAt = now

  await sendBotAlert(
    `⚠️ **Verify failure spike** (last 1h)\n` +
      `Started: ${started} · Failures: ${failures} · Rate: ${(rate * 100).toFixed(0)}%\n` +
      `VPN blocked: ${metrics.counts.VPN_BLOCKED || 0} · OAuth mismatch: ${metrics.counts.OAUTH_ID_MISMATCH || 0}`,
    'SECURITY'
  ).catch(() => {})
}

export function isVerifyFailureAction(action: string): boolean {
  return FAILURE_ACTIONS.has(action)
}
