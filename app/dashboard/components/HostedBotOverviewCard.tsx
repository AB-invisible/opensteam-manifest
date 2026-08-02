'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Bot, ArrowRight, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'

type HostedStatus = {
  botType: 'BRANDED' | 'CUSTOM' | null
  planActive: boolean
  instance: {
    status: string
    guildId: string | null
    lockedByOwner: boolean
    hasCredentials?: boolean
  } | null
  usage: { todayCount: number; dailyLimit: number }
  daemon: {
    brandedEnabled: boolean
    brandedConfigured: boolean
    customManagerEnabled: boolean
  }
}

export default function HostedBotOverviewCard({
  plan,
  onNavigate,
}: {
  plan: string
  onNavigate: (tab: 'bot-branded' | 'bot-custom') => void
}) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<HostedStatus | null>(null)

  const isBranded = ['REGULAR', 'PREMIUM'].includes(plan)
  const isCustom = ['RESELLER', 'BUSINESS'].includes(plan)
  const eligible = isBranded || isCustom

  const load = useCallback(async () => {
    if (!eligible) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/hosted-bot/status')
      if (res.ok) setStatus(await res.json())
    } finally {
      setLoading(false)
    }
  }, [eligible])

  useEffect(() => {
    load()
  }, [load])

  if (!eligible) return null

  const targetTab = isBranded ? 'bot-branded' : 'bot-custom'
  const isActive = status?.instance?.status === 'ACTIVE' && !!status?.instance?.guildId
  const needsSetup = !status?.instance?.guildId
  const daemonOk = isBranded
    ? status?.daemon?.brandedConfigured && status?.daemon?.brandedEnabled
    : status?.daemon?.customManagerEnabled

  return (
    <div className={`glass rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${isActive ? '!border-emerald-500/20 !bg-emerald-500/5' : '!border-indigo-500/20 !bg-indigo-500/5'}`}>
      <div className="flex items-start space-x-3 min-w-0">
        <div className={`p-2 rounded-xl border shrink-0 ${isActive ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'}`}>
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
            {isBranded ? 'Branded Bot' : 'Custom Bot'}
            {isActive && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                <CheckCircle className="h-3 w-3" /> Live
              </span>
            )}
            {needsSetup && !loading && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                Setup required
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {isActive
              ? `Your server · /gen today: ${status?.usage?.todayCount ?? 0}/${status?.usage?.dailyLimit ?? '—'} (your account quota only)`
              : isBranded
                ? 'Invite our shared bot to your server and link it here to unlock /gen and /request.'
                : 'Add your Discord app credentials, invite your bot, and we host it for you.'}
          </p>
          {!loading && !daemonOk && (
            <p className="text-xs text-amber-300/90 mt-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {isBranded ? 'Branded bot daemon is not running yet — contact the platform owner.' : 'Custom bot manager is not running — start it from admin or wait for deployment.'}
            </p>
          )}
          {status?.instance?.lockedByOwner && (
            <p className="text-xs text-red-300 mt-1">Your bot is locked by the platform owner.</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onNavigate(targetTab)}
        className="shrink-0 flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
      >
        <span>{isActive ? 'Manage Bot' : 'Set Up Bot'}</span>
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  )
}
