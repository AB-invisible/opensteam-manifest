'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, Server, Crown, Users, Radio } from 'lucide-react'

type ConsoleLog = {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'EVENT'
  source: string | null
  message: string
  createdAt: string
}

type ConsoleInstance = {
  id: string
  type: string
  status: string
  guildId: string | null
  guildName: string | null
  guildOwnerName: string | null
  memberCount: number | null
  botUsername: string | null
  inviteUrl: string | null
  connectedAt: string | null
  lastHeartbeatAt: string | null
  liveConnected: boolean
}

const POLL_MS = 5000

const LEVEL_STYLES: Record<string, string> = {
  INFO: 'text-white/55',
  WARN: 'text-amber-300',
  ERROR: 'text-red-400',
  EVENT: 'text-emerald-300',
}

export default function HostedBotConsole({ accent = 'purple' }: { accent?: 'purple' | 'emerald' }) {
  const [instance, setInstance] = useState<ConsoleInstance | null>(null)
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [loaded, setLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hosted-bot/console')
      if (!res.ok) return
      const json = await res.json()
      setInstance(json.instance || null)
      setLogs(json.logs || [])
    } catch {
      /* ignore transient errors */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    load()
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      load()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    const el = containerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [logs])

  if (loaded && !instance) return null

  const accentText = accent === 'emerald' ? 'text-emerald-300' : 'text-purple-300'
  const accentBorder = accent === 'emerald' ? 'border-emerald-500/20' : 'border-purple-500/20'

  return (
    <div className={`glass rounded-3xl p-6 space-y-4 border ${accentBorder}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className={`h-4 w-4 ${accentText}`} />
          <h3 className={`text-sm font-black uppercase tracking-widest ${accentText}`}>Bot console</h3>
        </div>
        {instance?.liveConnected ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
            <Radio className="h-3 w-3" /> Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 text-[10px] font-bold uppercase tracking-wider">
            Offline
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-xl bg-black/35 p-2.5 border border-white/5">
          <p className="text-white/40 uppercase tracking-wider text-[9px] mb-1 flex items-center gap-1">
            <Server className="h-3 w-3" /> Server
          </p>
          <p className="text-white/80 truncate">{instance?.guildName || instance?.guildId || 'Not linked'}</p>
        </div>
        <div className="rounded-xl bg-black/35 p-2.5 border border-white/5">
          <p className="text-white/40 uppercase tracking-wider text-[9px] mb-1 flex items-center gap-1">
            <Crown className="h-3 w-3" /> Owner
          </p>
          <p className="text-white/80 truncate">{instance?.guildOwnerName || '—'}</p>
        </div>
        <div className="rounded-xl bg-black/35 p-2.5 border border-white/5">
          <p className="text-white/40 uppercase tracking-wider text-[9px] mb-1 flex items-center gap-1">
            <Users className="h-3 w-3" /> Members
          </p>
          <p className="text-white/80 tabular-nums">{instance?.memberCount != null ? instance.memberCount.toLocaleString() : '—'}</p>
        </div>
        <div className="rounded-xl bg-black/35 p-2.5 border border-white/5">
          <p className="text-white/40 uppercase tracking-wider text-[9px] mb-1">Bot user</p>
          <p className="text-white/80 truncate">{instance?.botUsername || '—'}</p>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-black/60 border border-white/10 rounded-xl p-3 h-56 overflow-y-auto font-mono text-[10px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-white/30 italic">
            No console output yet. Events appear when your bot connects or its commands are used.
          </p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-white/25 shrink-0">{new Date(log.createdAt).toLocaleTimeString()}</span>
              <span className={`shrink-0 ${LEVEL_STYLES[log.level] || 'text-white/55'}`}>[{log.source || log.level}]</span>
              <span className="text-white/80 break-words">{log.message}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-[10px] text-white/35">Read-only live feed · refreshes every few seconds.</p>
    </div>
  )
}
