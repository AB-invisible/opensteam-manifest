'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCircle, Copy, Link2, Loader2, Server, AlertTriangle } from 'lucide-react'
import { useToast } from '@/app/components/Toast'
import HostedBotConsole from './HostedBotConsole'

type BrandedState = {
  instance: {
    id: string
    guildId: string | null
    status: string
    lockedByOwner: boolean
    inviteUrl: string | null
    modules?: string[]
  } | null
  brandedConfigured: boolean
  oauthConfigured?: boolean
  inviteUrl: string | null
  oauthRedirectUrl: string
  planActive: boolean
  error?: string
}

type StatusState = {
  usage: { todayCount: number; dailyLimit: number }
  daemon: { brandedEnabled: boolean; brandedConfigured: boolean }
  allowedCommands?: string[]
}

type UsageState = {
  total7d: number
  daily: { date: string; count: number }[]
  instance?: { status: string; updatedAt: string }
}

export default function BrandedBotTab() {
  const { success: toastSuccess, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<BrandedState | null>(null)
  const [status, setStatus] = useState<StatusState | null>(null)
  const [usageHistory, setUsageHistory] = useState<UsageState | null>(null)
  const [guildId, setGuildId] = useState('')
  const [accessError, setAccessError] = useState<string | null>(null)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [modules, setModules] = useState<string[]>(['gen', 'request', 'status', 'link', 'onlinefixes'])

  const load = useCallback(async () => {
    setLoading(true)
    setAccessError(null)
    try {
      const [brandedRes, statusRes, usageRes] = await Promise.all([
        fetch('/api/hosted-bot/branded'),
        fetch('/api/hosted-bot/status'),
        fetch('/api/hosted-bot/usage'),
      ])
      if (brandedRes.status === 403) {
        const json = await brandedRes.json().catch(() => ({}))
        setAccessError(json.error || 'Branded bot requires REGULAR or PREMIUM plan (or OWNER access for testing)')
        return
      }
      if (brandedRes.ok) {
        const json = await brandedRes.json()
        setData(json)
        if (json.instance?.guildId) setGuildId(json.instance.guildId)
        if (json.instance?.modules) setModules(json.instance.modules)
      }
      if (statusRes.ok) setStatus(await statusRes.json())
      if (usageRes.ok) setUsageHistory(await usageRes.json())
    } catch {
      toastError('Load failed', 'Could not load branded bot settings')
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

  const bindGuild = async () => {
    if (!guildId.trim()) {
      toastError('Missing server ID', 'Enter your Discord server ID')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/hosted-bot/branded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: guildId.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to bind server')
      toastSuccess('Server linked', 'Your branded bot is active on that server')
      await load()
    } catch (e: any) {
      toastError('Bind failed', e.message || 'Failed to bind server')
    } finally {
      setSaving(false)
    }
  }

  const saveModules = async (newModules: string[]) => {
    try {
      const res = await fetch('/api/hosted-bot/branded', {
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

  const startOAuthLink = async () => {
    if (!guildId.trim()) {
      toastError('Missing server ID', 'Paste your Discord server ID first, or run /link in Discord')
      return
    }
    setOauthLoading(true)
    try {
      const res = await fetch(`/api/hosted-bot/branded/link?guildId=${encodeURIComponent(guildId.trim())}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not start OAuth link')
      window.location.href = json.oauthUrl
    } catch (e: any) {
      toastError('OAuth link failed', e.message || 'Could not start Discord authorization')
    } finally {
      setOauthLoading(false)
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

  const inviteUrl = data?.inviteUrl
  const isActive = data?.instance?.status === 'ACTIVE' && data?.instance?.guildId
  const daemonRunning = status?.daemon?.brandedEnabled && status?.daemon?.brandedConfigured

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="glass rounded-3xl p-6 sm:p-8 space-y-2">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-indigo-400" />
          <h2 className="text-xl font-bold text-white">OpenSteam Branded Bot</h2>
        </div>
        <p className="text-sm text-white/60 max-w-2xl">
          Add our shared Discord bot to your server with <code className="text-indigo-300">/gen</code> and{' '}
          <code className="text-indigo-300">/request</code>. Each server is linked to one OpenSteam account with its own daily quota (not shared with other servers). One server per account.
        </p>
      </div>

      {!data?.brandedConfigured && (
        <div className="glass rounded-2xl p-5 border border-amber-500/20 bg-amber-500/5 text-amber-200 text-sm">
          The branded bot is not configured yet. Contact support or wait for the platform owner to finish setup.
        </div>
      )}

      {data?.brandedConfigured && !daemonRunning && (
        <div className="glass rounded-2xl p-5 border border-amber-500/20 bg-amber-500/5 flex gap-3 text-amber-200 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>The branded bot daemon is not running. Commands will not work until the platform owner starts it.</p>
        </div>
      )}

      {data?.instance?.lockedByOwner && (
        <div className="glass rounded-2xl p-5 border border-red-500/20 bg-red-500/5 text-red-200 text-sm">
          Your hosted bot has been locked by the platform owner. Contact support for help.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-indigo-300">Step 1 — Invite bot</h3>
          {inviteUrl ? (
            <div className="space-y-3">
              <p className="text-xs text-white/50">Add the bot to your Discord server, then continue to Step 2.</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white/80"
                />
                <button
                  type="button"
                  onClick={() => copyText(inviteUrl, 'Invite URL')}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10"
                >
                  <Copy className="h-4 w-4 text-white/70" />
                </button>
              </div>
              <a
                href={inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-indigo-300 hover:text-indigo-200"
              >
                <Link2 className="h-4 w-4" /> Open invite in Discord
              </a>
            </div>
          ) : (
            <p className="text-sm text-white/50">Invite URL unavailable until branded bot credentials are configured.</p>
          )}
        </div>

        <div className="glass rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-indigo-300">Step 2 — Link server</h3>
          <p className="text-xs text-white/50">
            Run <code className="text-indigo-300">/link</code> in your Discord server (recommended), or paste your server ID here and authorize with Discord.
          </p>
          <div className="flex gap-2">
            <input
              value={guildId}
              onChange={(e) => setGuildId(e.target.value)}
              placeholder="Server ID (e.g. 123456789012345678)"
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:ring-1 focus:ring-indigo-500/50 outline-none"
            />
            <button
              type="button"
              disabled={saving || oauthLoading || !data?.planActive}
              onClick={startOAuthLink}
              className="px-4 py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 text-sm font-semibold text-white whitespace-nowrap"
            >
              {oauthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link with Discord'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={saving || !data?.planActive}
              onClick={bindGuild}
              className="px-4 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40 text-xs font-semibold text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Manual link (no OAuth)'}
            </button>
            <span className="text-[10px] text-white/35">Use if you already signed into OpenSteam with Discord recently</span>
          </div>
          {data?.instance?.guildId && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> Linked server: <code>{data.instance.guildId}</code>
            </p>
          )}
        </div>
      </div>

      <div className="glass rounded-3xl p-6 flex flex-wrap gap-6 items-center">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-indigo-400" />
          <div>
            <p className="text-xs uppercase tracking-widest text-white/40">Status</p>
            <p className="text-sm font-semibold text-white">
              {isActive ? 'Active on your server' : data?.instance?.status || 'Pending setup'}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-white/40">Daemon</p>
          <p className={`text-sm font-semibold ${daemonRunning ? 'text-emerald-400' : 'text-amber-400'}`}>
            {daemonRunning ? 'Running' : 'Offline'}
          </p>
        </div>
        {status?.usage && (
          <div>
            <p className="text-xs uppercase tracking-widest text-white/40">Daily /gen on this server</p>
            <p className="text-sm font-semibold text-white">
              {status.usage.todayCount} / {status.usage.dailyLimit}
            </p>
            <p className="text-[10px] text-white/30 mt-0.5">Quota for your linked account only</p>
          </div>
        )}
        {usageHistory && (
          <div>
            <p className="text-xs uppercase tracking-widest text-white/40">Last 7 days</p>
            <p className="text-sm font-semibold text-white">{usageHistory.total7d} generations</p>
            {usageHistory.instance && (
              <p className="text-[10px] text-white/30 mt-0.5">
                Bot {usageHistory.instance.status} · updated {new Date(usageHistory.instance.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
        {status?.allowedCommands && status.allowedCommands.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-widest text-white/40">Allowed commands</p>
            <p className="text-sm font-semibold text-white font-mono">
              {status.allowedCommands.map((c) => `/${c}`).join(' ')}
            </p>
          </div>
        )}
      </div>

      {data?.instance && (
        <div className="glass rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-black uppercase tracking-widest text-indigo-300">Bot Modules</h3>
          <p className="text-xs text-white/50">Toggle which features your bot will respond to.</p>
          <div className="flex flex-wrap gap-3">
            {['gen', 'request', 'status', 'onlinefixes'].map(mod => (
              <label key={mod} className="flex items-center gap-2 cursor-pointer bg-white/5 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10">
                <input type="checkbox" checked={modules.includes(mod)} onChange={() => toggleModule(mod)} className="rounded text-indigo-500 focus:ring-indigo-500 bg-black/40 border-white/10" />
                <span className="text-sm text-white/80 capitalize">{mod}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {data?.instance?.guildId && <HostedBotConsole accent="emerald" />}
    </div>
  )
}
