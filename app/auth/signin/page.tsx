'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  clearAutostartConsumed,
  clearOAuthInflight,
  markAutostartConsumed,
  tryBeginOAuth,
} from '@/app/lib/oauth-client-guard'
import { OpenSteamAuthBanner, OpenSteamAuthLogo } from '@/app/components/OpenSteamAuthCardHeader'

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function errorMessage(code: string | null): string {
  switch (code) {
    case 'discord':
      return 'Discord sign-in did not complete. You may have cancelled the prompt, or the connection failed. Please try again.'
    case 'OAuthSignin':
      return 'Discord OAuth failed during sign-in. Please try again in a moment.'
    case 'OAuthCallback':
      return 'Discord sign-in could not be completed (session expired or cookies blocked). Please try again.'
    case 'invalid_scope':
      return 'Discord rejected the requested permissions. Please try again — if this persists, contact support.'
    case 'AccessDenied':
      return 'Access was denied. You must authorize OpenSteam to continue.'
    default:
      return code
        ? 'Sign-in failed. Please try again.'
        : 'Sign in with Discord to continue to OpenSteam.'
  }
}

function extractVerifySession(callbackUrl: string | null): string | null {
  if (!callbackUrl) return null

  try {
    const url = new URL(callbackUrl, 'http://127.0.0.1:3000')
    if (url.pathname.startsWith('/verify')) {
      const s = url.searchParams.get('s')
      if (s) return s
    }
  } catch {
    // fall through to regex
  }

  const match = callbackUrl.match(/[?&]s=([^&]+)/)
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }

  return null
}

function toRelativeCallbackUrl(raw: string | null): string {
  if (!raw) return '/'
  try {
    const url = new URL(raw, 'http://127.0.0.1:3000')
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

function buildVerifyOAuthHref(verifySession: string | null): string | null {
  if (!verifySession) return null
  return `/api/verify/oauth/start?s=${encodeURIComponent(verifySession)}`
}

function SignInContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const callbackUrl = searchParams.get('callbackUrl')
  const autostart = searchParams.get('autostart') === '1'
  const verifySession = useMemo(() => extractVerifySession(callbackUrl), [callbackUrl])
  const isVerifyFlow = Boolean(verifySession)
  const verifyOAuthHref = useMemo(() => buildVerifyOAuthHref(verifySession), [verifySession])
  const [signingIn, setSigningIn] = useState(autostart && !error)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!error) return
    clearOAuthInflight()
    clearAutostartConsumed()
    setSigningIn(false)
  }, [error])

  const startDiscordSignIn = (relativeCallback: string) => {
    if (!tryBeginOAuth()) {
      setBlocked(true)
      return
    }
    setBlocked(false)
    setSigningIn(true)
    void signIn('discord', { callbackUrl: relativeCallback })
  }

  const handleDiscordSignIn = () => {
    if (verifyOAuthHref) {
      window.location.href = verifyOAuthHref
      return
    }
    startDiscordSignIn(toRelativeCallbackUrl(callbackUrl))
  }

  useEffect(() => {
    if (!autostart || error) return
    if (!markAutostartConsumed()) return
    startDiscordSignIn(toRelativeCallbackUrl(callbackUrl))
  }, [autostart, error, callbackUrl])

  return (
    <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        <div className="glass border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
          <OpenSteamAuthBanner />

          <div className="p-8 space-y-6 text-center">
            <OpenSteamAuthLogo />

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {isVerifyFlow ? 'Connect Discord' : 'Sign in to OpenSteam'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isVerifyFlow
                  ? 'Authorize Discord to continue verification.'
                  : 'Use your Discord account to access the dashboard.'}
              </p>
            </div>

            {error && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-left">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-100">{errorMessage(error)}</p>
              </div>
            )}

            {blocked && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-left">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-100">
                  Sign-in is already in progress. Finish the Discord prompt in your other tab, or wait a moment and try again.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleDiscordSignIn}
              disabled={signingIn}
              className="w-full group relative flex items-center justify-center gap-2 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-70 disabled:cursor-wait text-white font-bold text-sm shadow-lg shadow-[#5865F2]/20 transition-all overflow-hidden"
            >
              <div className="pointer-events-none absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-500" />
              {signingIn ? (
                <Loader2 className="relative z-10 h-5 w-5 animate-spin" />
              ) : (
                <DiscordIcon className="relative z-10 h-5 w-5" />
              )}
              <span className="relative z-10">
                {signingIn ? 'Redirecting to Discord…' : error ? 'Try Discord again' : 'Continue with Discord'}
              </span>
            </button>

            {isVerifyFlow && verifySession && (
              <a
                href={`/verify?s=${encodeURIComponent(verifySession)}`}
                className="inline-block text-xs text-muted-foreground hover:text-white transition-colors"
              >
                Back to verification
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  )
}
