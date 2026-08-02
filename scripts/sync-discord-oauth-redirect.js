require('dotenv').config()
const { readPublicTunnelUrl } = require('./lib/public-tunnel-url')

const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim()
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim()

const LOCAL_REDIRECTS = [
  'http://opensteam.lol/api/auth/callback/discord',
  'https://opensteam.lol/api/auth/callback/discord',
  'http://127.0.0.1:3000/api/auth/callback/discord',
  'http://localhost:3000/api/auth/callback/discord',
]

async function fetchApplication() {
  const res = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.message || `Discord API ${res.status}`)
  }
  return body
}

async function main() {
  if (!CLIENT_ID || !BOT_TOKEN) {
    console.error('Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN')
    process.exit(1)
  }

  const tunnelUrl = process.argv[2]?.trim() || readPublicTunnelUrl()
  const required = [...LOCAL_REDIRECTS]
  if (tunnelUrl) {
    required.push(`${tunnelUrl.replace(/\/$/, '')}/api/auth/callback/discord`)
  }

  const app = await fetchApplication()
  const existing = Array.isArray(app.redirect_uris) ? app.redirect_uris : []
  const merged = [...new Set([...existing, ...required])]

  const patch = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ redirect_uris: merged }),
  })
  const patchBody = await patch.json().catch(() => ({}))
  if (!patch.ok) {
    throw new Error(patchBody.message || `Discord PATCH ${patch.status}`)
  }

  const after = await fetchApplication()
  const saved = Array.isArray(after.redirect_uris) ? after.redirect_uris : []
  const missing = required.filter((uri) => !saved.includes(uri))

  console.log(`Discord OAuth redirects saved (${saved.length} total)`)
  if (tunnelUrl) {
    console.log(`Public tunnel callback: ${tunnelUrl}/api/auth/callback/discord`)
  }

  if (missing.length > 0) {
    console.warn('')
    console.warn('Discord did not save these redirect URIs automatically (bot token cannot edit OAuth redirects).')
    console.warn('Add them manually in Discord Developer Portal -> OAuth2 -> Redirects:')
    for (const uri of missing) console.warn(`  ${uri}`)
    console.warn('')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[sync-discord-oauth-redirect]', err.message)
  process.exit(1)
})
