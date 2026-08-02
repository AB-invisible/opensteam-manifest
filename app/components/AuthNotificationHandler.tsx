'use client'

import { useEffect, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useToast } from './Toast'
import { markNeedsReverify } from './ReVerifyBanner'

const INACTIVITY_LOGOUT_URL = '/?logout=inactivity'
const GUILD_LEFT_LOGOUT_URL = '/?logout=guild_left'
const GUILD_BANNED_LOGOUT_URL = '/?logout=guild_banned'
const OAUTH_EXPIRED_LOGOUT_URL = '/?logout=oauth_expired'

function showInactivityToast(warning: (title: string, message?: string) => void) {
  warning('You were logged out for Inactivity')
}

function showGuildLeftToast(warning: (title: string, message?: string) => void) {
  warning(
    'You left the OpenSteam Discord server',
    'Your web session was ended. Rejoin the server and verify again to continue.'
  )
}

function showOAuthExpiredToast(warning: (title: string, message?: string) => void) {
  warning(
    'Discord sign-in expired',
    'Your Discord authorization expired. Sign in again to refresh your session and guild access.',
  )
}

function showGuildBannedToast(warning: (title: string, message?: string) => void) {
  warning(
    'You were banned from the OpenSteam Discord server',
    'Your session was ended. You can sign in again, but generation, API keys, and requests stay disabled until the ban is lifted.'
  )
}

function cleanLogoutQueryParam() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('logout')) return
  url.searchParams.delete('logout')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next || '/')
}

export function AuthNotificationHandler({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const { warning } = useToast()
  const handledLogoutToastRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const logoutReason = params.get('logout')
    if (logoutReason !== 'inactivity' && logoutReason !== 'guild_left' && logoutReason !== 'guild_banned' && logoutReason !== 'oauth_expired') return
    if (handledLogoutToastRef.current) return
    handledLogoutToastRef.current = true
    if (logoutReason === 'guild_left') {
      markNeedsReverify()
      showGuildLeftToast(warning)
    } else if (logoutReason === 'guild_banned') {
      showGuildBannedToast(warning)
    } else if (logoutReason === 'oauth_expired') {
      showOAuthExpiredToast(warning)
    } else {
      showInactivityToast(warning)
    }
    cleanLogoutQueryParam()
  }, [warning])

  useEffect(() => {
    if (status !== 'authenticated') return
    if (session?.user?.guildBannedExpired) {
      void signOut({ callbackUrl: GUILD_BANNED_LOGOUT_URL })
      return
    }
    if (session?.user?.guildLeftExpired) {
      void signOut({ callbackUrl: GUILD_LEFT_LOGOUT_URL })
      return
    }
    if (session?.user?.oauthExpired) {
      void signOut({ callbackUrl: OAUTH_EXPIRED_LOGOUT_URL })
      return
    }
    if (!session?.user?.inactivityExpired) return
    void signOut({ callbackUrl: INACTIVITY_LOGOUT_URL })
  }, [status, session])

  return <>{children}</>
}
