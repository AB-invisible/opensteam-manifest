require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { readPublicTunnelUrl, URL_FILE } = require('./lib/public-tunnel-url')

const ROOT = path.join(__dirname, '..')
const envPath = path.join(ROOT, '.env')

function setEnvKey(key, value) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  let found = false
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true
      return `${key}="${value}"`
    }
    return line
  })
  if (!found) out.push(`${key}="${value}"`)
  fs.writeFileSync(envPath, out.join('\n') + '\n', 'utf8')
}

const tunnelUrl = process.argv[2]?.trim() || readPublicTunnelUrl()
if (!tunnelUrl || tunnelUrl.includes('api.trycloudflare.com')) {
  console.error('No valid tunnel URL. Pass one or wait for manifest-tunnel to start.')
  process.exit(1)
}

if (process.env.TUNNEL_TOKEN?.trim() && tunnelUrl.includes('trycloudflare.com')) {
  console.error('Named tunnel mode: use sync-named-tunnel.js with https://opensteam.lol instead.')
  process.exit(1)
}

setEnvKey('PUBLIC_TUNNEL_URL', tunnelUrl.replace(/\/$/, ''))
setEnvKey('NEXTAUTH_URL', tunnelUrl.replace(/\/$/, ''))
setEnvKey('NEXT_PUBLIC_APP_URL', tunnelUrl.replace(/\/$/, ''))
setEnvKey('AUTH_TRUST_HOST', 'true')

try {
  const { writeSiteSettings } = require('./lib/site-settings')
  writeSiteSettings({
    siteUrl: tunnelUrl.replace(/\/$/, ''),
    loginUrl: tunnelUrl.replace(/\/$/, ''),
  })
} catch (_) {}

console.log(`Public site URL: ${tunnelUrl}`)
console.log('Local shortcut (this PC only): https://opensteam.lol')

const discord = spawnSync(process.execPath, [path.join(__dirname, 'sync-discord-oauth-redirect.js'), tunnelUrl], {
  cwd: ROOT,
  stdio: 'inherit',
})
if (discord.status !== 0) {
  console.warn('Discord redirect sync failed — add the tunnel callback manually in Developer Portal.')
}

console.log('')
console.log('Share this link with everyone else:')
console.log(`  ${tunnelUrl}`)
console.log('')
console.log('Restart: pm2 restart manifest-web manifest-bot --update-env')
