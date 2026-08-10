'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react'
import { getBrowserFingerprint, getCanvasHash } from '@/app/lib/client-sentinel'
import { clearNeedsReverify } from '@/app/components/ReVerifyBanner'
import { OpenSteamAuthBanner, OpenSteamAuthLogo } from '@/app/components/OpenSteamAuthCardHeader'

type SessionState = {
  valid: boolean
  status?: string
  oauthComplete?: boolean
  completed?: boolean
  reason?: string
  needsRenewal?: boolean
  altReviewPending?: boolean
  altReviewStatus?: string | null
  altApproved?: boolean
}

export default function VerifyPage() {
  const searchParams = useSearchParams()
  const signed = searchParams.get('s') || ''
  const step = searchParams.get('step')
  const error = searchParams.get('error')
  const success = searchParams.get('success')

  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [blockedHits, setBlockedHits] = useState<Array<{ kind: string; reason: string; label?: string; guildName?: string; discordId?: string; guildId?: string }>>([])
  const [done, setDone] = useState(false)
  const [altAccounts, setAltAccounts] = useState<{ username: string; discordId: string; inGuild?: boolean }[]>([])

  const loadSession = useCallback(async () => {
    if (!signed) {
      setSession({ valid: false, reason: 'missing_session' })
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/verify/validate?s=${encodeURIComponent(signed)}`)
      const data = await res.json()
      setSession(data)
      if (data.completed || success === '1') setDone(true)
    } catch {
      setSession({ valid: false, reason: 'network_error' })
    } finally {
      setLoading(false)
    }
  }, [signed, success])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  async function handleComplete() {
    if (!signed) return
    setCompleting(true)
    setCompleteError(null)
    setBlockedHits([])
    setAltAccounts([])

    try {
      const fingerprint = getBrowserFingerprint()
      const canvasHash = getCanvasHash()
      const res = await fetch('/api/verify/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s: signed, fingerprint, canvasHash }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 403 && data.code === 'VPN_BLOCKED') {
        setCompleteError('VPN or proxy detected. Please disable your VPN and try again.')
        return
      }

      if (res.status === 403 && data.code === 'VERIFICATION_BLOCKED') {
        setBlockedHits(Array.isArray(data.hits) ? data.hits : [])
        setCompleteError(data.error || 'Verification is blocked until you remove restricted Discord connections.')
        return
      }

      if (res.status === 403 && data.code === 'ALT_BLOCKED') {
        setAltAccounts(Array.isArray(data.altAccounts) ? data.altAccounts : [])
        setCompleteError(data.error || 'Verification is blocked because this account matches an existing account.')
        return
      }

      if (!res.ok) {
        setCompleteError(data.error || 'Verification failed. Please try again from Discord.')
        return
      }

      if (data.altDetected && Array.isArray(data.altAccounts)) {
        setAltAccounts(data.altAccounts)
      }
      setDone(true)
      clearNeedsReverify()
      await loadSession()
    } catch {
      setCompleteError('Network error. Please try again.')
    } finally {
      setCompleting(false)
    }
  }

  const oauthComplete = session?.oauthComplete || step === 'confirm'

  return (
    <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        <div className="glass border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
          <OpenSteamAuthBanner />

          <div className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <OpenSteamAuthLogo />
            <h1 className="text-2xl font-bold tracking-tight">OpenSteam Verification</h1>
            <p className="text-sm text-muted-foreground">
              {session?.needsRenewal
                ? 'Welcome back — re-verify to restore your OpenSteam access'
                : 'Prove you are human to access OpenSteam Manifests'}
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
          ) : !signed || !session?.valid ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-amber-100">Verification link required</p>
                <p className="text-amber-200/70 mt-1">
                  Open the <strong>Verify</strong> button in the OpenSteam Discord server to get your personal verification link.
                </p>
              </div>
            </div>
          ) : done || session.completed ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-3">
              <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto" />
              <p className="font-semibold text-emerald-100">You&apos;re verified!</p>
              <p className="text-sm text-emerald-200/70">
                {session?.needsRenewal
                  ? 'Your access has been restored. You can sign in at opensteam.lol or return to Discord.'
                  : 'Return to Discord — you now have access to OpenSteam Manifests.'}
              </p>
              <a
                href="/auth/signin"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-sm font-semibold text-emerald-100 transition-colors"
              >
                Sign in to OpenSteam <ExternalLink className="h-3 w-3" />
              </a>
              {altAccounts.length > 0 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3 text-left">
                  <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-100">Alt account detected</p>
                    <p className="text-amber-200/70 mt-1">
                      This looks like an alt of{' '}
                      <strong className="text-amber-100">
                        {altAccounts.map((a) => a.username).join(', ')}
                      </strong>
                      . Staff have been notified that you joined on an alt account.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  Authorization failed. Please try connecting Discord again.
                </div>
              )}

              <div className="space-y-3">
                <div className={`flex items-center gap-3 p-3 rounded-xl border ${oauthComplete ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
                  <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${oauthComplete ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white'}`}>1</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Connect Discord</p>
                    <p className="text-xs text-muted-foreground">Authorize OpenSteam to verify your account</p>
                  </div>
                  {oauthComplete ? (
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <a
                      href={`/api/verify/oauth/start?s=${encodeURIComponent(signed)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-bold transition-colors"
                    >
                      Connect <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className={`flex items-center gap-3 p-3 rounded-xl border ${oauthComplete ? 'border-white/10 bg-white/5' : 'border-white/5 bg-black/20 opacity-60'}`}>
                  <span className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center bg-zinc-600 text-white">2</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Complete Verification</p>
                    <p className="text-xs text-muted-foreground">Security checks run when you press Verify</p>
                  </div>
                </div>
              </div>

              {session?.altReviewPending ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-2">
                  <p className="font-semibold">Alt review pending</p>
                  <p className="text-amber-200/80">
                    Staff are reviewing a possible alt-account match. You will get a Discord DM when they approve or reject it.
                    After approval, return here and press <strong>Complete verification</strong> again.
                  </p>
                </div>
              ) : null}

              {session?.altReviewStatus === 'rejected' ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100 space-y-2">
                  <p className="font-semibold">Alt review rejected</p>
                  <p className="text-red-200/80">
                    Staff did not approve this verification. Contact moderation in Discord if you believe this was a mistake.
                  </p>
                </div>
              ) : null}

              {completeError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 space-y-3">
                  <p>{completeError}</p>
                  {blockedHits.length > 0 ? (
                    <ul className="space-y-2 text-xs text-red-100/90">
                      {blockedHits.map((hit) => (
                        <li key={`${hit.kind}-${hit.discordId || hit.guildId}`} className="rounded-lg border border-red-500/20 bg-black/20 p-2">
                          {hit.kind === 'friend' ? (
                            <p><strong>Friend:</strong> {hit.label || hit.discordId} <span className="font-mono text-red-200/70">({hit.discordId})</span></p>
                          ) : (
                            <p><strong>Server:</strong> {hit.guildName || hit.guildId} <span className="font-mono text-red-200/70">({hit.guildId})</span></p>
                          )}
                          <p className="text-red-200/70 mt-1">{hit.reason}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {altAccounts.length > 0 ? (
                    <div className="space-y-2 text-xs text-red-100/90">
                      <p className="font-semibold text-red-100">Matched account(s)</p>
                      {altAccounts.map((account) => (
                        <div key={account.discordId} className="rounded-lg border border-red-500/20 bg-black/20 p-2">
                          <p>
                            <strong>{account.username}</strong>{' '}
                            <span className="font-mono text-red-200/70">({account.discordId})</span>
                          </p>
                          {account.inGuild ? (
                            <p className="text-red-200/80 mt-1">
                              This account is already in the OpenSteam Discord server. Switch to that account — alts cannot verify.
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              <button
                type="button"
                disabled={
                  !oauthComplete
                  || completing
                  || !!session?.altReviewPending
                  || session?.altReviewStatus === 'rejected'
                }
                onClick={handleComplete}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {completing ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
