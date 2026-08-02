import { getDiscordVerifyConfig } from './discord-verify-config'

export async function swapMemberVerificationRoles(discordId: string, guildId?: string | null) {
  const config = await getDiscordVerifyConfig()
  const targetGuildId = guildId || config.guildId
  const botToken = config.botToken

  if (!targetGuildId || !botToken) {
    return { ok: false as const, error: 'Missing guild ID or bot token' }
  }

  const headers = {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  }

  const addRes = await fetch(
    `https://discord.com/api/v10/guilds/${targetGuildId}/members/${discordId}/roles/${config.verifiedRoleId}`,
    { method: 'PUT', headers }
  )

  if (!addRes.ok && addRes.status !== 204) {
    const body = await addRes.text().catch(() => '')
    return { ok: false as const, error: `Failed to add verified role: ${addRes.status} ${body}` }
  }

  const removeRes = await fetch(
    `https://discord.com/api/v10/guilds/${targetGuildId}/members/${discordId}/roles/${config.unverifiedRoleId}`,
    { method: 'DELETE', headers }
  )

  if (!removeRes.ok && removeRes.status !== 204) {
    const body = await removeRes.text().catch(() => '')
    return { ok: false as const, error: `Failed to remove unverified role: ${removeRes.status} ${body}` }
  }

  return { ok: true as const }
}

export async function addUnverifiedRole(discordId: string, guildId?: string | null) {
  const config = await getDiscordVerifyConfig()
  const targetGuildId = guildId || config.guildId
  const botToken = config.botToken

  if (!targetGuildId || !botToken || !config.enabled) {
    return { ok: false as const, error: 'Verification disabled or missing config' }
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${targetGuildId}/members/${discordId}/roles/${config.unverifiedRoleId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!res.ok && res.status !== 204) {
    return { ok: false as const, error: `Failed to add unverified role: ${res.status}` }
  }

  return { ok: true as const }
}
