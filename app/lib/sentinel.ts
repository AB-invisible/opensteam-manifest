import { prisma } from './prisma'
import { BLACKLISTED_PATTERNS } from './security-patterns'

export interface SentinelContext {
  userId?: string
  ip: string
  userAgent?: string
  fingerprint?: string
  payload?: string
}

export enum JailLevel {
  NONE = 0,
  HOUR = 1,
  TWELVE_HOURS = 2,
  PERMANENT = 3
}

export class Sentinel {
  /**
   * Main entry point to process a request through the security engine.
   * Returns true if the request should be blocked.
   */
  static async checkRequest(ctx: SentinelContext): Promise<{ blocked: boolean; reason?: string }> {
    // 0. Check for IP Blacklist FIRST
    const isBlacklisted = await prisma.blacklistedIp.findUnique({ where: { ip: ctx.ip } })
    if (isBlacklisted) {
      return { blocked: true, reason: 'Security Violation: Your network has been blacklisted for malicious activity.' }
    }

    const user = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId } }) : null
    
    // 1. Check if already jailed
    if (user) {
      if (user.jailLevel === JailLevel.PERMANENT || user.isBanned) {
        return { blocked: true, reason: 'Security Violation: Account permanently suspended.' }
      }
      
      // Bypass: Trusted users skip automated risk scoring
      if ((user as any).securityBypass) {
        return { blocked: false }
      }

      if (user.jailUntil && new Date() < new Date(user.jailUntil)) {
        return { blocked: true, reason: `Security Violation: Account suspended until ${new Date(user.jailUntil).toLocaleString()}.` }
      }
    }

    // 2. Perform Risk Scoring
    let riskIncrement = 0
    const riskReasons: string[] = []

    // ---- Payload Scanning (Injection Detection) ----
    if (ctx.payload) {
      for (const pattern of BLACKLISTED_PATTERNS) {
        if (pattern.test(ctx.payload)) {
          riskIncrement += 110 // Immediate blocking/jail threshold
          riskReasons.push(`Malicious payload pattern: ${pattern.source}`)
          break
        }
      }
    }

    // ---- UA Detection ----
    if (ctx.userAgent) {
      const lowUA = ctx.userAgent.toLowerCase()
      if (lowUA.includes('headless') || lowUA.includes('playwright') || lowUA.includes('puppeteer') || lowUA.includes('selenium')) {
        riskIncrement += 20 // Adjusted from 10
        riskReasons.push('Automated Client Detected (Developer tools)')
      } else if (lowUA.includes('python-requests') || lowUA.includes('curl') || lowUA.includes('wget') || lowUA.includes('scrapy') || lowUA.includes('go-http-client') || lowUA.includes('axios')) {
        riskIncrement += 50
        riskReasons.push('Known Scraper/CLI Tool Detected')
      }
    }

    // ---- IP Velocity (Device across many IPs) ----
    if (ctx.fingerprint) {
      // Find how many unique IPs this fingerprint used in the last 24h
      const uniqueIps = await prisma.apiUsage.groupBy({
        by: ['ip'],
        where: {
          fingerprint: ctx.fingerprint, 
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      })
      
      if (uniqueIps.length > 5) {
        riskIncrement += 40
        riskReasons.push(`High IP velocity (${uniqueIps.length} IPs)`)
      }

      // ---- Multi-Account Detection (Fingerprint Collision) ----
      const uniqueUsers = await prisma.apiUsage.groupBy({
        by: ['apiKeyId'],
        where: {
          fingerprint: ctx.fingerprint,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      })

      if (uniqueUsers.length > 2) {
        riskIncrement += 30
        riskReasons.push(`Multi-account collision (${uniqueUsers.length} users)`)
      }

      // ---- Security Log History Check ----
      const recentLogs = await prisma.sentinelLog.count({
        where: { ip: ctx.ip, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }
      })
      if (recentLogs > 3) {
        riskIncrement += 50
        riskReasons.push('Suspect device: Repeated security-flagged requests')
      }
    }

 
    if (riskIncrement > 0) {
      const action = 'RISK_LOG'
      const finalScore = riskIncrement
      const details = { riskReasons }

      if (user) {
        const currentScore = (user.riskScore || 0) + riskIncrement
        await prisma.user.update({
          where: { id: user.id },
          data: { riskScore: currentScore }
        }).catch(() => {})
      }

      // ALWAYS create a sentinel log entry, even for guests
      await prisma.sentinelLog.create({
        data: {
          userId: user?.id || null,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          fingerprint: ctx.fingerprint,
          action: action as any,
          score: finalScore,
          reason: riskReasons.join(', '),
          details: details as any
        }
      }).catch(() => {})
    }

    return { blocked: false }
  }
}

const burstAlertCooldown = new Map<string, number>()

/**
 * Detect API burst anomalies and alert ops (observational — does not block).
 */
export async function checkApiBurstAnomaly(input: {
  userId: string
  apiKeyId: string
  ip: string
  burstLimit: number
}) {
  const since = new Date(Date.now() - 60 * 1000)
  const recentCount = await prisma.apiUsage.count({
    where: {
      apiKeyId: input.apiKeyId,
      createdAt: { gte: since },
    },
  })

  const threshold = Math.max(input.burstLimit * 3, 60)
  if (recentCount < threshold) return

  const key = `${input.userId}:${Math.floor(Date.now() / (15 * 60 * 1000))}`
  if (burstAlertCooldown.has(key)) return
  burstAlertCooldown.set(key, Date.now())

  const { sendBotAlert } = await import('./bot-admin')
  await sendBotAlert(
    `📈 **API burst anomaly**\nUser \`${input.userId}\` · Key \`${input.apiKeyId}\`\n` +
      `${recentCount} requests in 60s (threshold ${threshold}) from IP ${input.ip}`,
    'SECURITY'
  ).catch(() => {})

  await prisma.sentinelLog.create({
    data: {
      userId: input.userId,
      ip: input.ip,
      action: 'BURST_ANOMALY',
      score: recentCount,
      reason: `${recentCount} API requests in 60s`,
      details: { apiKeyId: input.apiKeyId, threshold },
    },
  }).catch(() => {})
}
