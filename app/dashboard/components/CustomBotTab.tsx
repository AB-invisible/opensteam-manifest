'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  Bot,
  CheckCircle,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  Square,
  AlertTriangle,
  KeyRound,
  Shield,
  Server,
} from 'lucide-react'
import { useToast } from '@/app/components/Toast'
import HostedBotConsole from './HostedBotConsole'

type CustomState = {
  instance: {
    id: string
    guildId: string | null
    status: string
    lockedByOwner: boolean
    botClientId: string | null
    hasCredentials: boolean
    inviteUrl: string | null
    lastStartedAt: string | null
    updatedAt: string
    modules?: string[]
  } | null
  oauthRedirectUrl: string
  oauthConfigured?: boolean
  planActive: boolean
  planExpiry: string | null
  planIsCanceled: boolean
  businessActive: boolean
}

type StatusState = {
  usage: { todayCount: number; dailyLimit: number }
  daemon: { customManagerEnabled: boolean }
}

const SETUP_STEPS = [
  { key: 'credentials', label: 'App credentials' },
  { key: 'oauth', label: 'OAuth redirect' },
  { key: 'invite', label: 'Invite bot' },
  { key: 'link', label: 'Link server' },
  { key: 'live', label: 'Connected' },
] as const

function StepShell({
  step,
  title,
  subtitle,
  done,
  locked,
  children,
}: {
  step: number
  title: string
  subtitle?: string
  done?: boolean
  locked?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`glass rounded-3xl p-6 space-y-4 border transition-colors ${
        done
          ? '!border-emerald-500/25 !bg-emerald-500/5'
          : locked
            ? '!border-white/5 opacity-50 pointer-events-none'
            : '!border-purple-500/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
            done
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : locked
                ? 'bg-white/5 text-white/30 border border-white/10'
                : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
          }`}
        >
          {done ? <CheckCircle className="h-4 w-4" /> : step}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black uppercase tracking-widest text-purple-300">{title}</h3>
          {subtitle && <p className="text-xs text-white/50 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {!locked && children}
      {locked && (
        <p className="text-xs text-white/30 pl-11">Complete the previous step first.</p>
      )}
    </div>
  )
}

function FieldLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-white/80">{label}</label>
      <p className="text-[10px] text-white/40 leading-relaxed">{hint}</p>
    </div>
  )
}

export default function CustomBotTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lifecycleLoading, setLifecycleLoading] = useState<string | null>(null)
  const [data, setData] = useState<CustomState | null>(null)
  const [status, setStatus] = useState<StatusState | null>(null)
  const [usageHistory, setUsageHistory] = useState<{ total7d: number; instance?: { status: string } } | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [botToken, setBotToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [guildId, setGuildId] = useState('')
  const [oauthLoading, setOauthLoading] = useState(false)
  const [modules, setModules] = useState<string[]>(['gen', 'request', 'status', 'link', 'onlinefixes'])

  const load = useCallback(async () => {
    setLoading(true)
    setAccessError(null)
    try {
      const [customRes, statusRes, usageRes] = await Promise.all([
        fetch('/api/hosted-bot/custom'),
        fetch('/api/hosted-bot/status'),
        fetch('/api/hosted-bot/usage'),
      ])
      if (customRes.status === 403) {
        const json = await customRes.json().catch(() => ({}))
        setAccessError(json.error || 'Custom bot requires RESELLER or BUSINESS plan')
        return
      }
      if (customRes.ok) {
        const json = await customRes.json()
        setData(json)
        if (json.instance?.botClientId && json.instance.botClientId !== '••••••••') {
          setClientId(json.instance.botClientId)
        }
        if (json.instance?.guildId) setGuildId(json.instance.guildId)
        if (json.instance?.modules) setModules(json.instance.modules)
      }
      if (statusRes.ok) setStatus(await statusRes.json())
      if (usageRes.ok) setUsageHistory(await usageRes.json())
    } catch {
      toastError('Load failed', 'Could not load custom bot settings')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    load()
  }, [load])

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toastSuccess(`${label} copied`)
  }

  const saveCredentials = async () => {
    const hasExisting = !!data?.instance?.hasCredentials
    if (!clientId.trim()) {
      toastError('Missing fields', 'Enter your Client ID')
      return
    }
    if (!hasExisting && (!botToken.trim() || !clientSecret.trim())) {
      toastError('Missing fields', 'Enter Client ID, Client Secret, and Bot Token')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/hosted-bot/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-credentials',
          botToken: botToken.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save credentials')
      toastSuccess('Credentials saved', 'Next: add the OAuth redirect URL in Discord')
      setBotToken('')
      setClientSecret('')
      await load()
    } catch (e: any) {
      toastError('Save failed', e.message || 'Failed to save credentials')
    } finally {
      setSaving(false)
    }
  }

  const bindGuild = async () => {
    if (!guildId.trim()) {
      toastError('Missing server ID', 'Enter your Discord server ID')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/hosted-bot/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bind-guild', guildId: guildId.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to bind server')
      toastSuccess('Server linked', 'Your bot is active — the manager will connect within ~30 seconds')
      await load()
    } catch (e: any) {
      toastError('Bind failed', e.message || 'Failed to bind server')
    } finally {
      setSaving(false)
    }
  }

  const startOAuthLink = async () => {
    if (!guildId.trim()) {
      toastError('Missing server ID', 'Paste your Discord server ID first, or run /link in Discord')
      return
    }
    setOauthLoading(true)
    try {
      const res = await fetch(`/api/hosted-bot/custom/link?guildId=${encodeURIComponent(guildId.trim())}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not start OAuth link')
      window.location.href = json.oauthUrl
    } catch (e: any) {
      toastError('OAuth link failed', e.message || 'Could not start Discord authorization')
    } finally {
      setOauthLoading(false)
    }
  }

  const saveModules = async (newModules: string[]) => {
    try {
      const res = await fetch('/api/hosted-bot/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-modules', modules: newModules }),
      })
      if (!res.ok) throw new Error('Failed to update modules')
      toastSuccess('Modules updated')
      await load()
    } catch (e: any) {
      toastError('Update failed', e.message)
    }
  }

  const toggleModule = (mod: string) => {
    const next = modules.includes(mod) ? modules.filter(m => m !== mod) : [...modules, mod]
    setModules(next)
    saveModules(next)
  }

  const lifecycle = async (action: 'start' | 'stop' | 'restart') => {
    setLifecycleLoading(action)
    try {
      const res = await fetch('/api/hosted-bot/custom/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      toastSuccess(
        action === 'restart' ? 'Bot restarted' : action === 'start' ? 'Bot started' : 'Bot stopped',
        'The custom bot manager will apply this within ~30 seconds'
      )
      await load()
    } catch (e: any) {
      toastError('Action failed', e.message || 'Action failed')
    } finally {
      setLifecycleLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    )
  }

  if (accessError) {
    return (
      <div className="glass rounded-2xl p-6 border border-red-500/20 text-red-200 text-sm">
        {accessError}
      </div>
    )
  }

  const hasCredentials = !!data?.instance?.hasCredentials
  const isConnected = data?.instance?.status === 'ACTIVE' && !!data?.instance?.guildId
  const inviteUrl = data?.instance?.inviteUrl
  const showBusinessWarning = data && !data.businessActive
  const managerRunning = status?.daemon?.customManagerEnabled
  const isFirstVisit = !hasCredentials

  const stepDone: Record<(typeof SETUP_STEPS)[number]['key'], boolean> = {
    credentials: hasCredentials,
    oauth: hasCredentials,
    invite: hasCredentials && !!inviteUrl,
    link: !!data?.instance?.guildId,
    live: isConnected,
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="relative overflow-hidden glass rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-500/[0.08] via-transparent to-indigo-500/[0.06] p-6 sm:p-8">
        <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-purple-500/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-500/20 border border-purple-500/30 shadow-lg shadow-purple-500/10">
              <Bot className="h-6 w-6 text-purple-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Custom Bot</h2>
              <p className="text-sm text-white/55 max-w-2xl mt-1 leading-relaxed">
                Host your own Discord application on OpenSteam with{' '}
                <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">/gen</code>,{' '}
                <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">/request</code>, and{' '}
                <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">/link</code>.
              </p>
            </div>
          </div>
          {managerRunning ? (
            <span className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Manager online
            </span>
          ) : hasCredentials ? (
            <span className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Manager offline
            </span>
          ) : null}
        </div>
      </div>

      {isFirstVisit && (
        <div className="glass rounded-2xl p-5 border border-purple-500/25 bg-purple-500/5 space-y-3">
          <div className="flex items-center gap-2 text-purple-200">
            <KeyRound className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">First-time setup</p>
          </div>
          <p className="text-xs text-white/55 leading-relaxed">
            Create a bot at the{' '}
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noreferrer"
              className="text-purple-300 hover:text-purple-200 inline-flex items-center gap-1"
            >
              Discord Developer Portal
              <ExternalLink className="h-3 w-3" />
            </a>
            . You will need three values from your app: <strong className="text-white/80">Client ID</strong>,{' '}
            <strong className="text-white/80">Client Secret</strong> (OAuth2), and <strong className="text-white/80">Bot Token</strong> (Bot section).
          </p>
        </div>
      )}

      <div className="glass rounded-2xl p-5 border border-white/10 bg-black/20">
        <div className="hidden sm:flex items-center justify-between gap-1 mb-4">
          {SETUP_STEPS.map(({ key, label }, i) => {
            const done = stepDone[key]
            const active = !done && (i === 0 || stepDone[SETUP_STEPS[i - 1].key])
            return (
              <React.Fragment key={key}>
                <div className="flex flex-col items-center gap-1.5 min-w-0 flex-1">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-black border transition-colors ${
                      done
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : active
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-200 ring-2 ring-purple-500/20'
                          : 'bg-white/5 border-white/10 text-white/30'
                    }`}
                  >
                    {done ? <CheckCircle className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-wide text-center truncate w-full ${done ? 'text-emerald-300/90' : active ? 'text-purple-200' : 'text-white/35'}`}>
                    {label}
                  </span>
                </div>
                {i < SETUP_STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 max-w-[2rem] mb-5 rounded-full ${stepDone[SETUP_STEPS[i].key] ? 'bg-emerald-500/40' : 'bg-white/10'}`} />
                )}
              </React.Fragment>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2 sm:hidden">
          {SETUP_STEPS.map(({ key, label }, i) => (
            <span
              key={key}
              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                stepDone[key]
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : i === 0 || stepDone[SETUP_STEPS[i - 1].key]
                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                    : 'bg-white/5 border-white/10 text-white/40'
              }`}
            >
              {stepDone[key] ? '✓' : i + 1}. {label}
            </span>
          ))}
        </div>
      </div>

      {isConnected && (
        <div className="relative overflow-hidden glass rounded-2xl p-5 border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 space-y-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="relative flex items-center gap-2 text-emerald-300">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30">
              <CheckCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-bold">Your bot is connected</p>
          </div>
          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-black/35 p-3 border border-emerald-500/10">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1">
                <Server className="h-3 w-3" /> Linked server
              </p>
              <p className="font-mono text-emerald-200 break-all">{data?.instance?.guildId}</p>
            </div>
            <div className="rounded-xl bg-black/35 p-3 border border-white/5">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-1">Client ID</p>
              <p className="font-mono text-white/80 break-all">{data?.instance?.botClientId || '—'}</p>
            </div>
            <div className="rounded-xl bg-black/35 p-3 border border-white/5">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-1">Status</p>
              <p className="text-emerald-300 font-semibold">{data?.instance?.status}</p>
            </div>
            <div className="rounded-xl bg-black/35 p-3 border border-white/5">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-1">API usage today</p>
              <p className="text-white font-semibold tabular-nums">
                {status?.usage ? `${status.usage.todayCount} / ${status.usage.dailyLimit}` : '—'}
              </p>
            </div>
            {usageHistory && (
              <div className="rounded-xl bg-black/35 p-3 border border-white/5">
                <p className="text-white/40 uppercase tracking-wider text-[10px] mb-1">Last 7 days</p>
                <p className="text-white font-semibold tabular-nums">{usageHistory.total7d} gens</p>
              </div>
            )}
          </div>
          <p className="relative text-[10px] text-emerald-200/70">
            OpenSteam staff can see this connection in Admin → Hosted Bots. Your bot is hosted on our infrastructure.
          </p>
        </div>
      )}

      {showBusinessWarning && (
        <div className="glass rounded-2xl p-5 border border-amber-500/20 bg-amber-500/5 flex gap-3 text-amber-200 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Large Business subscription inactive</p>
            <p className="text-amber-200/80 mt-1">
              Your bot is suspended until you renew.{' '}
              {data?.planExpiry && <>Expiry: {new Date(data.planExpiry).toLocaleDateString()}</>}
            </p>
          </div>
        </div>
      )}

      {data?.planActive && data?.planExpiry && !showBusinessWarning && !isConnected && (
        <div className="glass rounded-2xl p-4 border border-purple-500/20 bg-purple-500/5 text-sm text-purple-200">
          Large Business renews on {new Date(data.planExpiry).toLocaleDateString(undefined, { dateStyle: 'long' })}.
        </div>
      )}

      {!managerRunning && hasCredentials && (
        <div className="glass rounded-2xl p-5 border border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-orange-500/5 flex gap-4 text-amber-100 text-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">Custom bot manager is offline</p>
            <p className="text-amber-100/75 text-xs leading-relaxed">
              Your bot will not connect until the platform owner starts the manager (Admin → Hosted Bots → Start).
              If you just saved credentials, wait ~30 seconds and refresh.
            </p>
          </div>
        </div>
      )}

      {data?.instance?.lockedByOwner && (
        <div className="glass rounded-2xl p-5 border border-red-500/20 bg-red-500/5 text-red-200 text-sm">
          Your bot has been locked by the platform owner.
        </div>
      )}

      {/* Step 1 — Credentials only (no redirect URL yet) */}
      <StepShell
        step={1}
        title="Discord app credentials"
        subtitle="Paste the three values from your Discord application. We encrypt and store them securely."
        done={stepDone.credentials}
      >
        <div className="space-y-4 pl-11">
          <div className="space-y-2">
            <FieldLabel
              label="Client ID"
              hint="Developer Portal → your application → OAuth2 (or General Information)"
            />
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. 1234567890123456789"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel
              label="Client Secret"
              hint="Developer Portal → OAuth2 → Client Secret (reset & copy if needed)"
            />
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Paste client secret"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
          <div className="space-y-2">
            <FieldLabel
              label="Bot Token"
              hint="Developer Portal → Bot → Reset Token (only shown once — copy immediately)"
            />
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="Paste bot token"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={saveCredentials}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm font-semibold text-white"
          >
            {saving ? 'Saving…' : hasCredentials ? 'Update credentials' : 'Save credentials & continue'}
          </button>
        </div>
      </StepShell>

      {/* Step 2 — OAuth redirect (after credentials saved) */}
      <StepShell
        step={2}
        title="OAuth redirect URL"
        subtitle="Add this exact URL in your Discord app → OAuth2 → Redirects. Required for /link and dashboard linking."
        done={stepDone.oauth && isConnected}
        locked={!hasCredentials}
      >
        {data?.oauthRedirectUrl && (
          <div className="space-y-3 pl-11">
            <div className="flex gap-2">
              <input
                readOnly
                value={data.oauthRedirectUrl}
                className="flex-1 bg-black/40 border border-purple-500/20 rounded-xl px-3 py-2 text-xs font-mono text-purple-100"
              />
              <button
                type="button"
                onClick={() => copyText(data.oauthRedirectUrl, 'Redirect URL')}
                className="px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20"
              >
                <Copy className="h-4 w-4 text-purple-300" />
              </button>
            </div>
            <p className="text-[10px] text-white/40">
              After adding the redirect, invite your bot and link your server in step 3–4.
            </p>
          </div>
        )}
      </StepShell>

      {/* Step 3 — Invite */}
      <StepShell
        step={3}
        title="Invite your bot"
        subtitle="Add the bot to your Discord server with Manage Server permission."
        done={stepDone.invite && !!data?.instance?.guildId}
        locked={!hasCredentials}
      >
        {inviteUrl ? (
          <div className="space-y-3 pl-11">
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white/80"
              />
              <button
                type="button"
                onClick={() => copyText(inviteUrl, 'Invite URL')}
                className="px-3 py-2 rounded-xl bg-white/5 border border-white/10"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-purple-300"
            >
              <Link2 className="h-4 w-4" /> Open invite in Discord
            </a>
          </div>
        ) : (
          <p className="text-xs text-white/40 pl-11">Invite link appears after credentials are saved.</p>
        )}
      </StepShell>

      {/* Step 4 — Link server */}
      <StepShell
        step={4}
        title="Link server"
        subtitle="Run /link in Discord (recommended) or authorize here with your server ID."
        done={stepDone.link}
        locked={!hasCredentials}
      >
        <div className="space-y-3 pl-11">
          <p className="text-xs text-white/50">
            Run <code className="text-purple-300">/link</code> in your server, or paste the server ID below.
          </p>
          <div className="flex gap-2">
            <input
              value={guildId}
              onChange={(e) => setGuildId(e.target.value)}
              placeholder="Discord server ID"
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono outline-none"
            />
            <button
              type="button"
              disabled={saving || oauthLoading}
              onClick={startOAuthLink}
              className="px-4 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 text-sm font-semibold text-white whitespace-nowrap"
            >
              {oauthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link with Discord'}
            </button>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={bindGuild}
            className="px-4 py-2 rounded-xl bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-xs font-semibold text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Manual link (no OAuth)'}
          </button>
        </div>
      </StepShell>

      {/* Step 5 — Controls (when credentials exist) */}
      {hasCredentials && (
        <div className="glass rounded-3xl p-6 space-y-4 border border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-black uppercase tracking-widest text-purple-300">Bot controls</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['start', 'stop', 'restart'] as const).map((action) => (
              <button
                key={action}
                type="button"
                disabled={!!lifecycleLoading || !data?.planActive}
                onClick={() => lifecycle(action)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm capitalize disabled:opacity-40"
              >
                {lifecycleLoading === action ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : action === 'start' ? (
                  <Play className="h-4 w-4 text-emerald-400" />
                ) : action === 'stop' ? (
                  <Square className="h-4 w-4 text-red-400" />
                ) : (
                  <RotateCcw className="h-4 w-4 text-amber-400" />
                )}
                {action}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/40 flex items-center gap-2">
            <Server className="h-3.5 w-3.5" />
            Status: {data?.instance?.status || 'pending'}
            {status?.usage && ` · Usage ${status.usage.todayCount}/${status.usage.dailyLimit}`}
            {managerRunning ? ' · Manager online' : ' · Manager offline'}
          </p>
        </div>
      )}

      {hasCredentials && (
        <div className="glass rounded-3xl p-6 space-y-4 border border-white/10">
          <h3 className="text-sm font-black uppercase tracking-widest text-purple-300">Bot Modules</h3>
          <p className="text-xs text-white/50">Toggle which features your bot will respond to.</p>
          <div className="flex flex-wrap gap-3">
            {['gen', 'request', 'status', 'onlinefixes'].map(mod => (
              <label key={mod} className="flex items-center gap-2 cursor-pointer bg-white/5 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10">
                <input type="checkbox" checked={modules.includes(mod)} onChange={() => toggleModule(mod)} className="rounded text-purple-500 focus:ring-purple-500 bg-black/40 border-white/10" />
                <span className="text-sm text-white/80 capitalize">{mod}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {hasCredentials && <HostedBotConsole accent="purple" />}
    </div>
  )
}
