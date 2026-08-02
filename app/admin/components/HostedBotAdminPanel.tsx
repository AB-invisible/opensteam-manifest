'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Bot, CheckCircle, Copy, Lock, RefreshCw, ShieldCheck, Unlock, KeyRound, Server, AlertTriangle, X, Terminal, Send, Crown, Users, ExternalLink, Radio } from 'lucide-react'

function getCustomRedirectDisplayUrl() {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/hosted-bot/custom/oauth/callback`
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'}/api/hosted-bot/custom/oauth/callback`
}

type InstanceRow = {
  id: string
  type: string
  guildId: string | null
  status: string
  lockedByOwner: boolean
  lockedReason?: string | null
  botClientId?: string | null
  hasCredentials?: boolean
  inviteUrl?: string | null
  lastStartedAt?: string | null
  lastStoppedAt?: string | null
  createdAt?: string
  updatedAt?: string
  setupStep?: string
  isConnected?: boolean
  isPending?: boolean
  user: { username: string; plan: string; discordId: string }
  // Runtime metadata captured by the daemons
  botUsername?: string | null
  guildName?: string | null
  guildOwnerId?: string | null
  guildOwnerName?: string | null
  memberCount?: number | null
  connectedAt?: string | null
  lastHeartbeatAt?: string | null
  liveConnected?: boolean
}

type HostedBotLogRow = {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'EVENT'
  source: string | null
  message: string
  createdAt: string
}

type InstanceMeta = {
  syncCreated: number
  counts: {
    eligible: number
    brandedEligible: number
    customEligible: number
    instances: number
    brandedInstances: number
    customInstances: number
    connected: number
  }
}

type HostedAdminData = {
  config: {
    clientId: string
    hasClientSecret: boolean
    hasBotToken: boolean
    enabled: boolean
    oauthRedirectUrl: string
    inviteUrl: string | null
  }
  customManagerEnabled: boolean
  brandedInstances: InstanceRow[]
}

export default function HostedBotAdminPanel({
  toastSuccess,
  toastError,
}: {
  toastSuccess: (title: string, message?: string) => void
  toastError: (title: string, message?: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [data, setData] = useState<HostedAdminData | null>(null)
  const [allInstances, setAllInstances] = useState<InstanceRow[]>([])
  const [instanceMeta, setInstanceMeta] = useState<InstanceMeta | null>(null)
  const [instancesError, setInstancesError] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setInstancesError(null)
    try {
      const [brandedRes, instancesRes] = await Promise.all([
        fetch('/api/admin/hosted-bot/branded'),
        fetch('/api/admin/hosted-bot/instances'),
      ])
      if (brandedRes.ok) {
        const json = await brandedRes.json()
        setData(json)
        if (json.config?.clientId) setClientId(json.config.clientId)
      } else if (brandedRes.status === 403) {
        toastError('Access denied', 'Owner role required')
      }

      const instancesJson = instancesRes.ok ? await instancesRes.json() : await instancesRes.json().catch(() => ({}))

      if (instancesRes.ok) {
        setAllInstances(buildSubscriberRows(instancesJson.instances || [], instancesJson.eligibleUsers || []))
        setInstanceMeta(instancesJson.meta || null)
      } else {
        setAllInstances([])
        setInstanceMeta(instancesJson.meta || null)
        const msg =
          instancesJson.error ||
          (instancesRes.status === 403
            ? 'Owner role required to view subscriber instances'
            : `Failed to load instances (${instancesRes.status})`)
        setInstancesError(instancesJson.details ? `${msg}: ${instancesJson.details}` : msg)
        if (instancesRes.status !== 403) toastError('Instance load failed', msg)
      }
    } catch {
      toastError('Load failed', 'Could not load hosted bot settings')
      setInstancesError('Network error while loading hosted bot data')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    load()
  }, [load])

  const postAction = async (body: Record<string, unknown>) => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/admin/hosted-bot/branded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      toastSuccess('Done', 'Hosted bot settings updated')
      await load()
    } catch (e: any) {
      toastError('Action failed', e.message)
    } finally {
      setActionLoading(false)
    }
  }

  const patchInstance = async (instanceId: string, action: string) => {
    if (instanceId.startsWith('pending-')) {
      toastError('Not synced yet', 'Click Sync & refresh to create this subscriber row')
      return
    }
    try {
      const res = await fetch('/api/admin/hosted-bot/instances', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      toastSuccess('Instance updated', action)
      await load()
    } catch (e: any) {
      toastError('Instance action failed', e.message)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Activity className="h-6 w-6 animate-spin text-indigo-400" />
      </div>
    )
  }

  const brandedList = allInstances.filter((i) => i.type === 'BRANDED')
  const customList = allInstances.filter((i) => i.type === 'CUSTOM')
  const brandedFromConfig = (data?.brandedInstances || []).filter(
    (row) => !brandedList.some((i) => i.id === row.id)
  )
  const mergedBrandedList = [...brandedList, ...brandedFromConfig]
  const selectedInstance = [...mergedBrandedList, ...customList].find((i) => i.id === selectedInstanceId) || null

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-emerald-300 border-b border-white/5 pb-4">
        <div className="flex items-center space-x-3">
          <Bot className="h-6 w-6" />
          <div>
            <h3 className="text-lg font-black uppercase tracking-widest text-white">Hosted Discord Bots</h3>
            <p className="text-[10px] text-white/40 mt-1">
              Separate from the community bot · REGULAR/PREMIUM branded · RESELLER/BUSINESS custom
              {instanceMeta && (
                <span className="text-white/25">
                  {' '}
                  · {instanceMeta.counts.eligible} eligible · {instanceMeta.counts.connected} connected
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/70 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Sync & refresh
        </button>
      </div>

      {instancesError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3 text-red-200 text-xs">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Could not load subscriber instances</p>
            <p className="mt-1 text-red-200/80 font-mono text-[10px] break-all">{instancesError}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/5 border border-emerald-500/20 rounded-[2rem] p-6 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-emerald-300">Branded bot credentials</h4>
          <div className="grid grid-cols-1 gap-3">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Branded Client ID"
              className="bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono outline-none"
            />
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={data?.config.hasClientSecret ? 'Client Secret (saved)' : 'Client Secret'}
              className="bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono outline-none"
            />
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={data?.config.hasBotToken ? 'Bot Token (saved)' : 'Bot Token'}
              className="bg-black/40 border border-white/10 rounded-xl py-2 px-4 text-xs text-white font-mono outline-none"
            />
          </div>
          <button
            type="button"
            disabled={actionLoading}
            onClick={() =>
              postAction({
                action: 'SAVE_CONFIG',
                clientId: clientId || undefined,
                clientSecret: clientSecret || undefined,
                botToken: botToken || undefined,
              })
            }
            className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-black uppercase"
          >
            Save branded credentials
          </button>
          {data?.config.oauthRedirectUrl && (
            <div className="flex gap-2 items-center">
              <input
                readOnly
                value={data.config.oauthRedirectUrl}
                className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] font-mono text-white/70"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(data.config.oauthRedirectUrl)
                  toastSuccess('OAuth URL copied')
                }}
                className="p-2 rounded-lg bg-white/5"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="text-[9px] text-white/35 leading-relaxed">
            Add the OAuth redirect URL above to the branded Discord app → OAuth2 → Redirects. Subscribers use <code className="text-emerald-300/80">/link</code> in Discord to bind their server.
          </p>
          {data?.config.inviteUrl && (
            <a href={data.config.inviteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[10px] text-emerald-300">
              <CheckCircle className="h-3.5 w-3.5" /> Branded customer invite URL
            </a>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-white/70">Daemon controls</h4>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className={`px-2 py-1 rounded-full border ${data?.config.enabled ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-white/40'}`}>
              Branded: {data?.config.enabled ? 'ON' : 'OFF'}
            </span>
            <span className={`px-2 py-1 rounded-full border ${data?.customManagerEnabled ? 'border-purple-500/30 text-purple-300 bg-purple-500/10' : 'border-white/10 text-white/40'}`}>
              Custom mgr: {data?.customManagerEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <p className="col-span-2 text-[9px] font-black uppercase text-emerald-400/70">Branded daemon</p>
            {(['RUNNING', 'RESTART', 'IDLE'] as const).map((st) => (
              <button
                key={st}
                type="button"
                disabled={actionLoading}
                onClick={() => postAction({ action: 'BRANDED_DAEMON', status: st })}
                className="py-2 text-[9px] font-black uppercase rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
              >
                {st === 'RUNNING' ? 'Start' : st === 'IDLE' ? 'Stop' : 'Restart'}
              </button>
            ))}
            <p className="col-span-2 text-[9px] font-black uppercase text-purple-400/70 pt-2">Custom bot manager</p>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => postAction({ action: 'CUSTOM_MANAGER', status: 'RUNNING' })}
              className="py-2 text-[9px] font-black uppercase rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-300"
            >
              Start
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => postAction({ action: 'CUSTOM_MANAGER', status: 'RESTART' })}
              className="py-2 text-[9px] font-black uppercase rounded-lg border border-purple-500/20 bg-purple-500/10 text-purple-300"
            >
              Restart
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => postAction({ action: 'CUSTOM_MANAGER', status: 'IDLE' })}
              className="py-2 text-[9px] font-black uppercase rounded-lg border border-red-500/20 bg-red-500/10 text-red-300"
            >
              Stop
            </button>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => postAction({ action: 'LOCK_ALL_BRANDED', locked: true, reason: 'Owner lock' })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[9px] font-black uppercase"
            >
              <Lock className="h-3 w-3" /> Lock all branded
            </button>
            <button
              type="button"
              onClick={() => postAction({ action: 'LOCK_ALL_BRANDED', locked: false })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[9px] font-black uppercase"
            >
              <Unlock className="h-3 w-3" /> Unlock all branded
            </button>
          </div>
        </div>
      </div>

      {renderInstanceTable('Branded instances', mergedBrandedList, patchInstance, instanceMeta, 'branded', setSelectedInstanceId)}
      {renderCustomSection(customList, patchInstance, instanceMeta, setSelectedInstanceId)}

      {selectedInstance && (
        <InstanceDetailModal
          instance={selectedInstance}
          onClose={() => setSelectedInstanceId(null)}
          onAction={patchInstance}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}
    </div>
  )
}

function buildSubscriberRows(
  instances: InstanceRow[],
  eligibleUsers: Array<{ id: string; username: string; plan: string; discordId: string }>
): InstanceRow[] {
  const rows: InstanceRow[] = [...instances]

  for (const user of eligibleUsers) {
    const hasRow = instances.some((inst) => inst.user?.discordId === user.discordId)
    if (hasRow) continue

    const type = ['REGULAR', 'PREMIUM'].includes(user.plan) ? 'BRANDED' : 'CUSTOM'
    rows.push({
      id: `pending-${user.id}`,
      type,
      guildId: null,
      status: 'PENDING',
      lockedByOwner: false,
      hasCredentials: false,
      botClientId: null,
      isConnected: false,
      isPending: true,
      user,
    })
  }

  return rows.sort((a, b) => a.user.username.localeCompare(b.user.username))
}

function renderCustomSection(
  rows: InstanceRow[],
  patchInstance: (id: string, action: string) => void,
  meta: InstanceMeta | null,
  onSelect: (id: string) => void
) {
  const redirectUrl = getCustomRedirectDisplayUrl()
  const connected = rows.filter((r) => r.isConnected)
  const inSetup = rows.filter((r) => !r.isConnected && r.hasCredentials)
  const needCreds = rows.filter((r) => !r.hasCredentials)

  return (
    <div className="bg-white/5 border border-purple-500/20 rounded-[2rem] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[9px] font-black uppercase text-purple-300">
          <Bot className="h-3.5 w-3.5" /> Custom bot instances ({rows.length})
        </div>
        <div className="flex flex-wrap gap-2 text-[9px]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
            {connected.length} connected
          </span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300">
            {inSetup.length} in setup
          </span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">
            {needCreds.length} need credentials
          </span>
        </div>
      </div>

      <div className="rounded-xl bg-black/30 border border-white/5 p-3 space-y-2">
        <p className="text-[9px] font-black uppercase text-white/40">Subscriber OAuth redirect (share with RESELLER/BUSINESS)</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={redirectUrl}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg py-1.5 px-2 text-[10px] font-mono text-white/70"
          />
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(redirectUrl)}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10"
            title="Copy redirect URL"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-white/30 py-4 text-center">
          {meta?.counts.customEligible
            ? `No custom bot rows yet — ${meta.counts.customEligible} RESELLER/BUSINESS user(s) should appear after sync. Click Sync & refresh.`
            : 'No RESELLER or BUSINESS subscribers yet.'}
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-2">
          {rows.map((inst) => (
            <div
              key={inst.id}
              onClick={() => !inst.isPending && onSelect(inst.id)}
              className={`p-3 rounded-xl text-[10px] border transition-colors ${
                inst.isPending ? '' : 'cursor-pointer hover:border-white/30'
              } ${
                inst.isConnected
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : inst.hasCredentials
                    ? 'bg-purple-500/5 border-purple-500/20'
                    : 'bg-black/30 border-white/10'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-white font-semibold">{inst.user.username}</span>
                    <span className="text-white/40">{inst.user.plan}</span>
                    {inst.liveConnected && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase">
                        <Radio className="h-2.5 w-2.5" /> Live
                      </span>
                    )}
                    {inst.isConnected && !inst.liveConnected && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-400/70 bg-emerald-500/10 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase">
                        <CheckCircle className="h-2.5 w-2.5" /> Connected
                      </span>
                    )}
                    {inst.isPending && (
                      <span className="text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase">
                        Awaiting setup
                      </span>
                    )}
                    {inst.lockedByOwner && <span className="text-red-400">LOCKED</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-white/45">
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />
                      {inst.hasCredentials ? (
                        <span className="text-emerald-400/90">Creds saved</span>
                      ) : (
                        <span className="text-amber-400/90">Needs Client ID / Secret / Token</span>
                      )}
                    </span>
                    {inst.botClientId && (
                      <span className="font-mono text-white/35">App {inst.botClientId}</span>
                    )}
                    {inst.guildId ? (
                      <span className="inline-flex items-center gap-1 font-mono text-emerald-300/80">
                        <Server className="h-3 w-3" /> {inst.guildName || inst.guildId}
                      </span>
                    ) : (
                      <span className="text-white/30">No server linked</span>
                    )}
                    {inst.guildOwnerName && (
                      <span className="inline-flex items-center gap-1 text-amber-300/70">
                        <Crown className="h-3 w-3" /> {inst.guildOwnerName}
                      </span>
                    )}
                    <span>{inst.status}</span>
                  </div>
                </div>
                {!inst.isPending && (
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {(['lock', 'unlock', 'stop', 'start', 'restart'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => patchInstance(inst.id, a)}
                        className="px-2 py-0.5 rounded bg-white/5 border border-white/10 uppercase text-[8px]"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

const LOG_LEVEL_STYLES: Record<string, string> = {
  INFO: 'text-white/60',
  WARN: 'text-amber-300',
  ERROR: 'text-red-400',
  EVENT: 'text-emerald-300',
}

function ConsoleView({ logs, emptyHint }: { logs: HostedBotLogRow[]; emptyHint: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Track whether the user is pinned to the bottom so new lines only auto-scroll
  // the inner console (never the whole page) when they aren't reading older logs.
  const stickToBottom = useRef(true)

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  useEffect(() => {
    const el = containerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="bg-black/60 border border-white/10 rounded-xl p-3 h-64 overflow-y-auto font-mono text-[10px] leading-relaxed"
    >
      {logs.length === 0 ? (
        <p className="text-white/30 italic">{emptyHint}</p>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="flex gap-2">
            <span className="text-white/25 shrink-0">{new Date(log.createdAt).toLocaleTimeString()}</span>
            <span className={`shrink-0 ${LOG_LEVEL_STYLES[log.level] || 'text-white/60'}`}>
              [{log.source || log.level}]
            </span>
            <span className="text-white/80 break-words">{log.message}</span>
          </div>
        ))
      )}
    </div>
  )
}

function InstanceDetailModal({
  instance,
  onClose,
  onAction,
  toastSuccess,
  toastError,
}: {
  instance: InstanceRow
  onClose: () => void
  onAction: (id: string, action: string) => void
  toastSuccess: (title: string, message?: string) => void
  toastError: (title: string, message?: string) => void
}) {
  const [logs, setLogs] = useState<HostedBotLogRow[]>([])
  const [sending, setSending] = useState(false)
  const instanceId = instance.id

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/hosted-bot/logs?instanceId=${encodeURIComponent(instanceId)}&limit=150`)
      if (!res.ok) return
      const json = await res.json()
      setLogs(json.logs || [])
    } catch {
      /* ignore transient errors */
    }
  }, [instanceId])

  useEffect(() => {
    loadLogs()
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      loadLogs()
    }, 4000)
    return () => window.clearInterval(id)
  }, [loadLogs])

  const sendCommand = async (type: 'RECONNECT') => {
    setSending(true)
    try {
      const res = await fetch('/api/admin/hosted-bot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, type }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Command failed')
      toastSuccess('Command queued', 'Reconnect requested')
      setTimeout(loadLogs, 1500)
    } catch (e: any) {
      toastError('Command failed', e.message)
    } finally {
      setSending(false)
    }
  }

  const info: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Type', value: instance.type },
    { label: 'Status', value: instance.status },
    { label: 'Bot user', value: instance.botUsername || '—' },
    { label: 'App / Client ID', value: instance.botClientId || '—' },
    { label: 'Server', value: instance.guildName || (instance.guildId ? instance.guildId : 'Not linked') },
    { label: 'Server ID', value: instance.guildId || '—' },
    { label: 'Server owner', value: instance.guildOwnerName || '—' },
    { label: 'Members', value: instance.memberCount != null ? instance.memberCount.toLocaleString() : '—' },
    { label: 'Connected at', value: fmtTime(instance.connectedAt) },
    { label: 'Last heartbeat', value: fmtTime(instance.lastHeartbeatAt) },
    { label: 'Last started', value: fmtTime(instance.lastStartedAt) },
    { label: 'Created', value: fmtTime(instance.createdAt) },
  ]

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[#0A0A0B] border border-white/10 rounded-[2rem] w-full max-w-3xl shadow-2xl shadow-indigo-500/10 overflow-hidden animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${instance.type === 'CUSTOM' ? 'bg-purple-500/15 text-purple-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black text-white truncate">{instance.user.username}</h3>
              <p className="text-[10px] text-white/40">
                {instance.user.plan} · {instance.type}
                {instance.liveConnected ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-400"><Radio className="h-2.5 w-2.5" /> Live</span>
                ) : instance.isConnected ? (
                  <span className="ml-2 text-emerald-400/70">Connected</span>
                ) : (
                  <span className="ml-2 text-white/30">Offline</span>
                )}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {instance.lockedByOwner && instance.lockedReason && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200 flex gap-2">
              <Lock className="h-4 w-4 shrink-0" /> Locked: {instance.lockedReason}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {info.map((row) => (
              <div key={row.label} className="bg-white/5 border border-white/10 rounded-xl p-2.5">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">{row.label}</p>
                <p className="text-[11px] text-white/80 font-mono break-words mt-0.5">{row.value}</p>
              </div>
            ))}
          </div>

          {instance.inviteUrl && (
            <div className="flex gap-2 items-center">
              <input
                readOnly
                value={instance.inviteUrl}
                className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] font-mono text-white/70"
              />
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(instance.inviteUrl!); toastSuccess('Invite URL copied') }}
                className="p-2 rounded-lg bg-white/5 border border-white/10"
                title="Copy invite URL"
              >
                <Copy className="h-4 w-4" />
              </button>
              <a
                href={instance.inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/70"
                title="Open invite"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(['lock', 'unlock', 'stop', 'start', 'restart'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onAction(instance.id, a)}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 uppercase text-[9px] font-black hover:bg-white/10"
              >
                {a}
              </button>
            ))}
            <button
              type="button"
              disabled={sending}
              onClick={() => sendCommand('RECONNECT')}
              className="px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 uppercase text-[9px] font-black hover:bg-indigo-500/25 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" /> Reconnect
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-white/40 flex items-center gap-1.5">
              <Terminal className="h-3 w-3" /> Live console
            </p>
            <ConsoleView
              logs={logs}
              emptyHint={
                instance.type === 'BRANDED'
                  ? 'No events yet for this branded server. Activity appears when the bot is used.'
                  : 'No console output yet. Logs appear once the bot connects or is used.'
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function renderInstanceTable(
  title: string,
  rows: InstanceRow[],
  patchInstance: (id: string, action: string) => void,
  meta: InstanceMeta | null,
  variant: 'branded' | 'custom' = 'branded',
  onSelect?: (id: string) => void
) {
  const emptyHint =
    variant === 'branded'
      ? meta?.counts.brandedEligible
        ? `${meta.counts.brandedEligible} REGULAR/PREMIUM subscriber(s) on file — click Sync & refresh if the list is empty.`
        : 'No REGULAR or PREMIUM subscribers yet.'
      : meta?.counts.customEligible
        ? `${meta.counts.customEligible} RESELLER/BUSINESS subscriber(s) on file — click Sync & refresh if the list is empty.`
        : 'No RESELLER or BUSINESS subscribers yet.'

  return (
    <div className="bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-3">
      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-white/40">
        <ShieldCheck className="h-3 w-3" /> {title} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-white/30 py-4 text-center">{emptyHint}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-2">
          {rows.map((inst) => (
            <div
              key={inst.id}
              onClick={() => !inst.isPending && onSelect?.(inst.id)}
              className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-black/30 text-[10px] transition-colors ${
                inst.isPending ? '' : 'cursor-pointer hover:bg-black/50'
              }`}
            >
              <div className="min-w-0">
                <span className="text-white font-semibold">{inst.user.username}</span>
                <span className="text-white/40 ml-2">{inst.user.plan}</span>
                <span className="text-white/30 ml-2">{inst.type}</span>
                <span className="text-white/40 ml-2">{inst.status}</span>
                {inst.isPending && <span className="text-amber-400 ml-2">AWAITING SYNC</span>}
                {inst.liveConnected && <span className="text-emerald-400 ml-2">LIVE</span>}
                {inst.isConnected && !inst.liveConnected && <span className="text-emerald-400/70 ml-2">CONNECTED</span>}
                {inst.lockedByOwner && <span className="text-red-400 ml-2">LOCKED</span>}
                {(inst.guildName || inst.guildId) && (
                  <span className="text-white/25 ml-2 font-mono truncate">{inst.guildName || inst.guildId}</span>
                )}
              </div>
              {!inst.isPending && (
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {(['lock', 'unlock', 'stop', 'start', 'restart'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => patchInstance(inst.id, a)}
                      className="px-2 py-0.5 rounded bg-white/5 border border-white/10 uppercase text-[8px]"
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
