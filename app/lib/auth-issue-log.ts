import { sendBotAlert } from './bot-admin'

export type AuthIssueContext = {
  stage: string
  error: string
  discordId?: string | null
  callbackUrl?: string | null
  flow?: 'verify' | 'login' | 'oauth_cookie' | 'unknown'
  ip?: string | null
  details?: Record<string, unknown>
}

const OAUTH_NEXTAUTH_CODES = new Set([
  'SIGNIN_OAUTH_ERROR',
  'OAUTH_CALLBACK_ERROR',
  'OAUTH_CALLBACK_HANDLER_ERROR',
  'OAUTH_V1_GET_ACCESS_TOKEN_ERROR',
  'AUTH_ON_ERROR_PAGE_ERROR',
])

function formatAuthIssueMessage(ctx: AuthIssueContext): string {
  const lines = [
    `**Discord sign-in issue**`,
    `**Stage:** ${ctx.stage}`,
    `**Error:** ${ctx.error}`,
  ]
  if (ctx.flow) lines.push(`**Flow:** ${ctx.flow}`)
  if (ctx.discordId) lines.push(`**Discord ID:** \`${ctx.discordId}\``)
  if (ctx.callbackUrl) lines.push(`**Callback:** ${ctx.callbackUrl}`)
  if (ctx.ip) lines.push(`**IP:** ${ctx.ip}`)
  if (ctx.details && Object.keys(ctx.details).length > 0) {
    const raw = JSON.stringify(ctx.details)
    lines.push(`**Details:** \`${raw.length > 600 ? `${raw.slice(0, 600)}…` : raw}\``)
  }
  return lines.join('\n')
}

/** Post auth/OAuth failures to DISCORD_ALERTS_CHANNEL_ID (fire-and-forget). */
export function logAuthIssue(ctx: AuthIssueContext): void {
  const isSecurity =
    ctx.stage.includes('mismatch') ||
    ctx.stage.includes('banned') ||
    ctx.error.toLowerCase().includes('mismatch')

  void sendBotAlert(formatAuthIssueMessage(ctx), isSecurity ? 'SECURITY' : 'SYSTEM').catch(
    (err) => console.error('[Auth issue log] Failed to send bot alert:', err)
  )
}

export function logNextAuthError(code: string, metadata: unknown): void {
  if (!OAUTH_NEXTAUTH_CODES.has(code)) return

  const meta =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : { message: String(metadata ?? '') }

  const nestedError = meta.error
  const errorMessage =
    nestedError instanceof Error
      ? nestedError.message
      : typeof nestedError === 'string'
        ? nestedError
        : String(code)

  const lower = errorMessage.toLowerCase()
  const flow =
    lower.includes('state cookie') ||
    lower.includes('state mismatch') ||
    lower.includes('pkce')
      ? 'oauth_cookie'
      : 'unknown'

  logAuthIssue({
    stage: `nextauth:${code}`,
    error: errorMessage,
    flow,
    details: {
      providerId: meta.providerId,
      error_description: meta.error_description,
      hint:
        flow === 'oauth_cookie'
          ? lower.includes('state mismatch')
            ? 'OAuth state mismatch — overlapping sign-in flows or stale Discord tab; ensure backup OAuth redirect URI is registered'
            : 'OAuth state/PKCE cookie missing on callback — check NEXT_PUBLIC_APP_URL host matches browser URL and cookies are allowed'
          : undefined,
    },
  })
}
