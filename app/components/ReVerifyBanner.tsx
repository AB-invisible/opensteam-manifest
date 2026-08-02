'use client'

import { useEffect, useState } from 'react'
import { UserCheck, ExternalLink } from 'lucide-react'

const REVOKE_KEY = 'gamegen_needs_reverify'

export function markNeedsReverify() {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(REVOKE_KEY, '1')
  }
}

export function clearNeedsReverify() {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(REVOKE_KEY)
  }
}

/**
 * Shown on home/dashboard when the user left the Discord guild and must re-verify.
 */
export function ReVerifyBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('logout') === 'guild_left') {
      markNeedsReverify()
    }
    setVisible(sessionStorage.getItem(REVOKE_KEY) === '1')
  }, [])

  if (!visible) return null

  return (
    <div className="mx-auto max-w-3xl mb-6 glass border border-violet-500/30 bg-violet-500/10 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="flex items-start gap-3 flex-1">
        <UserCheck className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-white">Re-verification required</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            You left the OpenSteam Discord server. Rejoin the server, click <strong>Verify</strong> in the verify channel,
            then complete the web verification flow to restore dashboard and API access.
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <a
          href="https://discord.gg/yKyKhSNGKz"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white transition-colors"
        >
          Open Discord <ExternalLink className="h-3 w-3" />
        </a>
        <button
          type="button"
          onClick={() => {
            clearNeedsReverify()
            setVisible(false)
          }}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
