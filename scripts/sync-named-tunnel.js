require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const envPath = path.join(ROOT, '.env')
const DATA = path.join(process.env.USERPROFILE || '', 'Desktop', 'opensteam-web-data')
const URL_FILE = path.join(DATA, 'public-url.txt')

const publicUrl = (
  process.argv[2]?.trim() ||
  process.env.NAMED_PUBLIC_URL?.trim() ||
  process.env.NEXTAUTH_URL?.trim() ||
  'https://opensteam.lol'
).replace(/\/$/, '')

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

fs.mkdirSync(DATA, { recursive: true })
fs.writeFileSync(URL_FILE, publicUrl, 'utf8')

setEnvKey('PUBLIC_TUNNEL_URL', publicUrl)
setEnvKey('NEXTAUTH_URL', publicUrl)
setEnvKey('NEXT_PUBLIC_APP_URL', publicUrl)
setEnvKey('AUTH_TRUST_HOST', 'true')
setEnvKey('TRUSTED_PROXY', 'cloudflare')

try {
  const { writeSiteSettings } = require('./lib/site-settings')
  writeSiteSettings({
    siteUrl: publicUrl,
    loginUrl: publicUrl,
    publicAccessUrl: publicUrl,
  })
} catch (_) {}

console.log(`Named tunnel public URL: ${publicUrl}`)
console.log(`Saved to ${URL_FILE}`)

spawnSync(process.execPath, [path.join(__dirname, 'sync-discord-oauth-redirect.js'), publicUrl], {
  cwd: ROOT,
  stdio: 'inherit',
})

console.log('')
console.log('Restart: pm2 restart manifest-tunnel manifest-web manifest-bot --update-env')
