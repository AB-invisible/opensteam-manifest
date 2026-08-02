import { describe, it, expect } from 'vitest'
import {
  shouldUpdateDiscordUsername,
  buildProfileSyncData,
} from '@/app/lib/discord-profile-sync'

describe('shouldUpdateDiscordUsername', () => {
  it('returns false when username is unchanged', () => {
    expect(shouldUpdateDiscordUsername('alice', 'alice')).toBe(false)
  })

  it('returns true when username changed', () => {
    expect(shouldUpdateDiscordUsername('alice', 'bob')).toBe(true)
  })

  it('returns false for empty or missing incoming username', () => {
    expect(shouldUpdateDiscordUsername('alice', '')).toBe(false)
    expect(shouldUpdateDiscordUsername('alice', null)).toBe(false)
    expect(shouldUpdateDiscordUsername('alice', undefined)).toBe(false)
    expect(shouldUpdateDiscordUsername('alice', '   ')).toBe(false)
  })

  it('trims incoming username before comparing', () => {
    expect(shouldUpdateDiscordUsername('alice', ' bob ')).toBe(true)
    expect(shouldUpdateDiscordUsername('alice', ' alice ')).toBe(false)
  })
})

describe('buildProfileSyncData', () => {
  const discordId = '123456789012345678'
  const current = {
    username: 'oldhandle',
    avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
  }

  it('detects username-only changes without requiring avatar change', () => {
    const result = buildProfileSyncData(current, { username: 'newhandle', avatar: null }, discordId)

    expect(result.changed).toBe(true)
    expect(result.usernameChanged).toBe(true)
    expect(result.avatarChanged).toBe(false)
    expect(result.data.username).toBe('newhandle')
    expect(result.data.avatar).toBeUndefined()
  })

  it('detects avatar-only changes', () => {
    const avatarHash = 'a_abc123'
    const result = buildProfileSyncData(
      current,
      { username: 'oldhandle', avatar: avatarHash, id: discordId },
      discordId
    )

    expect(result.changed).toBe(true)
    expect(result.usernameChanged).toBe(false)
    expect(result.avatarChanged).toBe(true)
    expect(result.data.username).toBeUndefined()
    expect(result.data.avatar).toContain(avatarHash)
  })

  it('returns no changes when profile matches stored values', () => {
    const result = buildProfileSyncData(
      {
        username: 'samehandle',
        avatar: `https://cdn.discordapp.com/avatars/${discordId}/abc123.webp?size=128`,
      },
      { username: 'samehandle', avatar: 'abc123', id: discordId },
      discordId
    )

    expect(result.changed).toBe(false)
    expect(result.usernameChanged).toBe(false)
    expect(result.avatarChanged).toBe(false)
    expect(Object.keys(result.data)).toHaveLength(0)
  })

  it('detects when both username and avatar changed', () => {
    const result = buildProfileSyncData(
      current,
      { username: 'newhandle', avatar: 'def456', id: discordId },
      discordId
    )

    expect(result.changed).toBe(true)
    expect(result.usernameChanged).toBe(true)
    expect(result.avatarChanged).toBe(true)
    expect(result.data.username).toBe('newhandle')
    expect(result.data.avatar).toContain('def456')
  })
})
