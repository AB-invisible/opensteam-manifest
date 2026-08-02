'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { DiscordVerifyIntel } from '@/app/lib/discord-verify-intel'
import { premiumTypeLabel } from '@/app/lib/discord-verify-intel'
import type { VerificationAltReviewState } from '@/app/lib/verification-alt-policy'
import { getDiscordCdnAvatarUrl } from '@/app/lib/discord-avatar'

export type VerifySessionRow = {
  id: string
  discordId: string
  status: string
  vpnDetected?: boolean
  altMatchedUserIds?: string[]
  verifyIp?: string | null
  verifyCountry?: string | null
  completedAt?: string | null
  createdAt: string
  riskFlags?: unknown
  discordIntelSnapshot?: DiscordVerifyIntel | null
  altReview?: VerificationAltReviewState | null
  user?: {
    username: string
    discordGlobalName?: string | null
    email?: string | null
    discordLocale?: string | null
    discordPremiumType?: number | null
    discordMfaEnabled?: boolean | null
    discordEmailVerified?: boolean | null
    discordProfileSnapshot?: DiscordVerifyIntel | null
  } | null
}

function fmtDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString()
}

function bool(value?: boolean | null): string {
  if (value === null || value === undefined) return '—'
  return value ? 'Yes' : 'No'
}

function avatarUrl(id: string, hash?: string | null): string | null {
  if (!hash) return null
  return getDiscordCdnAvatarUrl(id, hash, 128)
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="p-2 rounded-lg bg-black/30 border border-white/5 min-w-0">
      <p className="uppercase font-black text-white/50 text-[9px]">{label}</p>
      <p className={`text-white font-bold break-words ${mono ? 'font-mono text-[10px]' : ''}`}>{value ?? '—'}</p>
    </div>
  )
}

function SessionDetails({ session }: { session: VerifySessionRow }) {
  const alts = session.altMatchedUserIds ?? []
  const review = session.altReview
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-indigo-300">Verification session</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
        <Field label="Session ID" value={session.id} mono />
        <Field label="Discord ID" value={session.discordId} mono />
        <Field label="Status" value={session.status} />
        <Field label="VPN detected" value={bool(session.vpnDetected)} />
        <Field label="IP address" value={session.verifyIp || '—'} mono />
        <Field label="Country" value={session.verifyCountry || '—'} />
        <Field label="Created" value={fmtDate(session.createdAt)} />
        <Field label="Completed" value={fmtDate(session.completedAt)} />
        <Field label="Alt matches" value={alts.length} />
      </div>
      {alts.length > 0 && (
        <div className="p-2 rounded-lg bg-black/30 border border-white/5">
          <p className="uppercase font-black text-white/50 text-[9px] mb-1">Alt-matched user IDs</p>
          <div className="flex flex-wrap gap-1">
            {alts.map((id) => (
              <span key={id} className="font-mono text-[9px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/80">
                {id}
              </span>
            ))}
          </div>
        </div>
      )}
      {review && (
        <div className="p-2 rounded-lg bg-black/30 border border-white/5 text-[10px] space-y-1">
          <p className="uppercase font-black text-white/50 text-[9px]">Alt review</p>
          <p className="text-white/80">
            Status: <span className="font-bold text-white">{review.status}</span>
            {review.reviewedBy ? ` · by ${review.reviewedBy}` : ''}
            {review.reviewedAt ? ` · ${fmtDate(review.reviewedAt)}` : ''}
          </p>
          {(review.blockedFlags?.length || review.matchedFlags?.length) ? (
            <p className="text-white/60">
              Flags: {(review.blockedFlags || review.matchedFlags || []).join(', ')}
            </p>
          ) : null}
          {review.notes ? <p className="text-white/60">Notes: {review.notes}</p> : null}
        </div>
      )}
      {session.riskFlags !== null && session.riskFlags !== undefined && (
        <details className="p-2 rounded-lg bg-black/30 border border-white/5">
          <summary className="uppercase font-black text-white/50 text-[9px] cursor-pointer">Raw risk flags</summary>
          <pre className="mt-1 text-[9px] text-white/70 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
            {JSON.stringify(session.riskFlags, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function AccountDetails({ user }: { user: NonNullable<VerifySessionRow['user']> }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-indigo-300">OpenSteam account</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
        <Field label="Username" value={user.username || '—'} />
        <Field label="Global name" value={user.discordGlobalName || '—'} />
        <Field label="Email" value={user.email || '—'} />
        <Field label="Email verified" value={bool(user.discordEmailVerified)} />
        <Field label="Locale" value={user.discordLocale || '—'} />
        <Field label="MFA enabled" value={bool(user.discordMfaEnabled)} />
        <Field label="Nitro" value={premiumTypeLabel(user.discordPremiumType ?? undefined)} />
      </div>
    </div>
  )
}

function IntelBlock({ intel }: { intel: DiscordVerifyIntel }) {
  const p = intel.profile
  const avatar = avatarUrl(p.id, p.avatarHash)
  return (
    <div className="mt-2 space-y-2 text-[10px] text-muted-foreground leading-relaxed">
      <p className="text-[9px] font-black uppercase tracking-widest text-indigo-300">Discord intel</p>
      <div className="flex items-start gap-3">
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt={p.displayName} className="h-14 w-14 rounded-full border border-white/10 shrink-0" />
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1 min-w-0">
          <Field label="Display" value={p.displayName} />
          <Field label="Username" value={`${p.username}${p.discriminator && p.discriminator !== '0' ? `#${p.discriminator}` : ''}`} />
          <Field label="User ID" value={p.id} mono />
          <Field label="Account age" value={`${p.accountAgeDays} days`} />
          <Field label="Created" value={fmtDate(p.accountCreatedAt)} />
          <Field label="Nitro" value={p.premiumLabel} />
          <Field label="MFA" value={p.mfaEnabled ? 'On' : 'Off'} />
          <Field label="Locale" value={p.locale || '—'} />
          <Field label="Email" value={p.email ? `${p.email}${p.emailVerified ? ' ✓' : ''}` : '—'} />
          <Field label="Public flags" value={p.publicFlags} mono />
          <Field label="Accent color" value={p.accentColor !== null ? `#${p.accentColor.toString(16).padStart(6, '0')}` : '—'} />
          <Field label="Avatar hash" value={p.avatarHash || '—'} mono />
          <Field label="Banner hash" value={p.bannerHash || '—'} mono />
        </div>
      </div>

      {p.badges.length > 0 && (
        <p>
          <span className="font-black text-white/50 uppercase">Badges: </span>
          {p.badges.join(', ')}
        </p>
      )}

      <div className="p-2 rounded-lg bg-black/30 border border-white/5">
        <p className="uppercase font-black text-white/50 text-[9px]">
          Connections — {intel.connections.total} linked ({intel.connections.verifiedCount} verified)
        </p>
        {Object.keys(intel.connections.byType).length > 0 && (
          <p className="text-white/60 mt-1">
            {Object.entries(intel.connections.byType).map(([t, n]) => `${t}:${n}`).join(', ')}
          </p>
        )}
        {intel.connections.items.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {intel.connections.items.map((c, i) => (
              <span
                key={`${c.type}-${c.name}-${i}`}
                className="text-[9px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/80"
              >
                {c.type}: {c.name}
                {c.verified ? ' ✓' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-2 rounded-lg bg-black/30 border border-white/5">
        <p className="uppercase font-black text-white/50 text-[9px]">
          Servers — {intel.guilds.total} ({intel.guilds.ownedCount} owned)
        </p>
        {intel.guilds.names.length > 0 && (
          <p className="text-white/60 mt-1">{intel.guilds.names.join(', ')}</p>
        )}
      </div>

      {intel.guildMember && (
        <div className="p-2 rounded-lg bg-black/30 border border-white/5">
          <p className="uppercase font-black text-white/50 text-[9px]">This guild</p>
          <p className="text-white/60 mt-1">
            {intel.guildMember.nick ? `nick "${intel.guildMember.nick}"` : 'no nick'}
            {intel.guildMember.joined_at ? ` · joined ${intel.guildMember.joined_at.slice(0, 10)}` : ''}
            {intel.guildMember.premium_since ? ` · boosting since ${intel.guildMember.premium_since.slice(0, 10)}` : ''}
            {intel.guildMember.roles?.length ? ` · ${intel.guildMember.roles.length} role(s)` : ''}
            {intel.guildMember.communication_disabled_until
              ? ` · timed out until ${fmtDate(intel.guildMember.communication_disabled_until)}`
              : ''}
          </p>
        </div>
      )}

      {intel.relationships && (
        <div className="p-2 rounded-lg bg-black/30 border border-white/5">
          <p className="uppercase font-black text-white/50 text-[9px]">
            Relationships — {intel.relationships.total} total
          </p>
          <p className="text-white/60 mt-1">
            {intel.relationships.friends} friends · {intel.relationships.blocked} blocked ·{' '}
            {intel.relationships.pendingIncoming} pending in · {intel.relationships.pendingOutgoing} pending out
          </p>
          {intel.relationships.sampleUsernames.length > 0 && (
            <p className="text-white/50 mt-1 break-words">
              Sample: {intel.relationships.sampleUsernames.join(', ')}
            </p>
          )}
        </div>
      )}

      <p className="text-white/40">Intel fetched {fmtDate(intel.fetchedAt)}</p>
    </div>
  )
}

function AltReviewActions({
  session,
  onReviewed,
}: {
  session: VerifySessionRow
  onReviewed?: () => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (session.altReview?.status !== 'pending' || session.status !== 'OAUTH_COMPLETE') {
    return null
  }

  async function submit(decision: 'approve' | 'reject') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_alt',
          sessionId: session.id,
          decision,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Review failed')
        return
      }
      setNotes('')
      onReviewed?.()
    } catch {
      setError('Network error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Pending alt review</p>
      {(session.altReview.blockedFlags?.length || session.altReview.matchedFlags?.length) ? (
        <p className="text-[10px] text-amber-100/80">
          Flags: {(session.altReview.blockedFlags || session.altReview.matchedFlags || []).join(', ')}
        </p>
      ) : null}
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Staff notes (optional)"
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => submit('approve')}
          className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
        >
          {busy === 'approve' ? 'Approving…' : 'Approve alt'}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => submit('reject')}
          className="px-3 py-1.5 text-[10px] font-black uppercase rounded-lg border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-50"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
      {error ? <p className="text-[10px] text-red-300">{error}</p> : null}
    </div>
  )
}

export function VerifySessionsPanel({
  sessions,
  onReviewed,
}: {
  sessions: VerifySessionRow[]
  onReviewed?: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const pending = useMemo(
    () =>
      sessions.filter(
        (session) => session.altReview?.status === 'pending' && session.status === 'OAUTH_COMPLETE',
      ),
    [sessions],
  )

  const ordered = useMemo(() => {
    const base = [
      ...pending,
      ...sessions.filter((session) => !pending.some((item) => item.id === session.id)),
    ]
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter((s) => {
      const intel =
        (s.discordIntelSnapshot as DiscordVerifyIntel | null) ||
        (s.user?.discordProfileSnapshot as DiscordVerifyIntel | null)
      const haystack = [
        s.discordId,
        s.id,
        intel?.profile.id,
        s.user?.username,
        s.user?.discordGlobalName,
        intel?.profile.displayName,
        intel?.profile.username,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [pending, sessions, query])

  if (!sessions.length) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Recent verifications</p>
        {pending.length > 0 ? (
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-amber-200">
            {pending.length} alt review pending
          </span>
        ) : null}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by User ID, username, or display name…"
          className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-[11px] text-white placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500/50"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {query ? (
        <p className="text-[9px] text-muted-foreground">
          {ordered.length} result{ordered.length === 1 ? '' : 's'} for “{query.trim()}”
        </p>
      ) : null}

      <div className="max-h-96 overflow-y-auto space-y-2">
        {ordered.length === 0 ? (
          <p className="text-[10px] text-muted-foreground py-6 text-center">No verifications match your search.</p>
        ) : null}
        {ordered.map((s) => {
          const intel =
            (s.discordIntelSnapshot as DiscordVerifyIntel | null) ||
            (s.user?.discordProfileSnapshot as DiscordVerifyIntel | null)
          const isOpen = expanded === s.id
          const display =
            intel?.profile.displayName || s.user?.discordGlobalName || s.user?.username || s.discordId
          const pendingAlt = s.altReview?.status === 'pending' && s.status === 'OAUTH_COMPLETE'
          const headerAvatar = intel ? avatarUrl(intel.profile.id, intel.profile.avatarHash) : null

          return (
            <div
              key={s.id}
              className={`rounded-xl border overflow-hidden ${
                pendingAlt ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-black/20'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {headerAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={headerAvatar} alt={display} className="h-7 w-7 rounded-full border border-white/10 shrink-0" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-white truncate">{display}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">
                      <span className={s.status === 'COMPLETED' ? 'text-emerald-400' : pendingAlt ? 'text-amber-300' : 'text-white/70'}>
                        {pendingAlt ? 'ALT_REVIEW_PENDING' : s.status}
                      </span>
                      {' · '}
                      {s.discordId}
                      {s.verifyCountry ? ` · ${s.verifyCountry}` : ''}
                      {s.vpnDetected ? ' · VPN' : ''}
                      {(s.altMatchedUserIds?.length ?? 0) > 0 ? ` · ${s.altMatchedUserIds!.length} alt(s)` : ''}
                    </p>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t border-white/5 space-y-1">
                  <SessionDetails session={s} />
                  {s.user ? <AccountDetails user={s.user} /> : null}
                  {intel ? <IntelBlock intel={intel} /> : (
                    <p className="mt-2 text-[10px] text-muted-foreground">No Discord intel snapshot captured for this session.</p>
                  )}
                  <AltReviewActions session={s} onReviewed={onReviewed} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
