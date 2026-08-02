const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const ROOT = path.join(__dirname, '..')
const CERT_DIR = path.join(ROOT, 'certs')
const KEY_PATH = path.join(CERT_DIR, 'opensteam.lol-key.pem')
const CERT_PATH = path.join(CERT_DIR, 'opensteam.lol.pem')
const TARGET = process.env.HTTPS_PROXY_TARGET || 'http://127.0.0.1:3000'
const LISTEN_PORT = Number(process.env.HTTPS_PROXY_PORT || 3443)

if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
  console.error('[https-proxy] Missing TLS certs. Run: powershell -ExecutionPolicy Bypass -File scripts/setup-local-https.ps1')
  process.exit(1)
}

const target = new URL(TARGET)

function proxy(req, res) {
  const originalHost = req.headers.host || 'opensteam.lol'
  const headers = {
    ...req.headers,
    host: target.host,
    'x-forwarded-host': originalHost,
    'x-forwarded-proto': 'https',
    'x-forwarded-for':
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      '127.0.0.1',
  }
  const options = {
    hostname: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: req.method,
    headers,
  }

  const upstream = (target.protocol === 'https:' ? https : http).request(options, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)
    upRes.pipe(res)
  })

  upstream.on('error', (err) => {
    console.error('[https-proxy] upstream error:', err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
    }
    res.end('Bad gateway — is manifest-web running on port 3000?')
  })

  req.pipe(upstream)
}

https
  .createServer(
    {
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
    },
    proxy
  )
  .listen(LISTEN_PORT, '127.0.0.1', () => {
    console.log(`[https-proxy] https://opensteam.lol:${LISTEN_PORT === 443 ? '' : LISTEN_PORT} -> ${TARGET}`)
  })
