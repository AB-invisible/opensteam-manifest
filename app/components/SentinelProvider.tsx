'use client'

import { useEffect, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { getBrowserFingerprint, getCanvasHash } from '@/app/lib/client-sentinel'

export function SentinelProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      // 1. Initial Heartbeat
      sendHeartbeat()

      // 2. Periodic Sentinel Check (every 60 seconds)
      intervalRef.current = setInterval(sendHeartbeat, 60000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [status])

  async function sendHeartbeat() {
    try {
      const fingerprint = getBrowserFingerprint()
      const canvasHash = getCanvasHash()

      const res = await fetch('/api/user/sentinel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Fingerprint': fingerprint || ''
        },
        body: JSON.stringify({ fingerprint, canvasHash })
      })

      if (res.status === 401) {
        const data = await res.json().catch(() => ({}))
        if (data.reason === 'inactivity') {
          signOut({ callbackUrl: '/?logout=inactivity' })
          return
        }
        if (data.reason === 'guild_left') {
          signOut({ callbackUrl: '/?logout=guild_left' })
          return
        }
        if (data.reason === 'guild_banned') {
          signOut({ callbackUrl: '/?logout=guild_banned' })
          return
        }
        if (data.reason === 'oauth_expired') {
          signOut({ callbackUrl: '/?logout=oauth_expired' })
          return
        }
      }

      if (res.status === 403) {
        const data = await res.json()
        // Force sign out if Sentinel blocks the user
        signOut({ callbackUrl: `/?error=${encodeURIComponent(data.reason || 'Security Violation')}` })
      }
    } catch (e) {
      console.error('Sentinel Heartbeat Error:', e)
    }
  }

  return <>{children}</>
}
