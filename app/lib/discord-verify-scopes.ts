/**
 * Discord OAuth2 scopes for the verification flow.
 * @see https://discord.com/developers/docs/topics/oauth2#shared-resources-oauth2-scopes
 *
 * Only include scopes valid for a standard OAuth2 web application.
 * Game/RPC scopes (applications.*, messages.read, gdm.join, etc.) cause invalid_scope errors.
 */

/** Scopes used during Discord server verification (no partner approval required). */
export const VERIFY_OAUTH_STANDARD_SCOPES = [
  'identify',
  'email',
  'guilds',
  'guilds.join',
  'guilds.members.read',
  'connections',
] as const

/**
 * Partner / restricted scopes (Social SDK, premium intel, DMs).
 * Discord omits these unless the app is approved — opt in via DISCORD_VERIFY_INCLUDE_PARTNER_SCOPES=true.
 */
export const VERIFY_OAUTH_PARTNER_SCOPES = [
  'relationships.read',
  'identify.premium',
  'dm_channels.read',
] as const

export type VerifyOAuthScope =
  | (typeof VERIFY_OAUTH_STANDARD_SCOPES)[number]
  | (typeof VERIFY_OAUTH_PARTNER_SCOPES)[number]

/** Verification scope set. Override with DISCORD_VERIFY_OAUTH_SCOPES env. */
export function getVerifyOAuthScopes(): string {
  const override = process.env.DISCORD_VERIFY_OAUTH_SCOPES?.trim()
  if (override) return override

  const includePartner = process.env.DISCORD_VERIFY_INCLUDE_PARTNER_SCOPES === 'true'
  const scopes: string[] = [...VERIFY_OAUTH_STANDARD_SCOPES]
  if (includePartner) scopes.push(...VERIFY_OAUTH_PARTNER_SCOPES)
  return [...new Set(scopes)].join(' ')
}

export const VERIFY_OAUTH_SCOPES = getVerifyOAuthScopes()
