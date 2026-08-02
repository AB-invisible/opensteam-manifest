/** @type {import('next').NextConfig} */


function serverActionAllowedHosts() {
  const hosts = new Set([
    'localhost:3000',
    '127.0.0.1:3000',
    'opensteam.lol',
    'www.opensteam.lol',
    'gamegen.lol',
    'www.gamegen.lol',
  ])

  const addHost = (value) => {
    if (!value || value === '*') return
    const trimmed = String(value).trim()
    if (!trimmed) return
    try {
      const url = /^https?:\/\//i.test(trimmed)
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`)
      hosts.add(url.host)
    } catch {
      const hostOnly = trimmed.replace(/^https?:\/\//i, '').split('/')[0].trim()
      if (hostOnly) hosts.add(hostOnly)
    }
  }

  const originsEnv = process.env.ALLOWED_ORIGINS?.trim()
  if (originsEnv && originsEnv !== '*') {
    originsEnv.split(',').forEach((part) => addHost(part.trim()))
  }

  addHost(process.env.NEXT_PUBLIC_APP_URL)

  const extra = process.env.SERVER_ACTION_ALLOWED_ORIGINS?.trim()
  if (extra && extra !== '*') {
    extra.split(',').forEach((part) => addHost(part.trim()))
  }

  return [...hosts]
}

const nextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 5184000, // 60 days cache for remote assets
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.cloudflare.steamstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'steamcdn-a.akamaihd.net',
        pathname: '/**',
      },

      
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'media.discordapp.net',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    instrumentationHook: true,
    serverActions: {
      bodySizeLimit: '5gb',
      allowedOrigins: serverActionAllowedHosts(),
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    // Do NOT infer HTTPS from NEXT_PUBLIC_APP_URL — tunnel URLs are https while
    // local users browse http://opensteam.lol. upgrade-insecure-requests breaks
    // all static assets when there is no TLS on the host.
    const strictHttps = process.env.ENABLE_HTTPS_SECURITY_HEADERS === 'true'
    const cspBase =
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://secure.pandabase.io https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self' data: https:; connect-src 'self' https: wss: http:; object-src 'none'; frame-ancestors 'none'; frame-src 'self' https://checkout.pandabase.io https://secure.pandabase.io;"
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value: strictHttps ? `${cspBase} upgrade-insecure-requests;` : cspBase,
      },
    ]
    if (strictHttps) {
      securityHeaders.unshift({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      })
    }
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig