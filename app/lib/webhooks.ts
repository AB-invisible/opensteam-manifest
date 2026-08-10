import axios from 'axios'
import crypto from 'crypto'
import { prisma } from './prisma'
import { validateWebhookUrl } from './ssrf-url'

export type WebhookEvent = 
  | 'KEY_DISABLED' 
  | 'KEY_CREATED' 
  | 'KEY_DELETED' 
  | 'USER_SIGNUP' 
  | 'LIMIT_REACHED' 
  | 'ADMIN_ACTION' 
  | 'GAME_REQUEST' 
  | 'REQUEST_APPROVED' 
  | 'REQUEST_DENIED' 
  | 'PLAN_UPDATED' 
  | 'CRITICAL_ERROR' 
  | 'ABUSE_ALERT' 
  | 'GAME_GENERATED'
  | 'IP_BANNED'
  | 'IP_UNBANNED'
  | 'WORKER_START'
  | 'WORKER_RESULT'
  | 'GAME_ADDED'
  | 'GAME_UPDATED'
  | 'NSFW_GENERATED'
  | 'ONLINEFIX_DOWNLOAD'

interface WebhookPayload {
  content?: string
  embeds: {
    title: string
    url?: string
    description: string
    color: number
    timestamp?: string
    fields?: { name: string; value: string; inline?: boolean }[]
    footer?: { text: string }
    image?: { url: string }
    thumbnail?: { url: string }
  }[]
  allowed_mentions?: { users?: string[]; parse?: string[] }
}

const COLORS = {
  KEY_DISABLED: 0xff4444,     // Red
  KEY_CREATED: 0x00ffff,      // Cyan
  KEY_DELETED: 0x666666,      // Gray
  USER_SIGNUP: 0xffffff,      // White
  LIMIT_REACHED: 0xff6600,    // Bright Orange
  ADMIN_ACTION: 0x000000,     // Black/Dark
  GAME_REQUEST: 0x44ff44,     // Green
  REQUEST_APPROVED: 0x00ff88, // Neon Green
  REQUEST_DENIED: 0xffbb00,   // Amber/Gold
  PLAN_UPDATED: 0xaa00ff,     // Purple
  ABUSE_ALERT: 0xffaa00,      // Orange
  CRITICAL_ERROR: 0xff0000,   // Deep Red
  GAME_GENERATED: 0x00aaff,    // Blue
  IP_BANNED: 0xff0000,         // Dark Red
  IP_UNBANNED: 0x00ff00,       // Dark Green
  WORKER_START: 0x6366f1,      // Indigo
  WORKER_RESULT: 0x10b981,     // Emerald
  GAME_ADDED: 0x5865f2,        // Discord Blurple
  GAME_UPDATED: 0xfbbf24,      // Amber / Gold — distinguishes updates from new additions
  NSFW_GENERATED: 0xff00ff,    // Magenta / Pink
  ONLINEFIX_DOWNLOAD: 0x00ccff // Light Blue
}

// Removed background queue to ensure compatibility with serverless environments where execution freezes

/**
 * Sends a rich embed to the configured Discord Webhook.
 * Fails silently to prevent blocking main execution.
 */
export async function sendWebhook(event: WebhookEvent, data: any) {
  // Disabled: scraper/abuse alerts were noisy (e.g. Render health checks) and are not wanted in reports.
  if (event === 'ABUSE_ALERT') return

  const systemUrl = process.env.DISCORD_WEBHOOK_URL
  const gameUrl = process.env.DISCORD_GAME_WEBHOOK_URL

  // GAME_ADDED + GAME_UPDATED (Admin Uploads) route to Game Announcements (or System fallback)
  // All other actions (Member Activity, Keys, Errors) route to System Logs
  const isAnnouncement = event === 'GAME_ADDED' || event === 'GAME_UPDATED'
  const webhookUrl = isAnnouncement ? (gameUrl || systemUrl) : systemUrl

  if (!webhookUrl) return

  const isGameEvent = event === 'GAME_ADDED' || event === 'GAME_UPDATED' || event === 'GAME_GENERATED'

  try {
    const requesterIds: string[] = Array.isArray(data.requesterDiscordIds) ? data.requesterDiscordIds.filter(Boolean) : []
    const mentionLine = isAnnouncement && requesterIds.length
      ? `🔔 Requested by ${requesterIds.map(id => `<@${id}>`).join(' ')} — your game just dropped!`
      : undefined

    const payload: WebhookPayload = {
      content: mentionLine,
      allowed_mentions: requesterIds.length ? { users: requesterIds } : undefined,
      embeds: [{
        title: getTitle(event),
        url: data.appId ? `https://store.steampowered.com/app/${data.appId}` : undefined,
        description: getDescription(event, data),
        color: COLORS[event] || 0xcccccc,
        timestamp: isAnnouncement ? undefined : new Date().toISOString(),
        fields: getFields(event, data),
        footer: isAnnouncement ? undefined : { text: 'OpenSteam System' },
        image: isGameEvent
          ? (data.imageUrl
              ? { url: data.imageUrl }
              : (data.appId ? { url: `https://cdn.akamai.steamstatic.com/steam/apps/${data.appId}/header.jpg` } : undefined))
          : undefined
      }]
    }

    // Send immediately to avoid serverless function freezing before queue processes
    await axios.post(webhookUrl, payload, { timeout: 3000 }).catch((error: any) => {
      if (error.response?.status === 429) {
        console.warn(`[Webhook Rate Limited] ${event}`)
      } else {
        console.error('[Webhook Error]', error.message)
      }
    })
  } catch (error: any) {
    console.error('[Webhook Error]', error?.message || error)
  }

  // Integration: Also send to the high-priority Discord Bot Alert channel
  const monitoredEvents: WebhookEvent[] = ['KEY_DISABLED', 'CRITICAL_ERROR', 'IP_BANNED', 'GAME_GENERATED', 'NSFW_GENERATED']
  if (monitoredEvents.includes(event)) {
    const { sendBotAlert } = await import('./bot-admin');
    await sendBotAlert(
      `🛰️ **Platform Alert: ${event}**\n${getDescription(event, data)}`,
      'SECURITY'
    ).catch(() => {});
  }

  // Also trigger external user webhooks if applicable
  if (data.userId) {
    await sendExternalWebhook(data.userId, event, data)
  }
}

/**
 * Sends a signed JSON payload to a user-configured webhook URL.
 */
export async function sendExternalWebhook(userId: string, event: WebhookEvent, data: any) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { webhookUrl: true, webhookSecret: true } as any
    }) as any

    if (!user || !user.webhookUrl) return

    const validated = validateWebhookUrl(user.webhookUrl)
    if (!validated.ok) {
      console.warn(`[External Webhook Blocked] User ${userId}: ${validated.error}`)
      return
    }

    const payload = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data
    })

    const headers: any = {
      'Content-Type': 'application/json',
      'X-OpenSteam-Event': event,
      'User-Agent': 'OpenSteam-Sentinel/1.0'
    }

    if (user.webhookSecret) {
      const signature = crypto
        .createHmac('sha256', user.webhookSecret)
        .update(payload)
        .digest('hex')
      headers['X-OpenSteam-Signature'] = signature
    }

    await axios.post(validated.url, payload, { headers, timeout: 5000, maxRedirects: 0 })
  } catch (error: any) {
    const status = error.response?.status
    const body =
      typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.data != null
          ? JSON.stringify(error.response.data).slice(0, 400)
          : ''
    console.warn(
      `[External Webhook Failed] User ${userId}:`,
      error.message + (status != null ? ` (${status})` : ''),
      body ? body : ''
    )
  }
}

function getTitle(event: WebhookEvent): string {
  switch (event) {
    case 'KEY_DISABLED': return '🚨 API Key Auto-Disabled'
    case 'KEY_CREATED': return '🔑 New API Key Created'
    case 'KEY_DELETED': return '🗑️ API Key Deleted'
    case 'USER_SIGNUP': return '🆕 New User Registered'
    case 'LIMIT_REACHED': return '📊 Generation Limit Reached'
    case 'ADMIN_ACTION': return '🛠️ Administrative Action'
    case 'GAME_REQUEST': return '🎮 New Game Request'
    case 'REQUEST_APPROVED': return '✅ Game Request Approved'
    case 'REQUEST_DENIED': return '❌ Game Request Denied'
    case 'PLAN_UPDATED': return '💎 User Plan Updated'
    case 'ABUSE_ALERT':  return '⚠️ Security Abuse Alert'
    case 'CRITICAL_ERROR': return '🛑 Critical System Error'
    case 'GAME_GENERATED': return '📦 New Manifest Generated'
    case 'IP_BANNED': return '🛡️ IP Permanently Blacklisted'
    case 'IP_UNBANNED': return '🔓 IP Blacklist Removed'
    case 'WORKER_START': return '🏗️ Extraction Started'
    case 'WORKER_RESULT': return '✅ Extraction Finished'
    case 'GAME_ADDED': return 'Game Added!'
    case 'GAME_UPDATED': return 'Game Updated!'
    case 'NSFW_GENERATED': return '🔞 NSFW Game Generated'
    case 'ONLINEFIX_DOWNLOAD': return '⬇️ OnlineFix Downloaded'
    default: return 'System Notification'
  }
}

function getDescription(event: WebhookEvent, data: any): string {
  switch (event) {
    case 'KEY_DISABLED': 
      return `API Key **${data.keyName}** (${data.keyId}) was automatically disabled.`
    case 'KEY_CREATED':
      return `User **${data.username}** created a new API key: **${data.keyName}**.`
    case 'KEY_DELETED':
      return `User **${data.username}** deleted API key: **${data.keyName}**.`
    case 'USER_SIGNUP':
      return `A new user just joined OpenSteam! Welcome **${data.username}**.`
    case 'LIMIT_REACHED':
      return `User **${data.username}** has hit their daily web generation limit (**${data.limit}**).`
    case 'ADMIN_ACTION':
      return `Administrator action performed: **${data.action}**.`
    case 'GAME_REQUEST':
      return `User **${data.username}** requested a new game/manifest.`
    case 'REQUEST_APPROVED':
      return `The request for **${data.gameName}** from **${data.username}** has been marked as **DONE/FULFILLED**.`
    case 'REQUEST_DENIED':
      return `The request for **${data.gameName}** from **${data.username}** has been **REJECTED**.`
    case 'PLAN_UPDATED':
      return `User **${data.username}**'s account has been modified by an administrator.`
    case 'ABUSE_ALERT':
      return `Security alert for **${data.ip || 'unknown IP'}**${data.country && data.country !== 'XX' ? ` (${data.country})` : ''}${data.rayId && data.rayId !== '—' ? ` · Ray \`${data.rayId}\`` : ''}`
    case 'GAME_GENERATED':
      return `Member **${data.username}** generated a manifest for **${data.gameName}** (${data.appId}).`
    case 'IP_BANNED':
      return `Administrator **${data.username}** permanently blacklisted IP: **${data.ip}**.`
    case 'IP_UNBANNED':
      return `Administrator **${data.username}** removed permanent blacklist for IP: **${data.ip}**.`
    case 'WORKER_START':
      return `Extraction worker started for **${data.gameName}** (${data.appId}).`
    case 'WORKER_RESULT':
      return `Extraction worker finished for **${data.gameName}**. Result: ${data.status}.`
    case 'GAME_ADDED':
      return `**Game:** ${data.gameName || 'Unknown Game'}\n**AppID:** ${data.appId}`
    case 'GAME_UPDATED':
      return `**Game:** ${data.gameName || 'Unknown Game'}\n**AppID:** ${data.appId}\nManifest has been re-uploaded with a fresh version.`
    case 'NSFW_GENERATED':
      return `User **${data.username}** generated an NSFW game: **${data.gameName}** (${data.appId}).`
    case 'ONLINEFIX_DOWNLOAD':
      return `Member **${data.username}** downloaded the OnlineFix for **${data.gameName}**.`
    default:
      return 'Generic notification'
  }
}

function getFields(event: WebhookEvent, data: any) {
  const fields: { name: string; value: string; inline?: boolean }[] = []

  if (event === 'ABUSE_ALERT' || event === 'IP_BANNED') {
    appendSecurityFields(fields, data)
    if (data.userId) fields.push({ name: 'User ID', value: data.userId, inline: true })
    if (data.username) fields.push({ name: 'Username', value: data.username, inline: true })
    if (data.keyName) fields.push({ name: 'API Key', value: data.keyName, inline: true })
    if (data.reason) fields.push({ name: 'Reason', value: data.reason, inline: false })
    return fields
  }

  if (data.ip) fields.push({ name: 'IP Address', value: data.ip, inline: true })
  if (data.userId) fields.push({ name: 'User ID', value: data.userId, inline: true })
  if (data.username) fields.push({ name: 'Username', value: data.username, inline: true })
  if (data.gameName) fields.push({ name: 'Game/Name', value: data.gameName, inline: true })
  if (data.appId) fields.push({ name: 'App ID', value: data.appId, inline: true })
  if (data.keyName) fields.push({ name: 'API Key', value: data.keyName, inline: true })
  if (data.plan) fields.push({ name: 'User Plan', value: data.plan, inline: true })
  if (data.newPlan) fields.push({ name: 'New Plan', value: `\`${data.newPlan}\``, inline: true })
  if (data.newRole) fields.push({ name: 'New Role', value: `\`${data.newRole}\``, inline: true })
  if (data.userAgent) fields.push({ name: 'User Agent', value: `\`${truncateField(data.userAgent)}\`` })
  if (data.reason) fields.push({ name: 'Reason/Details', value: data.reason })
  if (data.details) fields.push({ name: 'Details', value: data.details })
  return fields
}

function truncateField(value: string, max = 900): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function appendSecurityFields(
  fields: { name: string; value: string; inline?: boolean }[],
  data: Record<string, unknown>
) {
  const add = (name: string, key: string, inline = true, required = false) => {
    const value = data[key]
    if (typeof value !== 'string' || !value.trim()) return
    if (!required && value === '—') return
    fields.push({ name, value: truncateField(value, inline ? 256 : 900), inline })
  }

  add('Your IP', 'ip', true, true)
  add('Ray ID', 'rayId', true, true)
  add('Country', 'country', true, true)
  add('City', 'city')
  add('Region', 'region')
  add('Timezone', 'timezone')
  add('Continent', 'continent')
  add('CF Connecting IP', 'cfConnectingIp')
  add('True Client IP', 'trueClientIp')
  add('X-Forwarded-For', 'forwardedFor', false)
  add('Cloudflare', 'behindCloudflare')
  add('Host', 'host')
  add('Path', 'path')
  add('Referer', 'referer', false)
  add('User Agent', 'userAgent', false)

  if (typeof data.details === 'string' && data.details.trim()) {
    fields.push({ name: 'Details', value: truncateField(data.details), inline: false })
  }
}
