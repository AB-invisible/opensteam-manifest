require('dotenv').config()
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA = path.join(process.env.USERPROFILE || '', 'Desktop', 'opensteam-web-data')
const URL_FILE = path.join(DATA, 'public-url.txt')
const TARGET = process.env.TUNNEL_TARGET?.trim() || 'http://127.0.0.1:3000'
const TUNNEL_TOKEN = process.env.TUNNEL_TOKEN?.trim()
const TUNNEL_PROVIDER = (process.env.TUNNEL_PROVIDER || 'localtunnel').trim().toLowerCase()
const TUNNEL_SUBDOMAINS = (process.env.TUNNEL_SUBDOMAIN || 'osteam')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const NAMED_PUBLIC_URL = (
  process.env.NAMED_PUBLIC_URL?.trim() ||
  process.env.NEXTAUTH_URL?.trim() ||
  'https://opensteam.lol'
).replace(/\/$/, '')

function targetPort() {
  try {
    return new URL(TARGET).port || '3000'
  } catch {
    return '3000'
  }
}

function localTunnelUrl(subdomain) {
  return `https://${subdomain}.loca.lt`
}

function urlMatchesSubdomain(url, subdomain) {
  try {
    return new URL(url).hostname.toLowerCase() === `${subdomain}.loca.lt`
  } catch {
    return url.includes(`${subdomain}.loca.lt`)
  }
}

function findCloudflared() {
  const candidates = [
    'cloudflared',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  ]
  for (const bin of candidates) {
    if (bin === 'cloudflared' || fs.existsSync(bin)) return bin
  }
  throw new Error('cloudflared not installed. Run: winget install Cloudflare.cloudflared')
}

const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/gi

function extractTunnelUrl(text) {
  const matches = [...text.matchAll(TUNNEL_URL_RE)]
  if (!matches.length) return null
  return matches[matches.length - 1][0].replace(/\/$/, '')
}

function syncPublicUrl(url, { named = false } = {}) {
  if (!url || url.includes('api.trycloudflare.com')) {
    console.warn('[manifest-tunnel] Ignoring invalid tunnel URL:', url)
    return
  }

  fs.mkdirSync(DATA, { recursive: true })
  const prev = fs.existsSync(URL_FILE) ? fs.readFileSync(URL_FILE, 'utf8').trim() : ''
  fs.writeFileSync(URL_FILE, url, 'utf8')
  console.log('[manifest-tunnel] Public URL saved to', URL_FILE)
  console.log('[manifest-tunnel] Share:', url)

  if (prev === url && !named) return

  try {
    const { spawnSync } = require('child_process')
    const script = named ? 'sync-named-tunnel.js' : 'sync-tunnel-url.js'
    const result = spawnSync(process.execPath, [path.join(__dirname, script), url], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    if (result.status === 0) {
      spawnSync('pm2', ['restart', 'manifest-web', 'manifest-bot', '--update-env'], {
        cwd: ROOT,
        stdio: 'inherit',
      })
    }
  } catch (err) {
    console.warn('[manifest-tunnel] Could not auto-sync tunnel:', err.message)
    console.log(`[manifest-tunnel] Run: node scripts/${named ? 'sync-named-tunnel' : 'sync-tunnel-url'}.js "${url}"`)
  }
}

function attachRestart(proc, startFn, label) {
  proc.on('exit', (code) => {
    console.error(`[manifest-tunnel] ${label} exited (${code}), restarting in 5s...`)
    setTimeout(startFn, 5000)
  })
}

function startLocalTunnel() {
  const port = Number(targetPort()) || 3000
  console.log(`[manifest-tunnel] Localtunnel -> ${TARGET} (trying: ${TUNNEL_SUBDOMAINS.join(', ')})`)

  let activeTunnel = null
  let starting = false

  async function connect() {
    if (starting) return
    starting = true
    const localtunnel = require('localtunnel')

    for (const subdomain of TUNNEL_SUBDOMAINS) {
      try {
        const tunnel = await localtunnel({ port, subdomain })
        const url = tunnel.url.replace(/\/$/, '')
        if (!urlMatchesSubdomain(url, subdomain)) {
          await tunnel.close()
          continue
        }
        activeTunnel = tunnel
        console.log(`[manifest-tunnel] Public URL: ${url}`)
        syncPublicUrl(url)
        tunnel.on('error', (err) => {
          console.error('[manifest-tunnel] localtunnel error:', err.message)
        })
        tunnel.on('close', () => {
          activeTunnel = null
          console.error('[manifest-tunnel] localtunnel closed, reconnecting in 5s...')
          setTimeout(connect, 5000)
        })
        starting = false
        return
      } catch (err) {
        console.warn(`[manifest-tunnel] ${subdomain}.loca.lt unavailable:`, err.message)
      }
    }

    starting = false
    console.error('[manifest-tunnel] No subdomain available, retry in 30s...')
    setTimeout(connect, 30000)
  }

  connect().catch((err) => {
    starting = false
    console.error('[manifest-tunnel] localtunnel failed:', err.message)
    setTimeout(startLocalTunnel, 10000)
  })
}

function startQuickTunnel() {
  const bin = findCloudflared()
  console.log(`[manifest-tunnel] Cloudflare quick tunnel ${bin} -> ${TARGET}`)

  const proc = spawn(bin, ['tunnel', '--url', TARGET, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let synced = false
  const onData = (chunk) => {
    const text = chunk.toString()
    process.stderr.write(text)
    if (synced) return
    const match = extractTunnelUrl(text)
    if (match) {
      synced = true
      syncPublicUrl(match)
    }
  }

  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  attachRestart(proc, startQuickTunnel, 'cloudflared quick tunnel')
}

function startNamedTunnel() {
  const bin = findCloudflared()
  console.log(`[manifest-tunnel] Named tunnel ${bin} -> ${TARGET}`)
  console.log(`[manifest-tunnel] Public hostname: ${NAMED_PUBLIC_URL}`)
  syncPublicUrl(NAMED_PUBLIC_URL, { named: true })

  const proc = spawn(bin, ['tunnel', '--no-autoupdate', 'run', '--token', TUNNEL_TOKEN], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', (chunk) => process.stdout.write(chunk.toString()))
  proc.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()))
  attachRestart(proc, startNamedTunnel, 'cloudflared named tunnel')
}

function start() {
  if (TUNNEL_TOKEN) {
    startNamedTunnel()
    return
  }
  if (TUNNEL_PROVIDER === 'cloudflare') {
    startQuickTunnel()
    return
  }
  startLocalTunnel()
}

start()
