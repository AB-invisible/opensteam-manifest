const fs = require('fs')
const path = require('path')

const URL_FILE = path.join(process.env.USERPROFILE || '', 'Desktop', 'opensteam-web-data', 'public-url.txt')

function readPublicTunnelUrl() {
  const nextAuth = process.env.NEXTAUTH_URL?.trim()
  if (nextAuth && !/localhost|127\.0\.0\.1|trycloudflare\.com/i.test(nextAuth)) {
    return nextAuth.replace(/\/$/, '')
  }

  const fromEnv = process.env.PUBLIC_TUNNEL_URL?.trim()
  if (fromEnv && !fromEnv.includes('trycloudflare.com')) return fromEnv.replace(/\/$/, '')

  try {
    if (fs.existsSync(URL_FILE)) {
      const fromFile = fs.readFileSync(URL_FILE, 'utf8').trim()
      if (fromFile && !fromFile.includes('trycloudflare.com')) return fromFile.replace(/\/$/, '')
    }
  } catch {
    // ignore
  }

  return null
}

function isTunnelHost(host) {
  if (!host) return false
  const h = host.split(':')[0].trim().toLowerCase()
  if (h.endsWith('.loca.lt')) return true
  return h.endsWith('.trycloudflare.com')
}

function isLocalOpenSteamHost(host) {
  if (!host) return false
  const h = host.split(':')[0].trim().toLowerCase()
  return h === 'opensteam.lol' || h === 'www.opensteam.lol'
}

module.exports = {
  URL_FILE,
  readPublicTunnelUrl,
  isTunnelHost,
  isLocalOpenSteamHost,
}
