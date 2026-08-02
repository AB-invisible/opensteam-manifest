import { headers } from 'next/headers'
import { prisma } from '@/app/lib/prisma'
import { getSecurityContextFromHeaders, securityContextToLogPayload } from '@/app/lib/ip'
import { AlertTriangle, ShieldX } from 'lucide-react'

export const metadata = {
  title: 'Access Denied - OpenSteam',
  description: 'VPN or Proxy detected.',
}

const DISCORD_INVITE = 'https://discord.gg/T3sDD7WVNN'

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/10 last:border-b-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-mono text-gray-100 text-right break-all">{value}</span>
    </div>
  )
}

export default async function VPNBlockedPage() {
  const headersList = await headers()
  const security = getSecurityContextFromHeaders(headersList, { path: '/vpn-blocked' })
  const logPayload = securityContextToLogPayload(security)

  if (security.ip !== 'unknown') {
    try {
      const recentLog = await prisma.sentinelLog.findFirst({
        where: {
          ip: security.ip,
          action: 'VPN_BLOCKED',
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000),
          },
        },
      })

      if (!recentLog) {
        await prisma.sentinelLog.create({
          data: {
            ip: security.ip,
            userAgent: security.userAgent || 'unknown',
            action: 'VPN_BLOCKED',
            score: 10,
            reason: 'Access denied due to active VPN or Proxy detection.',
            details: JSON.stringify(logPayload),
          },
        })

        const { sendWebhook } = await import('@/app/lib/webhooks')
        await sendWebhook('ABUSE_ALERT', {
          ...logPayload,
          reason: 'VPN/Proxy Blocked',
          details: 'User hit the /vpn-blocked endpoint.',
        })
      }
    } catch (e) {
      console.error('Failed to log VPN block:', e)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#111111] border border-red-500/20 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-orange-500" />

        <div className="flex justify-center mb-6 relative">
          <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full" />
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20 relative z-10">
            <ShieldX className="w-10 h-10 text-red-500" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white text-center mb-4">
          Access Restricted
        </h1>

        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-200 text-sm">
              We have detected that you are using a VPN, Proxy, or Data Center IP address.
            </p>
          </div>

          <p className="text-gray-400 text-sm text-center">
            To prevent abuse and ensure fair access to OpenSteam&apos;s services, we require users to connect from standard residential IP addresses.
          </p>

          <div className="bg-[#1a1a1a] rounded-lg px-4 py-1 text-sm text-gray-400 border border-white/5">
            <DetailRow label="Ray ID" value={security.rayId} />
            <DetailRow label="Your IP" value={security.ip} />
            <DetailRow label="Country" value={security.country} />
          </div>

          <p className="text-gray-500 text-xs text-center">
            Please disable your VPN and refresh the page to continue.
          </p>

          <p className="text-gray-400 text-sm text-center">
            If you believe this is an error, please contact us on Discord:{' '}
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              discord.gg/T3sDD7WVNN
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
