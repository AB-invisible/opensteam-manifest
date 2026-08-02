require('dotenv').config()
const fs = require('fs')
const path = require('path')

const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim()
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim()

const ICON_CANDIDATES = [
  path.join(__dirname, '..', 'public', 'opensteam.png'),
  path.join(process.env.USERPROFILE || '', 'Desktop', 'denuvo', 'src', 'public', 'opensteam.png'),
  path.join(process.env.USERPROFILE || '', 'gamegen-app', 'ManifestApp', 'Assets', 'OpenSteamAppLogo.png'),
]

function findIcon() {
  for (const p of ICON_CANDIDATES) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function main() {
  if (!CLIENT_ID || !BOT_TOKEN) {
    console.error('Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN in .env')
    process.exit(1)
  }

  const iconPath = findIcon()
  const patch = {
    name: 'OpenSteam',
    description: 'OpenSteam desktop app — Steam manifests and library tools.',
  }

  if (iconPath) {
    const b64 = fs.readFileSync(iconPath).toString('base64')
    patch.icon = `data:image/png;base64,${b64}`
    console.log('Using icon:', iconPath)
  } else {
    console.warn('No opensteam.png found — skipping icon upload.')
  }

  const res = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.message || `Discord PATCH ${res.status}`)
  }

  console.log(`Discord application updated: ${body.name} (${body.id})`)
  console.log('')
  console.log('Desktop app Rich Presence uses this same application ID:', CLIENT_ID)
  console.log('')
  console.log('If Discord member list still shows the old "GameGen"/"gen" label:')
  console.log('  1. Fully quit Discord (tray icon → Quit Discord)')
  console.log('  2. Restart OpenSteam App (or toggle Rich Presence off/on in Settings)')
  console.log('  3. Reopen Discord — name changes can take a few minutes to propagate')
  console.log('')
  console.log('Optional manual step in Developer Portal → Rich Presence → Art Assets:')
  console.log('  Upload your OpenSteam logo (512×512+) with asset key: opensteam')
  console.log('')
  console.log('Portal:', `https://discord.com/developers/applications/${CLIENT_ID}/rich-presence/assets`)
}

main().catch((err) => {
  console.error('[configure-opensteam-discord-app]', err.message)
  process.exit(1)
})
